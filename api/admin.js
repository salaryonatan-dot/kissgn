/**
 * /api/admin.js — unified admin endpoint
 *
 * POST ?action=roles            → admin-roles (set/remove user role)
 * POST ?action=create-client    → create new tenant + owner (super_owner only)
 * GET  ?action=list-clients     → list all tenants (super_owner only)
 * POST ?action=delete-client    → delete a tenant (super_owner only)
 * POST ?action=reset-password   → reset user password (super_owner only)
 * POST ?action=resend-invite    → resend Email invite with new temp password (super_owner only)
 * POST ?action=edit-client      → edit tenant details (super_owner only)
 * POST ?action=send-user-invite → send email invite to a new user (any owner)
 * POST ?action=create-user      → create a sub-user (owner only, atomic RTDB + rollback)
 * POST ?action=complete-profile  → first-login: update own email + password (authenticated user)
 * POST ?action=delete-user      → delete a user + Firebase Auth (owner only)
 * POST ?action=update-user      → update an existing user (owner only) — Layer 2
 */

import { requireAuth } from "../lib/verifyToken.js";
import { requireTenantAccess, isRateLimited,
  getIP, VALID_ROLES } from "../lib/helpers.js";
import { getAdminDb, getAdminAuth } from "../lib/adminSdk.js";
import { sendEmail } from "../lib/sendEmail.js";

const RTDB_FORBIDDEN = /[.#$\[\]\/]/;
const APP_BASE_URL   = process.env.APP_BASE_URL || "https://kissgn.vercel.app";

/* ── HTML template for invite emails ───────────────────────────────────── */
function buildInviteEmailHtml(bizName, username, tempPass, inviteLink) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1);">
  <tr><td style="background:linear-gradient(135deg,#2563eb,#7c3aed);padding:30px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:28px;">Marjin</h1>
    <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:16px;">ברוכים הבאים למערכת</p>
  </td></tr>
  <tr><td style="padding:30px;">
    <h2 style="color:#1e293b;margin:0 0 20px;font-size:22px;">🎉 ההרשמה הושלמה בהצלחה!</h2>
    <table width="100%" style="background:#f8fafc;border-radius:8px;padding:20px;margin-bottom:24px;" cellpadding="8">
      <tr><td style="color:#64748b;font-size:14px;width:110px;">שם עסק</td>
          <td style="color:#1e293b;font-weight:bold;font-size:16px;">${bizName}</td></tr>
      <tr><td style="color:#64748b;font-size:14px;">שם משתמש</td>
          <td style="color:#1e293b;font-weight:bold;font-size:16px;">${username}</td></tr>
      <tr><td style="color:#64748b;font-size:14px;">סיסמא זמנית</td>
          <td style="color:#1e293b;font-weight:bold;font-size:16px;direction:ltr;text-align:right;">${tempPass}</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="${inviteLink}" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:18px;font-weight:bold;">כניסה למערכת →</a>
    </div>
    <p style="color:#ef4444;font-size:14px;text-align:center;margin:16px 0 0;">⚠️ נא להחליף סיסמא לאחר הכניסה הראשונה</p>
  </td></tr>
  <tr><td style="background:#f8fafc;padding:20px;text-align:center;border-top:1px solid #e2e8f0;">
    <p style="color:#94a3b8;font-size:12px;margin:0;">Marjin — מערכת ניהול עסקית חכמה</p>
  </td></tr>
</table>
</body></html>`;
}

export default async function handler(req, res) {
  // CORS — strict origin, never wildcard with auth
  const allowedOrigin = process.env.ALLOWED_ORIGIN || "https://kissgn.vercel.app";
  const incomingOrigin = req.headers.origin || "";
  if (incomingOrigin && incomingOrigin === allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Vary", "Origin");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const action = req.query.action || "";
  if (action === "list-clients")      return handleListClients(req, res);
  if (action === "create-client")     return handleCreateClient(req, res);
  if (action === "edit-client")       return handleEditClient(req, res);
  if (action === "delete-client")     return handleDeleteClient(req, res);
  if (action === "reset-password")    return handleResetPassword(req, res);
  if (action === "resend-invite")     return handleResendInvite(req, res);
  if (action === "send-user-invite")  return handleSendUserInvite(req, res);
  if (action === "create-user")       return handleCreateUser(req, res);
  if (action === "complete-profile")   return handleCompleteProfile(req, res);
  if (action === "delete-user")       return handleDeleteUser(req, res);
  if (action === "update-user")       return handleUpdateUser(req, res);
  if (action === "roles")             return handleRoles(req, res);
  res.status(400).json({ error: "missing or invalid action" });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET ?action=list-clients
// ─────────────────────────────────────────────────────────────────────────────
async function handleListClients(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  let claims;
  try { claims = await requireAuth(req); }
  catch (e) {
    console.error("[list-clients] auth failed:", e.message);
    res.status(401).json({ error: "unauthorized" }); return;
  }

  const db = getAdminDb();
  const rolesSnap = await db.ref("tenants").once("value");
  if (!rolesSnap.exists()) { res.status(200).json({ clients: [] }); return; }

  console.log("[list-clients] UID:", claims.uid);

  const isSuperOwner = Object.keys(rolesSnap.val()).some(tenantId => {
    const roles = rolesSnap.val()[tenantId]?.roles || {};
    return roles[claims.uid] === "super_owner";
  });

  if (!isSuperOwner) {
    res.status(403).json({ error: "forbidden" }); return;
  }

  const clients = [];
  const allTenants = rolesSnap.val();

  for (const [tenantId, tenantData] of Object.entries(allTenants)) {
    try {
      const bizSnap = await db.ref(`tenants/${tenantId}/app/business`).once("value");
      let bizName = "", createdAt = null;
      if (bizSnap.exists()) {
        try {
          const bizList = JSON.parse(bizSnap.val()?._v || "[]");
          bizName = bizList[0]?.name || "";
          createdAt = bizList[0]?.createdAt || null;
        } catch(_) {}
      }

      const usersSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
      let ownerName = "", ownerEmail = "", ownerUsername = "", ownerPhone = "", status = "unknown";
      if (usersSnap.exists()) {
        try {
          const users = JSON.parse(usersSnap.val()?._v || "[]");
          const owner = users.find(u => u.role === "owner" || u.role === "super_owner");
          if (owner) {
            ownerName = owner.name || "";
            ownerEmail = owner.email || "";
            ownerUsername = owner.username || "";
            ownerPhone = owner.phone || "";
            status = owner.email ? "active" : "invited";
          }
        } catch(_) {}
      }

      const inviteSnap = await db.ref(`tenants/${tenantId}/meta/inviteLink`).once("value");
      const inviteLink = inviteSnap.val() || null;

      clients.push({ tenantId, bizName, ownerName, ownerEmail, ownerUsername, ownerPhone, status, createdAt, inviteLink });
    } catch(e) {
      console.error(`[list-clients] error reading tenant ${tenantId}:`, e.message);
    }
  }

  clients.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.status(200).json({ clients });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST ?action=create-client
// ─────────────────────────────────────────────────────────────────────────────
async function handleCreateClient(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  let claims;
  try { claims = await requireAuth(req); }
  catch (e) {
    console.error("[create-client] auth failed:", e.message);
    res.status(401).json({ error: "unauthorized" }); return;
  }

  const db   = getAdminDb();
  const auth = getAdminAuth();

  // Verify super_owner
  let isSuperOwner = false;
  try {
    const rolesSnap = await db.ref("tenants").once("value");
    if (rolesSnap.exists()) {
      isSuperOwner = Object.keys(rolesSnap.val()).some(tid =>
        rolesSnap.val()[tid]?.roles?.[claims.uid] === "super_owner"
      );
    }
  } catch(e) { console.error("[create-client] roles check failed:", e.message); }

  if (!isSuperOwner) {
    res.status(403).json({ error: "forbidden — super_owner only" }); return;
  }

  const { bizName, ownerName, ownerEmail, ownerUsername, ownerPhone } = req.body || {};

  // ownerEmail is now REQUIRED and must be a real email (not temp)
  if (!bizName?.trim() || !ownerUsername?.trim() || !ownerEmail?.trim()) {
    res.status(400).json({ error: "שדות חובה: שם עסק, שם משתמש, ואימייל נדרשים" });
    return;
  }

  if (ownerEmail.trim().endsWith("@temp.marjin.app")) {
    res.status(400).json({ error: "נדרשת כתובת אימייל אמיתית (לא זמנית)" });
    return;
  }

  const safeEmail = ownerEmail.trim();
  const safeUsername = ownerUsername.trim().toLowerCase();
  const tenantId = "biz_" + Date.now();
  const tempPass = "Marjin_" + Math.random().toString(36).slice(2, 10);
  const now      = Date.now();

  try {
    // Check if username already taken (tenant isolation)
    const existingUn = await db.ref(`username_index/${safeUsername}`).once("value");
    if (existingUn.exists()) {
      res.status(409).json({ error: "שם המשתמש כבר תפוס — יש לבחור שם משתמש אחר" });
      return;
    }

    // Check if email already exists — do NOT reuse existing accounts (tenant isolation)
    let firebaseUid;
    try {
      const userRecord = await auth.createUser({
        email: safeEmail,
        password: tempPass,
        displayName: ownerUsername.trim().toLowerCase(),
      });
      firebaseUid = userRecord.uid;
    } catch(e) {
      if (e.code === "auth/email-already-exists") {
        res.status(409).json({ error: "כתובת האימייל כבר קיימת במערכת — יש להשתמש באימייל אחר" });
        return;
      }
      throw e;
    }

    const ownerUser = {
      id:   "u_" + now,
      name: (ownerName?.trim() || ownerUsername.trim()),
      username: ownerUsername.trim().toLowerCase(),
      email: safeEmail,
      phone: ownerPhone?.trim() || "",
      role: "owner",
      firebaseUid,
      mustCompleteProfile: true,
      createdAt: now,
    };

    const biz = { id: tenantId, name: bizName.trim(), createdAt: now };
    const inviteLink = `${APP_BASE_URL}/?login=1&hint=${encodeURIComponent(ownerUsername.trim().toLowerCase())}`;

    const updates = {};
    updates[`tenants/${tenantId}/app/users`]    = { _v: JSON.stringify([ownerUser]) };
    updates[`tenants/${tenantId}/app/business`]  = { _v: JSON.stringify([biz]) };
    updates[`tenants/${tenantId}/roles/${firebaseUid}`]   = "owner";
    updates[`tenants/${tenantId}/members/${firebaseUid}`] = true;
    updates[`tenants/${tenantId}/meta/createdAt`]  = now;
    updates[`tenants/${tenantId}/meta/createdBy`]  = claims.uid;
    updates[`tenants/${tenantId}/meta/inviteLink`] = inviteLink;
    updates[`tenants/${tenantId}/lookup/${ownerUsername.trim().toLowerCase()}`] = { email: safeEmail, firebaseUid };
    updates[`user_tenants/${firebaseUid}`] = tenantId;
    updates[`username_index/${ownerUsername.trim().toLowerCase()}`] = { tenantId, email: safeEmail };

    await db.ref().update(updates);

    // Send Email invite
    let emailSent = false;
    try {
      const html = buildInviteEmailHtml(bizName.trim(), ownerUsername.trim().toLowerCase(), tempPass, inviteLink);
      await sendEmail(safeEmail, `הזמנה להצטרף ל-Marjin — ${bizName.trim()}`, html);
      emailSent = true;
    } catch (emailErr) {
      console.error("[create-client] Email failed:", emailErr.message);
    }

    // SECURITY: tempPassword is NEVER returned in JSON — only sent via Email
    res.status(200).json({
      ok: true, tenantId, bizName: bizName.trim(),
      ownerEmail: safeEmail, ownerPhone: ownerPhone?.trim() || "",
      inviteLink, emailSent
    });

  } catch(e) {
    console.error("[create-client] error:", e.message, e.code);
    res.status(500).json({ error: e.message || "שגיאה ביצירת לקוח" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST ?action=edit-client — edit tenant/owner details (super_owner only)
// ─────────────────────────────────────────────────────────────────────────────
async function handleEditClient(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  let claims;
  try { claims = await requireAuth(req); }
  catch (e) {
    console.error("[edit-client] auth failed:", e.message);
    res.status(401).json({ error: "unauthorized" }); return;
  }

  const db   = getAdminDb();
  const auth = getAdminAuth();

  // Verify super_owner
  let isSuperOwner = false;
  try {
    const rolesSnap = await db.ref("tenants").once("value");
    if (rolesSnap.exists()) {
      isSuperOwner = Object.keys(rolesSnap.val()).some(tid =>
        rolesSnap.val()[tid]?.roles?.[claims.uid] === "super_owner"
      );
    }
  } catch(e) { console.error("[edit-client] roles check failed:", e.message); }

  if (!isSuperOwner) {
    res.status(403).json({ error: "forbidden — super_owner only" }); return;
  }

  const { tenantId, bizName, ownerName, ownerEmail, ownerPhone, ownerUsername } = req.body || {};

  if (!tenantId || typeof tenantId !== "string") {
    res.status(400).json({ error: "missing tenantId" }); return;
  }

  try {
    // Read current tenant data
    const usersSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
    if (!usersSnap.exists()) {
      res.status(404).json({ error: "טנאנט לא נמצא" }); return;
    }

    let users = [];
    try { users = JSON.parse(usersSnap.val()?._v || "[]"); } catch(_) {}

    const ownerIdx = users.findIndex(u => u.role === "owner" || u.role === "super_owner");
    if (ownerIdx === -1) {
      res.status(404).json({ error: "לא נמצא בעלים לטנאנט" }); return;
    }

    const owner = users[ownerIdx];
    const oldEmail = owner.email;
    const oldUsername = owner.username;

    // Apply changes to owner
    if (ownerName?.trim()) owner.name = ownerName.trim();
    if (ownerEmail?.trim()) owner.email = ownerEmail.trim();
    if (ownerPhone !== undefined) owner.phone = ownerPhone?.trim() || "";
    if (ownerUsername?.trim()) owner.username = ownerUsername.trim().toLowerCase();

    users[ownerIdx] = owner;

    const updates = {};

    // Update users array
    updates[`tenants/${tenantId}/app/users`] = { _v: JSON.stringify(users) };

    // Update biz name if provided
    if (bizName?.trim()) {
      const bizSnap = await db.ref(`tenants/${tenantId}/app/business`).once("value");
      let bizList = [];
      try { bizList = JSON.parse(bizSnap.val()?._v || "[]"); } catch(_) {}
      if (bizList.length > 0) {
        bizList[0].name = bizName.trim();
        updates[`tenants/${tenantId}/app/business`] = { _v: JSON.stringify(bizList) };
      }
    }

    // Update username index if username changed
    if (ownerUsername?.trim() && ownerUsername.trim().toLowerCase() !== oldUsername) {
      const newUn = ownerUsername.trim().toLowerCase();
      updates[`username_index/${oldUsername}`] = null;
      updates[`username_index/${newUn}`] = { tenantId, email: owner.email };
      updates[`tenants/${tenantId}/lookup/${oldUsername}`] = null;
      updates[`tenants/${tenantId}/lookup/${newUn}`] = { email: owner.email, firebaseUid: owner.firebaseUid };
    }

    // Update Firebase Auth email if changed
    if (ownerEmail?.trim() && ownerEmail.trim() !== oldEmail && owner.firebaseUid) {
      try {
        await auth.updateUser(owner.firebaseUid, { email: ownerEmail.trim() });
      } catch(e) {
        console.error("[edit-client] failed to update auth email:", e.message);
        // Continue — RTDB update is still useful
      }
    }

    await db.ref().update(updates);

    console.log(`[edit-client] updated tenant ${tenantId} by ${claims.uid}`);
    res.status(200).json({ ok: true, tenantId });

  } catch(e) {
    console.error("[edit-client] error:", e.message, e.code);
    res.status(500).json({ error: e.message || "שגיאה בעדכון לקוח" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST ?action=delete-client
// ─────────────────────────────────────────────────────────────────────────────
async function handleDeleteClient(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  let claims;
  try { claims = await requireAuth(req); }
  catch (e) {
    console.error("[delete-client] auth failed:", e.message);
    res.status(401).json({ error: "unauthorized" }); return;
  }

  const db   = getAdminDb();
  const auth = getAdminAuth();

  // Verify super_owner
  let isSuperOwner = false;
  try {
    const rolesSnap = await db.ref("tenants").once("value");
    if (rolesSnap.exists()) {
      isSuperOwner = Object.keys(rolesSnap.val()).some(tid =>
        rolesSnap.val()[tid]?.roles?.[claims.uid] === "super_owner"
      );
    }
  } catch(e) { console.error("[delete-client] roles check failed:", e.message); }

  if (!isSuperOwner) {
    res.status(403).json({ error: "forbidden — super_owner only" }); return;
  }

  const { tenantId } = req.body || {};
  if (!tenantId || typeof tenantId !== "string") {
    res.status(400).json({ error: "missing tenantId" }); return;
  }

  try {
    // Read tenant data to find members & lookup entries to clean up
    const tenantSnap = await db.ref(`tenants/${tenantId}`).once("value");
    if (!tenantSnap.exists()) {
      res.status(404).json({ error: "tenant not found" }); return;
    }

    const tenantData = tenantSnap.val();
    const updates = {};

    // Remove tenant node
    updates[`tenants/${tenantId}`] = null;

    // Clean up user_tenants for each member
    const members = tenantData.members || {};
    for (const uid of Object.keys(members)) {
      updates[`user_tenants/${uid}`] = null;
    }

    // Clean up lookup & username_index entries
    const lookupData = tenantData.lookup || {};
    for (const username of Object.keys(lookupData)) {
      updates[`username_index/${username}`] = null;
    }

    await db.ref().update(updates);

    // Try to delete Firebase Auth users (best effort, skip the super_owner who called this)
    let deletedUsers = 0;
    for (const uid of Object.keys(members)) {
      if (uid === claims.uid) continue; // don't delete the super_owner's own account
      try {
        await auth.deleteUser(uid);
        deletedUsers++;
      } catch(e) {
        console.warn(`[delete-client] could not delete auth user ${uid}:`, e.message);
      }
    }

    console.log(`[delete-client] deleted tenant ${tenantId}, ${deletedUsers} auth users`);
    res.status(200).json({ ok: true, tenantId, deletedUsers });

  } catch(e) {
    console.error("[delete-client] error:", e.message);
    res.status(500).json({ error: e.message || "שגיאה במחיקת לקוח" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST ?action=reset-password — super_owner resets a user's password
// ─────────────────────────────────────────────────────────────────────────────
async function handleResetPassword(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  let claims;
  try { claims = await requireAuth(req); }
  catch (e) {
    console.error("[reset-password] auth failed:", e.message);
    res.status(401).json({ error: "unauthorized" }); return;
  }

  const db   = getAdminDb();
  const auth = getAdminAuth();

  // Verify super_owner
  let isSuperOwner = false;
  try {
    const rolesSnap = await db.ref("tenants").once("value");
    if (rolesSnap.exists()) {
      isSuperOwner = Object.keys(rolesSnap.val()).some(tid =>
        rolesSnap.val()[tid]?.roles?.[claims.uid] === "super_owner"
      );
    }
  } catch(e) { console.error("[reset-password] roles check failed:", e.message); }

  if (!isSuperOwner) {
    res.status(403).json({ error: "forbidden — super_owner only" }); return;
  }

  const { firebaseUid, email } = req.body || {};

  if (!firebaseUid && !email) {
    res.status(400).json({ error: "נדרש firebaseUid או email" }); return;
  }

  try {
    // Find user by UID or email
    let userRecord;
    if (firebaseUid) {
      userRecord = await auth.getUser(firebaseUid);
    } else {
      userRecord = await auth.getUserByEmail(email);
    }

    // Generate new temp password
    const newPass = "Marjin_" + Math.random().toString(36).slice(2, 10);

    // Update password in Firebase Auth
    await auth.updateUser(userRecord.uid, { password: newPass });

    console.log(`[reset-password] password reset for ${userRecord.email} by ${claims.uid}`);

    // Send email with new password
    let emailSent = false;
    if (userRecord.email && !userRecord.email.endsWith("@temp.marjin.app") && !userRecord.email.endsWith("@marjin-user.app")) {
      try {
        const html = buildInviteEmailHtml(
          "Marjin",
          userRecord.displayName || userRecord.email,
          newPass,
          APP_BASE_URL + "/?login=1&hint=" + encodeURIComponent(userRecord.displayName || "")
        );
        await sendEmail(userRecord.email, "איפוס סיסמא — Marjin", html);
        emailSent = true;
      } catch(emailErr) {
        console.error("[reset-password] email failed:", emailErr.message);
      }
    }

    res.status(200).json({
      ok: true,
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName || "",
      tempPassword: newPass,
      emailSent,
      message: emailSent
        ? "סיסמא אופסה ונשלחה באימייל בהצלחה"
        : "סיסמא אופסה — העבר את הסיסמא הזמנית ללקוח ידנית"
    });

  } catch(e) {
    console.error("[reset-password] error:", e.message, e.code);
    res.status(500).json({ error: e.message || "שגיאה באיפוס סיסמא" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST ?action=resend-invite — resend Email invite with new temp password
// ─────────────────────────────────────────────────────────────────────────────
async function handleResendInvite(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  let claims;
  try { claims = await requireAuth(req); }
  catch (e) {
    console.error("[resend-invite] auth failed:", e.message);
    res.status(401).json({ error: "unauthorized" }); return;
  }

  const db   = getAdminDb();
  const auth = getAdminAuth();

  // Verify super_owner
  let isSuperOwner = false;
  try {
    const rolesSnap = await db.ref("tenants").once("value");
    if (rolesSnap.exists()) {
      isSuperOwner = Object.keys(rolesSnap.val()).some(tid =>
        rolesSnap.val()[tid]?.roles?.[claims.uid] === "super_owner"
      );
    }
  } catch(e) { console.error("[resend-invite] roles check failed:", e.message); }

  if (!isSuperOwner) {
    res.status(403).json({ error: "forbidden — super_owner only" }); return;
  }

  const { tenantId } = req.body || {};

  if (!tenantId) {
    res.status(400).json({ error: "נדרש tenantId" }); return;
  }

  try {
    // Read tenant data to get user info
    const usersSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
    if (!usersSnap.exists()) {
      res.status(404).json({ error: "טנאנט לא נמצא" }); return;
    }

    let ownerUser, bizName = "";
    try {
      const users = JSON.parse(usersSnap.val()?._v || "[]");
      ownerUser = users.find(u => u.role === "owner" || u.role === "super_owner") || users[0];
    } catch(_) {}

    if (!ownerUser || !ownerUser.firebaseUid) {
      res.status(404).json({ error: "לא נמצא בעלים לטנאנט" }); return;
    }

    // Check owner has a real email
    if (!ownerUser.email || ownerUser.email.endsWith("@temp.marjin.app")) {
      res.status(400).json({ error: "לבעלים אין כתובת אימייל אמיתית — לא ניתן לשלוח הזמנה" });
      return;
    }

    // Get biz name
    try {
      const bizSnap = await db.ref(`tenants/${tenantId}/app/business`).once("value");
      if (bizSnap.exists()) {
        const bizList = JSON.parse(bizSnap.val()?._v || "[]");
        bizName = bizList[0]?.name || "";
      }
    } catch(_) {}

    // Generate new temp password
    const newPass = "Marjin_" + Math.random().toString(36).slice(2, 10);
    await auth.updateUser(ownerUser.firebaseUid, { password: newPass });

    // Get invite link
    const inviteLinkSnap = await db.ref(`tenants/${tenantId}/meta/inviteLink`).once("value");
    const inviteLink = inviteLinkSnap.val() || `${APP_BASE_URL}/?login=1&hint=${encodeURIComponent(ownerUser.username || "")}`;

    // Send Email invite
    let emailSent = false;
    try {
      const html = buildInviteEmailHtml(
        bizName || tenantId,
        ownerUser.username || ownerUser.email,
        newPass,
        inviteLink
      );
      await sendEmail(ownerUser.email, `הזמנה חוזרת ל-Marjin — ${bizName || tenantId}`, html);
      emailSent = true;
    } catch (emailErr) {
      console.error("[resend-invite] Email failed:", emailErr.message);
    }

    console.log(`[resend-invite] invite resent for tenant ${tenantId}, emailSent=${emailSent}`);

    res.status(200).json({
      ok: true,
      tenantId,
      emailSent,
      tempPassword: newPass,
      message: emailSent
        ? "הזמנה נשלחה מחדש בהצלחה באימייל"
        : "הסיסמא אופסה אבל שליחת האימייל נכשלה — העבר את הסיסמא ידנית"
    });

  } catch(e) {
    console.error("[resend-invite] error:", e.message, e.code);
    res.status(500).json({ error: e.message || "שגיאה בשליחת הזמנה" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST ?action=create-user — create a sub-user (owner only, atomic + rollback)
// ─────────────────────────────────────────────────────────────────────────────
const CREATE_USER_ALLOWED_ROLES = ["viewer", "shift_manager", "manager"];

async function handleCreateUser(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  // ── Phase 0: Auth ─────────────────────────────────────────────────────────
  let claims;
  try { claims = await requireAuth(req); }
  catch (e) {
    res.status(401).json({ error: "unauthorized" }); return;
  }

  const { tenantId } = req.body || {};
  if (!tenantId) {
    res.status(400).json({ error: "missing tenantId" }); return;
  }

  // Caller must be owner or super_owner in this tenant
  try {
    await requireTenantAccess(claims.uid, tenantId, "owner");
  } catch (e) {
    res.status(e?.status || 403).json({ error: e?.msg || "forbidden — owner only" }); return;
  }

  // ── Phase 1: Validate input ───────────────────────────────────────────────
  const { email: rawEmail, username: rawUsername, name, phone, role } = req.body || {};

  if (!rawEmail?.trim() || !rawUsername?.trim() || !role) {
    res.status(400).json({ error: "שדות חובה: email, username, role" }); return;
  }

  const safeEmail    = rawEmail.trim().toLowerCase();
  const safeUsername = rawUsername.trim().toLowerCase();

  // Role must be in the allowed sub-user set (never owner/super_owner)
  if (!CREATE_USER_ALLOWED_ROLES.includes(role)) {
    res.status(400).json({
      error: `תפקיד לא חוקי — ערכים מותרים: ${CREATE_USER_ALLOWED_ROLES.join(", ")}`
    }); return;
  }

  // RTDB forbidden characters in username
  if (RTDB_FORBIDDEN.test(safeUsername)) {
    res.status(400).json({ error: "שם משתמש מכיל תווים לא חוקיים" }); return;
  }

  // Minimal email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) {
    res.status(400).json({ error: "כתובת אימייל לא תקינה" }); return;
  }

  // ── Phase 2: Create Firebase Auth user ────────────────────────────────────
  const auth = getAdminAuth();
  const tempPass = "Marjin_" + Math.random().toString(36).slice(2, 10);
  let firebaseUid;

  try {
    const userRecord = await auth.createUser({
      email: safeEmail,
      password: tempPass,
      displayName: safeUsername,
    });
    firebaseUid = userRecord.uid;
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      res.status(409).json({ error: "כתובת האימייל כבר קיימת במערכת" }); return;
    }
    console.error("[create-user] auth.createUser failed:", e.message, e.code);
    res.status(500).json({ error: "שגיאה ביצירת משתמש" }); return;
  }

  // ── Phase 3: Atomic RTDB write (rollback auth user on failure) ────────────
  const db  = getAdminDb();
  const now = Date.now();

  const updates = {};
  updates[`tenants/${tenantId}/members/${firebaseUid}`] = true;
  updates[`tenants/${tenantId}/roles/${firebaseUid}`]   = role;
  updates[`tenants/${tenantId}/users/${firebaseUid}`]   = {
    username:  safeUsername,
    name:      name?.trim() || safeUsername,
    email:     safeEmail,
    phone:     phone?.trim() || "",
    role,
    createdAt: now,
    createdBy: claims.uid,
  };
  updates[`user_tenants/${firebaseUid}`] = tenantId;
  // Lookup indexes (needed for cross-browser login discovery)
  updates[`tenants/${tenantId}/lookup/${safeUsername}`] = { email: safeEmail, firebaseUid };
  updates[`username_index/${safeUsername}`] = { tenantId, email: safeEmail };

  try {
    await db.ref().update(updates);
  } catch (e) {
    // ── Rollback: delete the Firebase Auth user we just created ──────────
    console.error("[create-user] RTDB write failed, rolling back auth user:", e.message);
    try { await auth.deleteUser(firebaseUid); }
    catch (rollbackErr) {
      console.error("[create-user] ROLLBACK FAILED — orphaned uid:", firebaseUid, rollbackErr.message);
    }
    res.status(500).json({ error: "שגיאה בשמירת נתוני המשתמש" }); return;
  }

  // ── Phase 4: Send invite email (non-fatal) ─────────────────────────────
  let emailSent = false;
  let emailAttempted = false;
  const smtpConfigured = !!(process.env.SMTP_EMAIL && process.env.SMTP_APP_PASSWORD);
  console.log(`[create-user][debug] Phase 4 start — smtpConfigured=${smtpConfigured}, SMTP_EMAIL exists=${!!process.env.SMTP_EMAIL}, SMTP_APP_PASSWORD exists=${!!process.env.SMTP_APP_PASSWORD}`);
  try {
    let bizName = "Marjin";
    try {
      const bizSnap = await db.ref(`tenants/${tenantId}/app/business`).once("value");
      if (bizSnap.exists()) {
        const bizList = JSON.parse(bizSnap.val()?._v || "[]");
        if (bizList[0]?.name) bizName = bizList[0].name;
      }
    } catch(_) {}
    const inviteLink = `${APP_BASE_URL}/?login=1&hint=${encodeURIComponent(safeUsername)}`;
    const html = buildInviteEmailHtml(bizName, safeUsername, tempPass, inviteLink);
    console.log(`[create-user][debug] About to call sendEmail to=${safeEmail}, subject length=${(`הזמנה להצטרף ל-${bizName} — פרטי כניסה`).length}, html length=${html.length}`);
    emailAttempted = true;
    await sendEmail(safeEmail, `הזמנה להצטרף ל-${bizName} — פרטי כניסה`, html);
    emailSent = true;
    console.log(`[create-user][debug] sendEmail succeeded for ${safeEmail}`);
  } catch (emailErr) {
    console.error("[create-user] Email invite failed:", emailErr.message);
    console.error("[create-user][debug] Full email error:", emailErr.stack || emailErr);
  }

  console.log(`[create-user] created user ${firebaseUid} (${safeUsername}) in tenant ${tenantId}, role=${role}, emailSent=${emailSent}`);
  res.status(200).json({ ok: true, firebaseUid, tenantId, emailSent, debug: { smtpConfigured, emailAttempted } });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST ?action=complete-profile — first-login: update own email + password
// ─────────────────────────────────────────────────────────────────────────────
async function handleCompleteProfile(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  let claims;
  try { claims = await requireAuth(req); }
  catch (e) {
    res.status(401).json({ error: "unauthorized" }); return;
  }

  const { newEmail, newPassword } = req.body || {};

  if (!newEmail?.trim()) {
    res.status(400).json({ error: "חסרה כתובת אימייל" }); return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
    res.status(400).json({ error: "כתובת אימייל לא תקינה" }); return;
  }
  if (!newPassword || newPassword.length < 6) {
    res.status(400).json({ error: "סיסמה חייבת להיות לפחות 6 תווים" }); return;
  }

  const auth = getAdminAuth();

  try {
    await auth.updateUser(claims.uid, {
      email: newEmail.trim(),
      password: newPassword,
    });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      res.status(409).json({ error: "כתובת האימייל כבר בשימוש" }); return;
    }
    if (e.code === "auth/invalid-email") {
      res.status(400).json({ error: "כתובת אימייל לא תקינה" }); return;
    }
    console.error("[complete-profile] updateUser failed:", e.message, e.code);
    res.status(500).json({ error: "שגיאה בעדכון הפרטים" }); return;
  }

  console.log(`[complete-profile] updated email+password for uid=${claims.uid}`);
  res.status(200).json({ ok: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST ?action=delete-user — fully delete a user (Firebase Auth + RTDB cleanup)
// ─────────────────────────────────────────────────────────────────────────────
async function handleDeleteUser(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  let claims;
  try { claims = await requireAuth(req); }
  catch (e) {
    res.status(401).json({ error: "unauthorized" }); return;
  }

  const db   = getAdminDb();
  const auth = getAdminAuth();

  const { tenantId, firebaseUid, username } = req.body || {};

  console.log(`[delete-user][debug] incoming body:`, JSON.stringify({ tenantId, firebaseUid, username }));

  if (!tenantId || !firebaseUid) {
    console.error(`[delete-user][debug] missing fields — tenantId=${tenantId}, firebaseUid=${firebaseUid}`);
    res.status(400).json({ error: "missing tenantId or firebaseUid" }); return;
  }

  // Verify caller is owner/super_owner in this tenant
  const callerRole = await db.ref(`tenants/${tenantId}/roles/${claims.uid}`).once("value");
  console.log(`[delete-user][debug] callerRole=${callerRole.val()}, callerUid=${claims.uid}`);
  if (!callerRole.exists() || !["owner", "super_owner"].includes(callerRole.val())) {
    res.status(403).json({ error: "forbidden — owner only" }); return;
  }

  // Prevent deleting yourself
  if (firebaseUid === claims.uid) {
    res.status(400).json({ error: "לא ניתן למחוק את עצמך" }); return;
  }

  // ── Phase 1: Delete Firebase Auth user FIRST (frees up the email) ─────
  console.log(`[delete-user][debug] Phase 1: calling auth.deleteUser(${firebaseUid})`);
  try {
    await auth.deleteUser(firebaseUid);
    console.log(`[delete-user][debug] auth.deleteUser SUCCEEDED for ${firebaseUid}`);
  } catch(e) {
    console.error(`[delete-user] auth.deleteUser FAILED for ${firebaseUid}:`, e.message, e.code);
    console.error(`[delete-user][debug] Full auth delete error:`, e.stack || e);
    res.status(500).json({ error: "מחיקת חשבון המשתמש נכשלה — האימייל עדיין תפוס" });
    return;
  }

  // ── Phase 2: Clean up RTDB (only after Auth deletion succeeded) ─────
  try {
    const updates = {};

    // Tenant references
    updates[`tenants/${tenantId}/members/${firebaseUid}`] = null;
    updates[`tenants/${tenantId}/roles/${firebaseUid}`] = null;
    updates[`tenants/${tenantId}/users/${firebaseUid}`] = null;
    updates[`user_tenants/${firebaseUid}`] = null;

    // Username lookup/index
    if (username) {
      const uLower = username.toLowerCase();
      updates[`tenants/${tenantId}/lookup/${uLower}`] = null;
      updates[`username_index/${uLower}`] = null;
    }

    console.log(`[delete-user][debug] Phase 2: RTDB paths to null:`, Object.keys(updates));
    await db.ref().update(updates);

    console.log(`[delete-user] deleted user ${firebaseUid} (username=${username}) from tenant ${tenantId}`);
    res.status(200).json({ ok: true, authDeleted: true, debug: { firebaseUidReceived: firebaseUid, tenantIdReceived: tenantId } });

  } catch(e) {
    // Auth user is already deleted but RTDB cleanup failed — log for manual repair
    console.error(`[delete-user] RTDB cleanup FAILED (auth already deleted) for ${firebaseUid}:`, e.message);
    res.status(500).json({ error: "החשבון נמחק אך ניקוי הנתונים נכשל — יש לפנות לתמיכה" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST ?action=update-user — update an existing user (owner only) — Layer 2
//   Body: { tenantId, firebaseUid, name?, email?, phone?, role?, allowedBizIds? }
//   Auth: caller must be owner or super_owner of `tenantId`.
//   Email change uses Firebase Admin Auth; RTDB updates are atomic; on RTDB
//   failure after Auth change, the email is best-effort reverted in Auth.
//   NOT allowed via this endpoint: username, password, owner/super_owner
//   role assignment, or changing one's own role.
// ─────────────────────────────────────────────────────────────────────────────
async function handleUpdateUser(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  // Phase 0 — Auth
  let claims;
  try { claims = await requireAuth(req); }
  catch (e) {
    res.status(401).json({ error: "unauthorized" }); return;
  }

  const {
    tenantId,
    firebaseUid,
    name,
    email,
    phone,
    role,
    allowedBizIds,
  } = req.body || {};

  if (!tenantId || !firebaseUid) {
    res.status(400).json({ error: "missing tenantId or firebaseUid" }); return;
  }

  const db   = getAdminDb();
  const auth = getAdminAuth();

  // Phase 1 — caller must be owner/super_owner of this tenant.
  //   Direct RTDB role read (same pattern as handleDeleteUser) instead of
  //   requireTenantAccess(), because VALID_ROLES in helpers.js does not include
  //   "super_owner" — using the helper here rejects the only owner in production.
  try {
    const callerRole = await db.ref(`tenants/${tenantId}/roles/${claims.uid}`).once("value");
    if (!callerRole.exists() || !["owner", "super_owner"].includes(callerRole.val())) {
      res.status(403).json({ error: "אין הרשאה לעריכת המשתמש" }); return;
    }
  } catch (e) {
    console.error("[update-user] caller role check failed:", e.message);
    res.status(500).json({ error: "שגיאה בבדיקת הרשאות" }); return;
  }

  // Phase 2 — target user must exist under this tenant.
  //   Primary source: tenants/{tid}/users/{uid}.
  //   Fallback for legacy users that exist only in the aggregated list:
  //     tenants/{tid}/app/users (envelope `_v`).
  //   If the user is found via the fallback, we mark `selfHeal = true` so
  //   Phase 5 writes the missing per-user record (and optionally a missing
  //   role assignment). Tenant isolation is preserved because both paths are
  //   under tenants/{tid}/.
  let currentUser;
  let selfHeal = false;
  let appUsersListCache = null;   // parsed list, cached for Phase 5 reuse
  let appUsersIdxCache  = -1;     // index of target inside cached list
  try {
    const targetSnap = await db.ref(`tenants/${tenantId}/users/${firebaseUid}`).once("value");
    if (targetSnap.exists()) {
      currentUser = targetSnap.val();
    } else {
      // Fallback: search the aggregated list.
      const appSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
      let list = [];
      if (appSnap.exists()) {
        const raw = appSnap.val();
        let listJson = null;
        if (raw && typeof raw === "object" && typeof raw._v === "string") listJson = raw._v;
        else if (typeof raw === "string") listJson = raw;
        if (listJson) {
          try { const parsed = JSON.parse(listJson); if (Array.isArray(parsed)) list = parsed; } catch {}
        }
      }
      const idx = list.findIndex(u => u && u.firebaseUid === firebaseUid);
      if (idx < 0) {
        res.status(404).json({ error: "המשתמש לא נמצא בעסק" }); return;
      }
      // Build a per-user-shaped object from the app/users entry.
      const a = list[idx];
      currentUser = {
        username: a.username || "",
        name:     a.name     || "",
        email:    a.email    || "",
        phone:    a.phone    || "",
        role:     a.role     || "viewer",
      };
      selfHeal = true;
      appUsersListCache = list;
      appUsersIdxCache  = idx;
    }
  } catch (e) {
    console.error("[update-user] target load failed:", e.message);
    res.status(500).json({ error: "שגיאה בטעינת המשתמש" }); return;
  }
  const username = currentUser?.username;

  // Phase 3 — validate inputs and compute diff
  const changedFields = {};

  // Self-role change blocked
  if (role !== undefined && role !== currentUser.role && claims.uid === firebaseUid) {
    res.status(400).json({ error: "לא ניתן לשנות תפקיד של עצמך" }); return;
  }

  // Layer 2 review fix: owner/super_owner role is IMMUTABLE via update-user.
  //   - If role unsent OR identical to current → pass through (allow editing
  //     name/email/phone of an existing owner).
  //   - If trying to change owner/super_owner's role to anything else → reject.
  //   This blocks both downgrade (owner → manager) and lateral moves
  //   (super_owner → owner). Use a dedicated admin flow for those if needed.
  if (
    role !== undefined &&
    role !== currentUser.role &&
    (currentUser.role === "owner" || currentUser.role === "super_owner")
  ) {
    res.status(400).json({
      error: "לא ניתן לשנות תפקיד של בעלים דרך מסך זה"
    });
    return;
  }

  // Role: when set and different, must be in allowed-for-create set
  //   (excludes owner/super_owner — those values themselves are also rejected
  //   here because they're not in CREATE_USER_ALLOWED_ROLES).
  if (role !== undefined && role !== currentUser.role) {
    if (!CREATE_USER_ALLOWED_ROLES.includes(role)) {
      res.status(400).json({
        error: `תפקיד לא חוקי — ערכים מותרים: ${CREATE_USER_ALLOWED_ROLES.join(", ")}`
      });
      return;
    }
    changedFields.role = role;
  }

  // Email
  let emailChanged = false;
  let newEmail = null;
  if (email !== undefined) {
    const safeEmail = String(email).trim().toLowerCase();
    const oldEmailLower = (currentUser.email || "").toLowerCase();
    if (safeEmail && safeEmail !== oldEmailLower) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) {
        res.status(400).json({ error: "כתובת אימייל לא תקינה" }); return;
      }
      if (safeEmail.endsWith("@temp.marjin.app")) {
        res.status(400).json({ error: "לא ניתן להגדיר מייל זמני" }); return;
      }
      emailChanged = true;
      newEmail = safeEmail;
      changedFields.email = safeEmail;
    }
  }

  // Name
  if (name !== undefined) {
    const nm = String(name).trim();
    if (nm && nm !== (currentUser.name || "")) changedFields.name = nm;
  }

  // Phone (allow clearing to empty)
  if (phone !== undefined) {
    const ph = String(phone).trim();
    if (ph !== (currentUser.phone || "")) changedFields.phone = ph;
  }

  // allowedBizIds — for non-owner roles only
  let allowedBizIdsResolved;
  if (allowedBizIds !== undefined) {
    const effectiveRole = changedFields.role || currentUser.role;
    if (effectiveRole === "owner" || effectiveRole === "super_owner") {
      allowedBizIdsResolved = null;
    } else {
      allowedBizIdsResolved = Array.isArray(allowedBizIds) ? allowedBizIds.filter(x => typeof x === "string") : [];
    }
  }

  if (Object.keys(changedFields).length === 0 && allowedBizIdsResolved === undefined && !selfHeal) {
    res.status(200).json({ ok: true, noop: true }); return;
  }

  // Phase 4 — Firebase Auth update (only if email changed)
  const oldEmail = currentUser.email;
  if (emailChanged) {
    try {
      await auth.updateUser(firebaseUid, { email: newEmail });
    } catch (e) {
      if (e.code === "auth/email-already-exists") {
        res.status(409).json({ error: "כתובת האימייל כבר קיימת במערכת" }); return;
      }
      if (e.code === "auth/invalid-email") {
        res.status(400).json({ error: "כתובת אימייל לא תקינה" }); return;
      }
      if (e.code === "auth/user-not-found") {
        res.status(404).json({ error: "משתמש לא נמצא ב-Auth — ייתכן שנמחק. פנה לתמיכה." }); return;
      }
      console.error("[update-user] auth.updateUser failed:", e.message, e.code);
      res.status(500).json({ error: "שגיאה בעדכון Firebase Auth" }); return;
    }
  }

  // Phase 5 — RTDB atomic update
  const now = Date.now();
  const updates = {};

  const newUserRecord = {
    ...currentUser,
    ...changedFields,
    updatedAt: now,
    updatedBy: claims.uid,
  };
  updates[`tenants/${tenantId}/users/${firebaseUid}`] = newUserRecord;

  // RBAC role path — write when role changes; also heal when self-heal mode
  //   AND role is missing at tenants/{tid}/roles/{uid}. Do NOT touch role
  //   if it was not requested AND a value already exists at the role path.
  if (changedFields.role) {
    updates[`tenants/${tenantId}/roles/${firebaseUid}`] = changedFields.role;
  } else if (selfHeal && typeof currentUser.role === "string") {
    const HEAL_VALID_ROLES = new Set(["owner", "super_owner", "manager", "shift_manager", "viewer", "staff"]);
    if (HEAL_VALID_ROLES.has(currentUser.role)) {
      try {
        const roleSnap = await db.ref(`tenants/${tenantId}/roles/${firebaseUid}`).once("value");
        if (!roleSnap.exists()) {
          updates[`tenants/${tenantId}/roles/${firebaseUid}`] = currentUser.role;
        }
      } catch (e) {
        // If the role-path read fails, skip the heal — do not block the update.
        console.warn("[update-user] role-path heal skipped:", e.message);
      }
    }
  }

  // Email-derived secondary indexes
  if (emailChanged && username) {
    const safeUsername = String(username).toLowerCase();
    updates[`tenants/${tenantId}/lookup/${safeUsername}/email`] = newEmail;
    updates[`username_index/${safeUsername}/email`] = newEmail;
  }

  // tenants/{tid}/app/users aggregated list — read-modify-write inside _v envelope.
  //   Cases handled:
  //   1. path exists, user already in list → merge changedFields into existing entry
  //   2. path exists but user not in list → append a fresh entry built from
  //      tenants/{tid}/users/{uid} (self-healing inconsistency)
  //   3. path does not exist at all → create list with this user as the only entry
  //   Whichever path we take, we ALWAYS write back so the aggregated list and
  //   the per-user record stay in sync.
  try {
    // Reuse list parsed during Phase 2 fallback when available; otherwise read fresh.
    let list = appUsersListCache;
    if (list === null) {
      const appUsersSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
      list = [];
      if (appUsersSnap.exists()) {
        const raw = appUsersSnap.val();
        let listJson = null;
        if (raw && typeof raw === "object" && typeof raw._v === "string") listJson = raw._v;
        else if (typeof raw === "string") listJson = raw;
        if (listJson) {
          try { const parsed = JSON.parse(listJson); if (Array.isArray(parsed)) list = parsed; } catch {}
        }
      }
    }
    const idx = (appUsersIdxCache >= 0 && list === appUsersListCache)
      ? appUsersIdxCache
      : list.findIndex(u => u && u.firebaseUid === firebaseUid);
    if (idx >= 0) {
      // Case 1: merge into existing entry
      const merged = { ...list[idx], ...changedFields };
      if (allowedBizIdsResolved !== undefined) merged.allowedBizIds = allowedBizIdsResolved;
      list[idx] = merged;
    } else {
      // Case 2/3: user missing from aggregated list — append a fresh entry
      console.warn(`[update-user] user ${firebaseUid} not found in tenants/${tenantId}/app/users — appending to self-heal inconsistency`);
      list.push({
        id: Date.now() + Math.floor(Math.random() * 1000),
        firebaseUid,
        username: currentUser.username || "",
        name:     newUserRecord.name     || "",
        email:    newUserRecord.email    || "",
        phone:    newUserRecord.phone    || "",
        role:     newUserRecord.role     || "viewer",
        allowedBizIds: (allowedBizIdsResolved !== undefined)
          ? allowedBizIdsResolved
          : (currentUser.allowedBizIds !== undefined ? currentUser.allowedBizIds : null),
      });
    }
    updates[`tenants/${tenantId}/app/users`] = { _v: JSON.stringify(list) };
  } catch (e) {
    console.error("[update-user] app/users merge failed:", e.message);
    // Best-effort revert auth email and bail
    if (emailChanged && oldEmail) {
      try { await auth.updateUser(firebaseUid, { email: oldEmail }); }
      catch (revErr) { console.error("[update-user] Auth revert failed:", revErr.message); }
    }
    res.status(500).json({ error: "שגיאה בעיבוד רשימת המשתמשים — פנה לתמיכה" }); return;
  }

  try {
    await db.ref().update(updates);
  } catch (e) {
    console.error("[update-user] RTDB write failed:", e.message);
    if (emailChanged && oldEmail) {
      try { await auth.updateUser(firebaseUid, { email: oldEmail }); }
      catch (revErr) { console.error("[update-user] Auth revert FAILED — manual repair required:", revErr.message); }
    }
    res.status(500).json({ error: "שגיאה בשמירת המשתמש — פנה לתמיכה" }); return;
  }

  console.log(
    `[update-user] updated user ${firebaseUid} in tenant ${tenantId}, fields=${Object.keys(changedFields).join(",") || "(none)"}` +
    (allowedBizIdsResolved !== undefined ? ",allowedBizIds" : "")
  );
  res.status(200).json({
    ok: true,
    firebaseUid,
    changedFields,
    allowedBizIdsChanged: allowedBizIdsResolved !== undefined,
    ...(selfHeal ? { selfHealed: true } : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST ?action=send-user-invite — send email invite to a new user (any owner)
// ─────────────────────────────────────────────────────────────────────────────
async function handleSendUserInvite(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  let claims;
  try { claims = await requireAuth(req); }
  catch (e) {
    res.status(401).json({ error: "unauthorized" }); return;
  }

  const { email, username, tempPass, bizName, inviteLink } = req.body || {};

  if (!email || !username || !tempPass) {
    res.status(400).json({ error: "missing required fields" }); return;
  }

  try {
    const html = buildInviteEmailHtml(
      bizName || "Marjin",
      username,
      tempPass,
      inviteLink || APP_BASE_URL
    );
    await sendEmail(email, `הזמנה ל-${bizName || "Marjin"} — פרטי כניסה`, html);
    res.status(200).json({ ok: true, emailSent: true });
  } catch(e) {
    console.error("[send-user-invite] email failed:", e.message);
    res.status(200).json({ ok: true, emailSent: false, error: e.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST ?action=roles
// ─────────────────────────────────────────────────────────────────────────────
async function handleRoles(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" }); return;
  }

  let claims;
  try { claims = await requireAuth(req); }
  catch { res.status(401).json({ error: "unauthorized" }); return; }

  const ip = getIP(req);
  try {
    if (await isRateLimited(`roles:ip:${ip}`, 5, 60_000)) {
      res.status(429).json({ error: "too many requests" }); return;
    }
    if (await isRateLimited(`roles:uid:${claims.uid}`, 5, 60_000)) {
      res.status(429).json({ error: "too many requests" }); return;
    }
  } catch (e) {
    res.status(e.status || 503).json({ error: e.msg || "rate limiter error" }); return;
  }

  let body;
  try { body = req.body; if (typeof body === "string") body = JSON.parse(body); }
  catch { res.status(400).json({ error: "invalid json" }); return; }

  const { tenantId, targetUid, role } = body ?? {};

  if (!tenantId || typeof tenantId !== "string" || tenantId.length > 128) {
    res.status(400).json({ error: "invalid tenantId" }); return;
  }
  if (!targetUid || typeof targetUid !== "string" || targetUid.length > 128) {
    res.status(400).json({ error: "invalid targetUid" }); return;
  }
  if (role !== null && !VALID_ROLES.has(role)) {
    res.status(400).json({ error: "invalid role" }); return;
  }
  if (RTDB_FORBIDDEN.test(tenantId) || RTDB_FORBIDDEN.test(targetUid)) {
    res.status(400).json({ error: "invalid characters" }); return;
  }

  try { await requireTenantAccess(claims.uid, tenantId, "owner"); }
  catch (e) {
    res.status(e.status || 403).json({ error: e.msg || "forbidden" }); return;
  }

  const db = getAdminDb();

  if (role !== "owner") {
    let committed = false, txError = null, txAbortReason = null;
    try {
      const result = await db.ref(`tenants/${tenantId}/roles`).transaction(currentRoles => {
        const roles = currentRoles ?? {};
        const owners = Object.entries(roles).filter(([, r]) => r === "owner").map(([uid]) => uid);
        if (owners.length === 1 && owners[0] === targetUid) { txAbortReason = "last-owner"; return undefined; }
        if (role === null) { const updated = { ...roles }; delete updated[targetUid]; return updated; }
        return { ...roles, [targetUid]: role };
      });
      committed = result.committed;
    } catch (e) { txError = e; }

    if (txError) { res.status(503).json({ error: "db transaction failed" }); return; }
    if (!committed) {
      res.status(409).json({ error: txAbortReason === "last-owner"
        ? "cannot remove or downgrade the last owner" : "role update aborted" });
      return;
    }
  } else {
    try { await db.ref(`tenants/${tenantId}/roles/${targetUid}`).set(role); }
    catch (e) { res.status(502).json({ error: "db write failed" }); return; }
  }

  try {
    const auditRef = db.ref(`tenants/${tenantId}/audit/roles`).push();
    await db.ref().update({
      [`tenants/${tenantId}/members/${targetUid}`]: role === null ? null : true,
      [`tenants/${tenantId}/audit/roles/${auditRef.key}`]: {
        ts: Date.now(), actorUid: claims.uid, targetUid, role: role ?? "REMOVED"
      },
    });
  } catch (e) {
    console.error("[admin-roles] membership/audit write failed:", e?.message);
  }

  res.status(200).json({ ok: true, tenantId, targetUid, role });
}

/**
 * /api/admin.js â unified admin endpoint
 *
 * POST ?action=roles            â admin-roles (set/remove user role)
 * POST ?action=create-client    â create new tenant + owner (super_owner only)
 * GET  ?action=list-clients     â list all tenants (super_owner only)
 * POST ?action=delete-client    â delete a tenant (super_owner only)
 * POST ?action=reset-password   â reset user password (super_owner only)
 * POST ?action=resend-invite    â resend Email invite with new temp password (super_owner only)
 * POST ?action=edit-client      â edit tenant details (super_owner only)
 * POST ?action=send-user-invite â send email invite to a new user (any owner)
 * POST ?action=create-user      â create a sub-user (owner only, atomic RTDB + rollback)
 * POST ?action=complete-profile  â first-login: update own email + password (authenticated user)
 * POST ?action=delete-user      â delete a user + Firebase Auth (owner only)
 */

import { requireAuth } from "../lib/verifyToken.js";
import { requireTenantAccess, isRateLimited,
  getIP, VALID_ROLES } from "../lib/helpers.js";
import { getAdminDb, getAdminAuth } from "../lib/adminSdk.js";
import { sendEmail } from "../lib/sendEmail.js";

const RTDB_FORBIDDEN = /[.#$\[\]\/]/;
const APP_BASE_URL   = process.env.APP_BASE_URL || "https://kissgn.vercel.app";

/* ââ HTML template for invite emails âââââââââââââââââââââââââââââââââââââ */
function buildInviteEmailHtml(bizName, username, tempPass, inviteLink) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1);">
  <tr><td style="background:linear-gradient(135deg,#2563eb,#7c3aed);padding:30px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:28px;">Marjin</h1>
    <p style="color:rgba(255,255,255,.85);margin:8px 0 0;font-size:16px;">××¨×××× ××××× ×××¢×¨××ª</p>
  </td></tr>
  <tr><td style="padding:30px;">
    <h2 style="color:#1e293b;margin:0 0 20px;font-size:22px;">ð ×××¨×©×× ×××©××× ×××¦×××!</h2>
    <table width="100%" style="background:#f8fafc;border-radius:8px;padding:20px;margin-bottom:24px;" cellpadding="8">
      <tr><td style="color:#64748b;font-size:14px;width:110px;">×©× ×¢×¡×§</td>
          <td style="color:#1e293b;font-weight:bold;font-size:16px;">${bizName}</td></tr>
      <tr><td style="color:#64748b;font-size:14px;">×©× ××©×ª××©</td>
          <td style="color:#1e293b;font-weight:bold;font-size:16px;">${username}</td></tr>
      <tr><td style="color:#64748b;font-size:14px;">×¡××¡×× ××× ××ª</td>
          <td style="color:#1e293b;font-weight:bold;font-size:16px;direction:ltr;text-align:right;">${tempPass}</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="${inviteLink}" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:18px;font-weight:bold;">×× ××¡× ×××¢×¨××ª â</a>
    </div>
    <p style="color:#ef4444;font-size:14px;text-align:center;margin:16px 0 0;">â ï¸ × × ××××××£ ×¡××¡×× ××××¨ ××× ××¡× ××¨××©×× ×</p>
  </td></tr>
  <tr><td style="background:#f8fafc;padding:20px;text-align:center;border-top:1px solid #e2e8f0;">
    <p style="color:#94a3b8;font-size:12px;margin:0;">Marjin â ××¢×¨××ª × ×××× ×¢×¡×§××ª ××××</p>
  </td></tr>
</table>
</body></html>`;
}

export default async function handler(req, res) {
  // CORS â strict origin, never wildcard with auth
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
  if (action === "roles")             return handleRoles(req, res);
  res.status(400).json({ error: "missing or invalid action" });
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// GET ?action=list-clients
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// POST ?action=create-client
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
    res.status(403).json({ error: "forbidden â super_owner only" }); return;
  }

  const { bizName, ownerName, ownerEmail, ownerUsername, ownerPhone } = req.body || {};

  // ownerEmail is now REQUIRED and must be a real email (not temp)
  if (!bizName?.trim() || !ownerUsername?.trim() || !ownerEmail?.trim()) {
    res.status(400).json({ error: "×©×××ª ××××: ×©× ×¢×¡×§, ×©× ××©×ª××©, ××××××× × ××¨×©××" });
    return;
  }

  if (ownerEmail.trim().endsWith("@temp.marjin.app")) {
    res.status(400).json({ error: "× ××¨×©×ª ××ª×××ª ×××××× ××××ª××ª (×× ××× ××ª)" });
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
      res.status(409).json({ error: "×©× ×××©×ª××© ×××¨ ×ª×¤××¡ â ××© ×××××¨ ×©× ××©×ª××© ×××¨" });
      return;
    }

    // Check if email already exists â do NOT reuse existing accounts (tenant isolation)
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
        res.status(409).json({ error: "××ª×××ª ××××××× ×××¨ ×§××××ª ×××¢×¨××ª â ××© ×××©×ª××© ××××××× ×××¨" });
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
      await sendEmail(safeEmail, `×××× × ×××¦××¨×£ ×-Marjin â ${bizName.trim()}`, html);
      emailSent = true;
    } catch (emailErr) {
      console.error("[create-client] Email failed:", emailErr.message);
    }

    // SECURITY: tempPassword is NEVER returned in JSON â only sent via Email
    res.status(200).json({
      ok: true, tenantId, bizName: bizName.trim(),
      ownerEmail: safeEmail, ownerPhone: ownerPhone?.trim() || "",
      inviteLink, emailSent
    });

  } catch(e) {
    console.error("[create-client] error:", e.message, e.code);
    res.status(500).json({ error: e.message || "×©×××× ×××¦××¨×ª ××§××" });
  }
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// POST ?action=edit-client â edit tenant/owner details (super_owner only)
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
    res.status(403).json({ error: "forbidden â super_owner only" }); return;
  }

  const { tenantId, bizName, ownerName, ownerEmail, ownerPhone, ownerUsername } = req.body || {};

  if (!tenantId || typeof tenantId !== "string") {
    res.status(400).json({ error: "missing tenantId" }); return;
  }

  try {
    // Read current tenant data
    const usersSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
    if (!usersSnap.exists()) {
      res.status(404).json({ error: "×× ×× × ×× × ××¦×" }); return;
    }

    let users = [];
    try { users = JSON.parse(usersSnap.val()?._v || "[]"); } catch(_) {}

    const ownerIdx = users.findIndex(u => u.role === "owner" || u.role === "super_owner");
    if (ownerIdx === -1) {
      res.status(404).json({ error: "×× × ××¦× ××¢××× ××× ×× ×" }); return;
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
        // Continue â RTDB update is still useful
      }
    }

    await db.ref().update(updates);

    console.log(`[edit-client] updated tenant ${tenantId} by ${claims.uid}`);
    res.status(200).json({ ok: true, tenantId });

  } catch(e) {
    console.error("[edit-client] error:", e.message, e.code);
    res.status(500).json({ error: e.message || "×©×××× ××¢×××× ××§××" });
  }
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// POST ?action=delete-client
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
    res.status(403).json({ error: "forbidden â super_owner only" }); return;
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
    res.status(500).json({ error: e.message || "×©×××× ×××××§×ª ××§××" });
  }
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// POST ?action=reset-password â super_owner resets a user's password
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
    res.status(403).json({ error: "forbidden â super_owner only" }); return;
  }

  const { firebaseUid, email } = req.body || {};

  if (!firebaseUid && !email) {
    res.status(400).json({ error: "× ××¨×© firebaseUid ×× email" }); return;
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
        await sendEmail(userRecord.email, "×××¤××¡ ×¡××¡×× â Marjin", html);
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
        ? "×¡××¡×× ×××¤×¡× ×× ×©××× ××××××× ×××¦×××"
        : "×¡××¡×× ×××¤×¡× â ××¢××¨ ××ª ××¡××¡×× ×××× ××ª ×××§×× ××× ××ª"
    });

  } catch(e) {
    console.error("[reset-password] error:", e.message, e.code);
    res.status(500).json({ error: e.message || "×©×××× ××××¤××¡ ×¡××¡××" });
  }
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// POST ?action=resend-invite â resend Email invite with new temp password
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
    res.status(403).json({ error: "forbidden â super_owner only" }); return;
  }

  const { tenantId } = req.body || {};

  if (!tenantId) {
    res.status(400).json({ error: "× ××¨×© tenantId" }); return;
  }

  try {
    // Read tenant data to get user info
    const usersSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
    if (!usersSnap.exists()) {
      res.status(404).json({ error: "×× ×× × ×× × ××¦×" }); return;
    }

    let ownerUser, bizName = "";
    try {
      const users = JSON.parse(usersSnap.val()?._v || "[]");
      ownerUser = users.find(u => u.role === "owner" || u.role === "super_owner") || users[0];
    } catch(_) {}

    if (!ownerUser || !ownerUser.firebaseUid) {
      res.status(404).json({ error: "×× × ××¦× ××¢××× ××× ×× ×" }); return;
    }

    // Check owner has a real email
    if (!ownerUser.email || ownerUser.email.endsWith("@temp.marjin.app")) {
      res.status(400).json({ error: "×××¢××× ××× ××ª×××ª ×××××× ××××ª××ª â ×× × ××ª× ××©××× ×××× ×" });
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
      await sendEmail(ownerUser.email, `×××× × ××××¨×ª ×-Marjin â ${bizName || tenantId}`, html);
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
        ? "×××× × × ×©××× ××××© ×××¦××× ×××××××"
        : "××¡××¡×× ×××¤×¡× ××× ×©××××ª ××××××× × ××©×× â ××¢××¨ ××ª ××¡××¡×× ××× ××ª"
    });

  } catch(e) {
    console.error("[resend-invite] error:", e.message, e.code);
    res.status(500).json({ error: e.message || "×©×××× ××©××××ª ×××× ×" });
  }
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// POST ?action=create-user â create a sub-user (owner only, atomic + rollback)
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const CREATE_USER_ALLOWED_ROLES = ["viewer", "shift_manager", "manager"];

async function handleCreateUser(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  // ââ Phase 0: Auth âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
    res.status(e?.status || 403).json({ error: e?.msg || "forbidden â owner only" }); return;
  }

  // ââ Phase 1: Validate input âââââââââââââââââââââââââââââââââââââââââââââââ
  const { email: rawEmail, username: rawUsername, name, phone, role } = req.body || {};

  if (!rawEmail?.trim() || !rawUsername?.trim() || !role) {
    res.status(400).json({ error: "×©×××ª ××××: email, username, role" }); return;
  }

  const safeEmail    = rawEmail.trim().toLowerCase();
  const safeUsername = rawUsername.trim().toLowerCase();

  // Role must be in the allowed sub-user set (never owner/super_owner)
  if (!CREATE_USER_ALLOWED_ROLES.includes(role)) {
    res.status(400).json({
      error: `×ª×¤×§×× ×× ×××§× â ×¢×¨××× ×××ª×¨××: ${CREATE_USER_ALLOWED_ROLES.join(", ")}`
    }); return;
  }

  // RTDB forbidden characters in username
  if (RTDB_FORBIDDEN.test(safeUsername)) {
    res.status(400).json({ error: "×©× ××©×ª××© ×××× ×ª×××× ×× ×××§×××" }); return;
  }

  // Minimal email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) {
    res.status(400).json({ error: "××ª×××ª ×××××× ×× ×ª×§×× ×" }); return;
  }

  // ââ Phase 2: Create Firebase Auth user ââââââââââââââââââââââââââââââââââââ
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
      res.status(409).json({ error: "××ª×××ª ××××××× ×××¨ ×§××××ª ×××¢×¨××ª" }); return;
    }
    console.error("[create-user] auth.createUser failed:", e.message, e.code);
    res.status(500).json({ error: "×©×××× ×××¦××¨×ª ××©×ª××©" }); return;
  }

  // ââ Phase 3: Atomic RTDB write (rollback auth user on failure) ââââââââââââ
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
    // ââ Rollback: delete the Firebase Auth user we just created ââââââââââ
    console.error("[create-user] RTDB write failed, rolling back auth user:", e.message);
    try { await auth.deleteUser(firebaseUid); }
    catch (rollbackErr) {
      console.error("[create-user] ROLLBACK FAILED â orphaned uid:", firebaseUid, rollbackErr.message);
    }
    res.status(500).json({ error: "×©×××× ××©×××¨×ª × ×ª×× × ×××©×ª××©" }); return;
  }

  // ââ Phase 4: Send invite email (non-fatal) âââââââââââââââââââââââââââââ
  let emailSent = false;
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
    await sendEmail(safeEmail, `×××× × ×××¦××¨×£ ×-${bizName} â ×¤×¨×× ×× ××¡×`, html);
    emailSent = true;
  } catch (emailErr) {
    console.error("[create-user] Email invite failed:", emailErr.message);
  }

  console.log(`[create-user] created user ${firebaseUid} (${safeUsername}) in tenant ${tenantId}, role=${role}, emailSent=${emailSent}`);
  res.status(200).json({ ok: true, firebaseUid, tenantId, emailSent });
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// POST ?action=complete-profile â first-login: update own email + password
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
    res.status(400).json({ error: "××¡×¨× ××ª×××ª ××××××" }); return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
    res.status(400).json({ error: "××ª×××ª ×××××× ×× ×ª×§×× ×" }); return;
  }
  if (!newPassword || newPassword.length < 6) {
    res.status(400).json({ error: "×¡××¡×× ×××××ª ×××××ª ××¤×××ª 6 ×ª××××" }); return;
  }

  const auth = getAdminAuth();

  try {
    await auth.updateUser(claims.uid, {
      email: newEmail.trim(),
      password: newPassword,
    });
  } catch (e) {
    if (e.code === "auth/email-already-exists") {
      res.status(409).json({ error: "××ª×××ª ××××××× ×××¨ ××©××××©" }); return;
    }
    if (e.code === "auth/invalid-email") {
      res.status(400).json({ error: "××ª×××ª ×××××× ×× ×ª×§×× ×" }); return;
    }
    console.error("[complete-profile] updateUser failed:", e.message, e.code);
    res.status(500).json({ error: "×©×××× ××¢×××× ××¤×¨×××" }); return;
  }

  console.log(`[complete-profile] updated email+password for uid=${claims.uid}`);
  res.status(200).json({ ok: true });
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// POST ?action=delete-user â fully delete a user (Firebase Auth + RTDB cleanup)
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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

  if (!tenantId || !firebaseUid) {
    res.status(400).json({ error: "missing tenantId or firebaseUid" }); return;
  }

  // Verify caller is owner/super_owner in this tenant
  const callerRole = await db.ref(`tenants/${tenantId}/roles/${claims.uid}`).once("value");
  if (!callerRole.exists() || !["owner", "super_owner"].includes(callerRole.val())) {
    res.status(403).json({ error: "forbidden â owner only" }); return;
  }

  // Prevent deleting yourself
  if (firebaseUid === claims.uid) {
    res.status(400).json({ error: "×× × ××ª× ×××××§ ××ª ×¢×¦××" }); return;
  }

  // ââ Phase 1: Delete Firebase Auth user FIRST (frees up the email) âââââ
  try {
    await auth.deleteUser(firebaseUid);
  } catch(e) {
    console.error(`[delete-user] auth.deleteUser FAILED for ${firebaseUid}:`, e.message, e.code);
    res.status(500).json({ error: "××××§×ª ××©××× ×××©×ª××© × ××©×× â ××××××× ×¢×××× ×ª×¤××¡" });
    return;
  }

  // ââ Phase 2: Clean up RTDB (only after Auth deletion succeeded) âââââ
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

    await db.ref().update(updates);

    console.log(`[delete-user] deleted user ${firebaseUid} (username=${username}) from tenant ${tenantId}`);
    res.status(200).json({ ok: true, authDeleted: true });

  } catch(e) {
    // Auth user is already deleted but RTDB cleanup failed â log for manual repair
    console.error(`[delete-user] RTDB cleanup FAILED (auth already deleted) for ${firebaseUid}:`, e.message);
    res.status(500).json({ error: "×××©××× × ×××§ ×× × ××§×× ×× ×ª×× ×× × ××©× â ××© ××¤× ××ª ××ª××××" });
  }
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// POST ?action=send-user-invite â send email invite to a new user (any owner)
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
    await sendEmail(email, `×××× × ×-${bizName || "Marjin"} â ×¤×¨×× ×× ××¡×`, html);
    res.status(200).json({ ok: true, emailSent: true });
  } catch(e) {
    console.error("[send-user-invite] email failed:", e.message);
    res.status(200).json({ ok: true, emailSent: false, error: e.message });
  }
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// POST ?action=roles
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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

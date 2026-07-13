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
import { isImplicitAllRole, normalizeAllowedBizIds, bizAccessSetUpdates,
  bizAccessDiffUpdates, bizAccessClearUpdates, bizIdsForUid, parseAppUsers } from "../lib/bizAccess.js";
import { ownerGuardPath, isOwnerAffecting, isOwnerLevel, ownersFromRolesMap,
  opSignatureV2, guardPrepare, guardMirrorFields, guardCompensateClearPending } from "../lib/ownerGuard.js";
import { randomUUID } from "node:crypto";
import { getAdminDb, getAdminAuth } from "../lib/adminSdk.js";
import { isValidBusinessDate, isValidOperationId, isValidExpectedRevision,
  validateSetInput, requestHash as eeRequestHash, safeStateView,
  dateRangeDays, MAX_LIST_RANGE_DAYS } from "../lib/entryExceptions.js";
import { runEntryExceptionTxn, listEntryExceptions } from "../lib/repositories/entryExceptionsRepo.js";
import { readBizDoc, writeBizDoc, readBizDailyRange, getBizDocWithToken, setBizDocGuarded } from "../lib/repositories/bizDataRepo.js";
import { canonicalizeChecklistDocument } from "../lib/checklistVersion.js";
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
  if (action === "bootstrap-self")    return handleBootstrapSelf(req, res);
  if (action === "list-entry-exceptions")  return handleListEntryExceptions(req, res);
  if (action === "set-entry-exception")    return handleSetEntryException(req, res);
  if (action === "clear-entry-exception")  return handleClearEntryException(req, res);
  if (action === "get-checklist-template-items") return handleGetChecklistTemplateItems(req, res);
  if (action === "set-checklist-template-items") return handleSetChecklistTemplateItems(req, res);
  if (action === "get-checklist-run")            return handleGetChecklistRun(req, res);
  if (action === "set-checklist-run")            return handleSetChecklistRun(req, res);
  if (action === "get-checklist-simple-run")     return handleGetChecklistSimpleRun(req, res);
  if (action === "set-checklist-simple-run")     return handleSetChecklistSimpleRun(req, res);
  if (action === "get-analytics-daily")          return handleGetAnalyticsDaily(req, res);
  if (action === "get-insights-daily")           return handleGetInsightsDaily(req, res);
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
  const { email: rawEmail, username: rawUsername, name, phone, role, allowedBizIds } = req.body || {};

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

  // Path-character validation for tenantId (fail closed before any write/Auth).
  if (RTDB_FORBIDDEN.test(tenantId)) {
    res.status(400).json({ error: "invalid characters in tenantId" }); return;
  }

  // Validate allowedBizIds BEFORE creating the Auth user (fail closed — never
  //   leave an orphan Auth account on malformed scope). create-user only creates
  //   scoped roles, so an array (possibly empty) is expected; null/undefined ⇒ no scope.
  let createBiz = [];
  if (Array.isArray(allowedBizIds)) {
    try { createBiz = normalizeAllowedBizIds(allowedBizIds); }
    catch (be) { res.status(be?.status || 400).json({ error: be?.msg || "invalid allowedBizIds" }); return; }
  } else if (allowedBizIds !== undefined && allowedBizIds !== null) {
    res.status(400).json({ error: "invalid allowedBizIds" }); return;
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
    allowedBizIds: createBiz,
    createdAt: now,
    createdBy: claims.uid,
  };
  updates[`user_tenants/${firebaseUid}`] = tenantId;
  // Lookup indexes (needed for cross-browser login discovery)
  updates[`tenants/${tenantId}/lookup/${safeUsername}`] = { email: safeEmail, firebaseUid };
  updates[`username_index/${safeUsername}`] = { tenantId, email: safeEmail };

  // app/users — server-authoritative append so app/users, users/{uid} and
  //   biz_access are persisted in ONE atomic flow (no client/server divergence).
  //   A malformed existing blob stops the create rather than guessing.
  let appUsersList;
  try {
    const appUsersSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
    appUsersList = parseAppUsers(appUsersSnap.val());
  } catch (be) {
    try { await auth.deleteUser(firebaseUid); } catch (_) {}
    res.status(500).json({ error: "רשימת המשתמשים פגומה — פנה לתמיכה" }); return;
  }
  appUsersList.push({
    id: now,
    name: name?.trim() || safeUsername,
    username: safeUsername,
    email: safeEmail,
    phone: phone?.trim() || "",
    role,
    firebaseUid,
    allowedBizIds: createBiz,
    mustCompleteProfile: true,
  });
  updates[`tenants/${tenantId}/app/users`] = { _v: JSON.stringify(appUsersList) };

  // biz_access — server-managed per-business authorization index. Scope was
  //   validated ABOVE (before Auth creation); clients never write biz_access.
  if (!isImplicitAllRole(role)) {
    Object.assign(updates, bizAccessSetUpdates(tenantId, firebaseUid, createBiz));
  }

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
  if (typeof tenantId !== "string" || typeof firebaseUid !== "string" ||
      tenantId.length > 128 || firebaseUid.length > 128 ||
      RTDB_FORBIDDEN.test(tenantId) || RTDB_FORBIDDEN.test(firebaseUid)) {
    res.status(400).json({ error: "invalid tenantId or firebaseUid" }); return;
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

  // Optional idempotency token (owner-affecting deletes should carry one; if absent
  //   the server generates one — retry safety is documented as P1).
  const requestId = (req.body && typeof req.body.requestId === "string") ? req.body.requestId : null;
  if (requestId !== null && (requestId.length > 128 || RTDB_FORBIDDEN.test(requestId))) {
    res.status(400).json({ error: "invalid requestId" }); return;
  }
  const opId = requestId || randomUUID();
  const now = Date.now();

  // ── Determine the target's TRUSTED current role + owner-affecting status ──
  let targetRole = null, rolesMap = {};
  try {
    const rolesSnap = await db.ref(`tenants/${tenantId}/roles`).once("value");
    rolesMap = (rolesSnap.val() && typeof rolesSnap.val() === "object") ? rolesSnap.val() : {};
    targetRole = rolesMap[firebaseUid] ?? null;
  } catch (e) {
    res.status(503).json({ error: "role lookup failed" }); return;
  }
  const ownerAffecting = isOwnerLevel(targetRole); // owner OR super_owner (canonical helper)

  // ── Build the RTDB removal mirror (roles/members/users/user_tenants/lookup/biz_access + audit). ──
  const updates = {};
  updates[`tenants/${tenantId}/members/${firebaseUid}`] = null;
  updates[`tenants/${tenantId}/roles/${firebaseUid}`] = null;
  updates[`tenants/${tenantId}/users/${firebaseUid}`] = null;
  updates[`user_tenants/${firebaseUid}`] = null;
  if (username) {
    const uLower = String(username).toLowerCase();
    updates[`tenants/${tenantId}/lookup/${uLower}`] = null;
    updates[`username_index/${uLower}`] = null;
  }
  // app/users — drop the target entry (keep the human-facing list consistent).
  try {
    const appUsersSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
    const list = parseAppUsers(appUsersSnap.val());
    const filtered = list.filter(u => !(u && u.firebaseUid === firebaseUid));
    updates[`tenants/${tenantId}/app/users`] = { _v: JSON.stringify(filtered) };
  } catch (be) {
    console.error("[delete-user] app/users read failed (malformed?) — aborting to avoid guessing:", be?.message);
    res.status(500).json({ error: "רשימת המשתמשים פגומה — פנה לתמיכה" }); return;
  }
  try {
    const baTreeSnap = await db.ref(`tenants/${tenantId}/biz_access`).once("value");
    Object.assign(updates, bizAccessClearUpdates(tenantId, firebaseUid, bizIdsForUid(baTreeSnap.val(), firebaseUid)));
  } catch (be) { console.error("[delete-user] biz_access clear read failed:", be?.message); }
  const auditKey = ownerAffecting ? opId : db.ref(`tenants/${tenantId}/audit/roles`).push().key;
  updates[`tenants/${tenantId}/audit/roles/${auditKey}`] = {
    ts: now, actorUid: claims.uid, targetUid: firebaseUid, role: "DELETED", opId,
  };

  // ── STEP 1+2: remove RTDB authorization FIRST (owner deletes go through the
  //   durable guard — last-owner is rejected, guard↔roles stay consistent).
  //   Firebase Auth is deleted LAST, only after RTDB authorization is gone. ──
  if (ownerAffecting) {
    const guardOp = { kind: "delete", targetUid: firebaseUid, prevRole: targetRole, nextRole: null,
      opId, seedOwnerUids: ownersFromRolesMap(rolesMap), now };
    const r = await runGuardedOwnerOp(db, tenantId, guardOp, updates);
    if (!r.ok) { res.status(r.status).json({ error: r.code }); return; }
    if (r.idempotent) {
      // RTDB authorization already removed by the first attempt. Ensure the Auth
      //   account is also gone (idempotent), then report success.
      try { await auth.deleteUser(firebaseUid); } catch (e) { if (e.code !== "auth/user-not-found") { res.status(200).json({ ok: true, idempotent: true, authDeleted: false, retryableAuthCleanup: true }); return; } }
      res.status(200).json({ ok: true, idempotent: true, authDeleted: true }); return;
    }
  } else {
    try {
      await db.ref().update(updates);
    } catch (e) {
      console.error("[delete-user] RTDB removal failed:", e?.message);
      res.status(502).json({ error: "db write failed" }); return;
    }
  }

  // ── STEP 3: delete the Firebase Auth user LAST. If this fails, the account
  //   already has NO tenant role/membership/access (authorization is gone); we
  //   report a retryable cleanup condition WITHOUT restoring authorization. ──
  try {
    await auth.deleteUser(firebaseUid);
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      res.status(200).json({ ok: true, authDeleted: true }); return; // already gone — treat as success
    }
    console.error(`[delete-user] auth.deleteUser failed AFTER RTDB removal for ${firebaseUid}:`, e.message, e.code);
    res.status(500).json({ ok: false, authDeleted: false, retryableAuthCleanup: true,
      error: "הרשאות המשתמש הוסרו אך מחיקת חשבון ההתחברות נכשלה — נדרש ניקוי חוזר" }); return;
  }

  console.log(`[delete-user] deleted user ${firebaseUid} (username=${username}) from tenant ${tenantId}`);
  res.status(200).json({ ok: true, authDeleted: true, opId });
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
  if (typeof tenantId !== "string" || typeof firebaseUid !== "string" ||
      tenantId.length > 128 || firebaseUid.length > 128 ||
      RTDB_FORBIDDEN.test(tenantId) || RTDB_FORBIDDEN.test(firebaseUid)) {
    res.status(400).json({ error: "invalid tenantId or firebaseUid" }); return;
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
      // Carry over allowedBizIds from the legacy aggregated entry so the
      //   per-user record created during self-heal contains the same access
      //   set as app/users. Without this, the per-user record is missing the
      //   field forever, and the response keeps reporting
      //   allowedBizIdsChanged:true on every save even when the value is
      //   unchanged. null is preserved (legitimate for owner/super_owner);
      //   arrays are filtered to strings only.
      if (a.allowedBizIds !== undefined) {
        currentUser.allowedBizIds = Array.isArray(a.allowedBizIds)
          ? a.allowedBizIds.filter(x => typeof x === "string")
          : a.allowedBizIds;
      }
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
    // Owner-affecting role changes (e.g. downgrading an existing owner) must NOT
    //   bypass the durable owner guard. update-user cannot set owner (not in
    //   CREATE_USER_ALLOWED_ROLES); the only owner-affecting case is downgrading
    //   a current owner — route those through the guarded roles endpoint.
    if (isOwnerAffecting(currentUser.role, role)) {
      res.status(409).json({ error: "owner_role_change_requires_roles_endpoint" }); return;
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

  // Compute whether allowedBizIds actually changed (vs. just being echoed
  //   back from the form). Previously the response set
  //   `allowedBizIdsChanged: allowedBizIdsResolved !== undefined`, which
  //   meant "was sent" not "was different". With the Phase-2 self-heal
  //   copy above, currentUser.allowedBizIds is now populated for legacy
  //   users too, so this comparison is meaningful on the first save as
  //   well as on later ones.
  let allowedBizIdsActuallyChanged = false;
  if (allowedBizIdsResolved !== undefined) {
    const prev = currentUser.allowedBizIds;
    if (allowedBizIdsResolved === null) {
      allowedBizIdsActuallyChanged = (prev !== null && prev !== undefined);
    } else {
      // resolved is an array
      if (!Array.isArray(prev)) {
        // null/undefined → array counts as a change (first-time write)
        allowedBizIdsActuallyChanged = true;
      } else if (prev.length !== allowedBizIdsResolved.length) {
        allowedBizIdsActuallyChanged = true;
      } else {
        const aSorted = [...prev].slice().sort();
        const bSorted = [...allowedBizIdsResolved].slice().sort();
        for (let i = 0; i < aSorted.length; i++) {
          if (aSorted[i] !== bSorted[i]) { allowedBizIdsActuallyChanged = true; break; }
        }
      }
    }
  }

  if (Object.keys(changedFields).length === 0 && !allowedBizIdsActuallyChanged && !selfHeal) {
    res.status(200).json({ ok: true, noop: true }); return;
  }

  // Phase 4 — Firebase Auth update (only if email changed)
  const oldEmail = currentUser.email;
  if (emailChanged) {
    // Pre-flight collision check against tenants/{tid}/app/users.
    //   Firebase Auth alone is not sufficient: legacy users (e.g. those with
    //   `mustCompleteProfile:true`) may have a public email recorded in
    //   app/users that was never written to Firebase Auth, or whose Auth
    //   email is a temp/`@temp.marjin.app` alias. In those cases
    //   `auth.updateUser` succeeds and we silently steal the public email.
    //   This check looks ONLY at the aggregated app/users list for the same
    //   tenant — same scope as the data we'd corrupt. It must run BEFORE
    //   auth.updateUser, and on collision we return without touching Auth
    //   or RTDB. Self-collisions (same firebaseUid) are not blocked here:
    //   when `emailChanged` is true the email is already different from
    //   currentUser.email, but the duplicate-firebaseUid guard is kept for
    //   safety in case future refactors loosen that invariant.
    try {
      const newEmailLower = String(newEmail).trim().toLowerCase();
      const appUsersCollisionSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
      if (appUsersCollisionSnap.exists()) {
        const raw = appUsersCollisionSnap.val();
        let listJson = null;
        if (raw && typeof raw === "object" && typeof raw._v === "string") listJson = raw._v;
        else if (typeof raw === "string") listJson = raw;
        if (listJson) {
          let list = [];
          try { const parsed = JSON.parse(listJson); if (Array.isArray(parsed)) list = parsed; } catch {}
          const collision = list.some(u =>
            u &&
            u.firebaseUid !== firebaseUid &&
            String(u.email || "").trim().toLowerCase() === newEmailLower
          );
          if (collision) {
            res.status(409).json({ error: "כתובת האימייל כבר קיימת במערכת" }); return;
          }
        }
      }
    } catch (e) {
      // Read failure on the collision check is not fatal — fall through to
      //   auth.updateUser, which still has its own auth/email-already-exists
      //   guard. We log so the silent-failure mode is debuggable.
      console.warn("[update-user] app/users collision pre-check skipped:", e.message);
    }

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
  // Mirror allowedBizIds into the per-user record whenever it was sent —
  //   `changedFields` only tracks scalar fields (name/email/phone/role), so
  //   without this the per-user copy of allowedBizIds would drift behind the
  //   aggregated app/users list. We only WRITE; we don't strip the field
  //   when it's absent from the request, which preserves whatever
  //   currentUser already carried (including the Phase-2 self-heal copy).
  if (allowedBizIdsResolved !== undefined) {
    newUserRecord.allowedBizIds = allowedBizIdsResolved;
  }
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

  // ── biz_access mirror — server-managed per-business authorization index ──
  //   Merged into the SAME atomic update batch as app/users so the human-facing
  //   list and the rule-readable index never diverge on a successful write.
  //   Clients never write biz_access (database.rules.json `.write:false`).
  {
    const prevRoleBA = currentUser.role;
    const effectiveRoleBA = changedFields.role || currentUser.role;
    try {
      if (isImplicitAllRole(effectiveRoleBA)) {
        // owner/super_owner ⇒ implicit ALL-business; clear any lingering scoped entries.
        const treeSnap = await db.ref(`tenants/${tenantId}/biz_access`).once("value");
        Object.assign(updates, bizAccessClearUpdates(tenantId, firebaseUid, bizIdsForUid(treeSnap.val(), firebaseUid)));
      } else {
        const downgradeFromImplicit = isImplicitAllRole(prevRoleBA);
        if (allowedBizIdsResolved === undefined) {
          if (downgradeFromImplicit) {
            res.status(400).json({ error: "יש להגדיר הרשאות עסק בעת שינוי לתפקיד מוגבל" }); return;
          }
          // no allowedBizIds change requested ⇒ leave biz_access untouched
        } else {
          const nextBiz = normalizeAllowedBizIds(allowedBizIdsResolved);
          if (downgradeFromImplicit) {
            Object.assign(updates, bizAccessSetUpdates(tenantId, firebaseUid, nextBiz));
          } else {
            const prevBiz = Array.isArray(currentUser.allowedBizIds) ? normalizeAllowedBizIds(currentUser.allowedBizIds) : [];
            Object.assign(updates, bizAccessDiffUpdates(tenantId, firebaseUid, prevBiz, nextBiz));
          }
        }
      }
    } catch (be) {
      if (be && be.status) { res.status(be.status).json({ error: be.msg }); return; }
      console.error("[update-user] biz_access sync failed:", be?.message);
      res.status(500).json({ error: "שגיאה בעדכון הרשאות עסק" }); return;
    }
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
    (allowedBizIdsActuallyChanged ? ",allowedBizIds" : "")
  );
  res.status(200).json({
    ok: true,
    firebaseUid,
    changedFields,
    allowedBizIdsChanged: allowedBizIdsActuallyChanged,
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
// POST ?action=bootstrap-self — self-service first-owner bootstrap (Admin SDK).
//   Writes the canonical roles/{uid}=super_owner + members/{uid}=true so that
//   `roles` can be fully server-managed (clients no longer write roles directly).
//   Only permitted on an UNINITIALIZED tenant (no existing roles) — equivalent to
//   the old `!data.exists()` bootstrap rule, but enforced server-side and no
//   weaker. Also seeds the owner guard so the first principal is authoritative.
// ─────────────────────────────────────────────────────────────────────────────
async function handleBootstrapSelf(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  let claims;
  try { claims = await requireAuth(req); }
  catch { res.status(401).json({ error: "unauthorized" }); return; }

  const { tenantId } = req.body || {};
  if (!tenantId || typeof tenantId !== "string" || tenantId.length > 128 || RTDB_FORBIDDEN.test(tenantId)) {
    res.status(400).json({ error: "invalid tenantId" }); return;
  }
  const db = getAdminDb();
  try {
    const rolesSnap = await db.ref(`tenants/${tenantId}/roles`).once("value");
    if (rolesSnap.exists() && rolesSnap.hasChildren()) {
      res.status(409).json({ error: "tenant_already_initialized" }); return; // cannot claim an initialized tenant
    }
  } catch (e) {
    console.error("[bootstrap-self] roles check failed:", e?.message);
    res.status(503).json({ error: "bootstrap check failed" }); return;
  }

  const now = Date.now();
  const uid = claims.uid;
  const updates = {};
  updates[`tenants/${tenantId}/roles/${uid}`]   = "super_owner";
  updates[`tenants/${tenantId}/members/${uid}`] = true;
  updates[`user_tenants/${uid}`] = tenantId;
  // Seed the owner guard: the bootstrapping super_owner is an owner-level principal.
  updates[`tenants/${tenantId}/access_meta/owner_guard`] = {
    version: 1, ownerUids: { [uid]: true }, updatedAt: now, lastOpId: null, ops: {}, pending: null,
  };
  try { await db.ref().update(updates); }
  catch (e) { console.error("[bootstrap-self] write failed:", e?.message); res.status(500).json({ error: "bootstrap failed" }); return; }

  res.status(200).json({ ok: true, tenantId, role: "super_owner" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared durable owner-operation runner (used by handleRoles + handleDeleteUser).
//   PREPARE (transaction) → MIRROR (ONE atomic root update incl. guard finalize)
//   → COMPENSATE on failure. Returns { ok, status, code, idempotent }.
//   A crash between PREPARE and MIRROR leaves a durable `prepared` pending that a
//   retry with the same requestId RESUMES; other owner ops are blocked meanwhile.
// ─────────────────────────────────────────────────────────────────────────────
async function runGuardedOwnerOp(db, tenantId, guardOp, baseUpdates) {
  const gpath = ownerGuardPath(tenantId);
  guardOp.sig = opSignatureV2(guardOp);

  // ── PREPARE ──
  let decision = null, code = null;
  try {
    const tx = await db.ref(gpath).transaction((cur) => {
      const r = guardPrepare(cur, guardOp);
      decision = r.decision; code = r.code || null;
      return r.decision === "commit" ? r.value : undefined; // commit records prepared; others ABORT
    }, undefined, false);
    if (tx.committed) decision = "commit";
  } catch (e) {
    console.error("[owner-op] prepare transaction error:", e?.message);
    return { ok: false, status: 503, code: "owner_guard_unavailable" };
  }
  const MAP = { last_owner: 409, stale_version: 409, opId_conflict: 409, owner_op_pending: 423 };
  if (decision === "reject")     return { ok: false, status: MAP[code] || 409, code };
  if (decision === "idempotent") return { ok: true, idempotent: true };

  // decision is "commit" or "resume" → we own the prepared pending.
  const preparedGuard = (await db.ref(gpath).once("value")).val();
  let mirrorFields;
  try { mirrorFields = guardMirrorFields(tenantId, guardOp, preparedGuard); }
  catch (e) { return { ok: false, status: 409, code: "owner_op_pending" }; } // not prepared for us → never report success

  // ── MIRROR: one atomic root update (base mirror + guard finalize together) ──
  try {
    await db.ref().update({ ...baseUpdates, ...mirrorFields });
    return { ok: true };
  } catch (e) {
    console.error("[owner-op] mirror write failed:", e?.message);
    // ── COMPENSATE: clear the prepared pending (ownerUids never advanced). ──
    try { await db.ref(gpath).transaction((cur) => guardCompensateClearPending(cur, guardOp)); }
    catch (ce) { console.error("[owner-op] compensation failed — pending remains for reconciliation:", ce?.message); }
    return { ok: false, status: 502, code: "db_write_failed" };
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

  // Optional idempotency token + optimistic version (both may be absent — see
  //   the idempotency note in owner-invariant-implementation.md).
  const requestId = (body && typeof body.requestId === "string") ? body.requestId : null;
  if (requestId !== null && (requestId.length > 128 || RTDB_FORBIDDEN.test(requestId))) {
    res.status(400).json({ error: "invalid requestId" }); return;
  }
  const expectedVersion = (body && Number.isInteger(body.expectedVersion)) ? body.expectedVersion : undefined;
  const opId = requestId || randomUUID();

  // ── Prepare the atomic root mirror (roles + members + audit + biz_access +
  //   app/users). Owner membership is guarded SEPARATELY below via a Firebase
  //   transaction on tenants/{tid}/access_meta/owner_guard, which makes the
  //   "at least one owner" invariant concurrency-safe (a plain pre-read of
  //   `roles` is NOT). A malformed app/users blob stops the change (no guessing).
  const updates = {};
  let prevRole, rolesMap, ownerAffecting;
  const guardOp = { kind: "roles", targetUid, nextRole: role, opId, expectedVersion, now: Date.now() };
  try {
    const [rolesSnap, baTreeSnap, appUsersSnap] = await Promise.all([
      db.ref(`tenants/${tenantId}/roles`).once("value"),
      db.ref(`tenants/${tenantId}/biz_access`).once("value"),
      db.ref(`tenants/${tenantId}/app/users`).once("value"),
    ]);
    rolesMap = (rolesSnap.val() && typeof rolesSnap.val() === "object") ? rolesSnap.val() : {};
    prevRole = rolesMap[targetUid];
    guardOp.prevRole = prevRole;
    guardOp.seedOwnerUids = ownersFromRolesMap(rolesMap);
    ownerAffecting = isOwnerAffecting(prevRole, role);

    // biz_access + resolved scope (validated FIRST so an invalid scope fails
    //   closed BEFORE the owner-guard transaction — nothing to compensate).
    const existingBiz = bizIdsForUid(baTreeSnap.val(), targetUid);
    let resolvedScope; // undefined = leave app/users scope as-is; null = implicit-all; array = scoped
    if (role === null) {
      Object.assign(updates, bizAccessClearUpdates(tenantId, targetUid, existingBiz));
    } else if (isImplicitAllRole(role)) {
      Object.assign(updates, bizAccessClearUpdates(tenantId, targetUid, existingBiz));
      resolvedScope = null;
    } else if (isImplicitAllRole(prevRole)) {
      let nextBiz;
      try { nextBiz = normalizeAllowedBizIds(body.allowedBizIds); }
      catch { res.status(400).json({ error: "יש להגדיר הרשאות עסק בעת הורדת תפקיד" }); return; }
      if (nextBiz.length < 1) { res.status(400).json({ error: "יש להגדיר לפחות עסק אחד בעת הורדת תפקיד" }); return; }
      Object.assign(updates, bizAccessDiffUpdates(tenantId, targetUid, existingBiz, nextBiz)); // clears stale, adds new
      resolvedScope = nextBiz;
    } else if (body.allowedBizIds !== undefined) {
      const nextBiz = normalizeAllowedBizIds(body.allowedBizIds);
      Object.assign(updates, bizAccessDiffUpdates(tenantId, targetUid, existingBiz, nextBiz));
      resolvedScope = nextBiz;
    }
    // scoped → scoped without allowedBizIds ⇒ preserve existing scope (no change).

    // role + membership + audit. Audit key = opId for owner-affecting changes so
    //   an identical retry overwrites the SAME event (no duplicate audit).
    updates[`tenants/${tenantId}/roles/${targetUid}`]   = role; // null removes the key
    updates[`tenants/${tenantId}/members/${targetUid}`] = role === null ? null : true;
    const auditKey = ownerAffecting ? opId : db.ref(`tenants/${tenantId}/audit/roles`).push().key;
    updates[`tenants/${tenantId}/audit/roles/${auditKey}`] = {
      ts: Date.now(), actorUid: claims.uid, targetUid, role: role ?? "REMOVED", opId,
    };

    // app/users sync — keep the human-facing list consistent with roles + biz_access.
    const list = parseAppUsers(appUsersSnap.val());
    const idx = list.findIndex(u => u && u.firebaseUid === targetUid);
    if (role === null) {
      if (idx >= 0) list.splice(idx, 1);
    } else if (idx >= 0) {
      const merged = { ...list[idx], role };
      if (resolvedScope !== undefined) merged.allowedBizIds = resolvedScope;
      list[idx] = merged;
    }
    updates[`tenants/${tenantId}/app/users`] = { _v: JSON.stringify(list) };
  } catch (be) {
    if (be && be.status) { res.status(be.status).json({ error: be.msg }); return; }
    console.error("[admin-roles] role change preparation failed:", be?.message);
    res.status(500).json({ error: "role update failed" }); return;
  }

  // ── Owner-affecting changes go through the shared durable guard (prepare →
  //   atomic mirror+finalize → compensate). Non-owner-affecting changes take the
  //   plain atomic mirror (no guard).
  if (ownerAffecting) {
    const r = await runGuardedOwnerOp(db, tenantId, guardOp, updates);
    if (!r.ok) { res.status(r.status).json({ error: r.code }); return; }
    res.status(200).json({ ok: true, tenantId, targetUid, role, opId, ...(r.idempotent ? { idempotent: true } : {}) });
    return;
  }

  try {
    await db.ref().update(updates);
  } catch (e) {
    console.error("[admin-roles] atomic role update failed:", e?.message);
    res.status(502).json({ error: "db write failed" }); return;
  }
  res.status(200).json({ ok: true, tenantId, targetUid, role, opId });
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured entry exceptions (schema v1) — server-authoritative, biz-scoped.
//   Reads: viewer+ within authorized business. Writes: manager+ within authorized
//   business. Business access is fail-closed via the structured biz_access index
//   (owner/super_owner ⇒ implicit all-biz). user_tenants/user_active_biz grant no
//   authority. Direct client writes are denied by Rules; Admin SDK bypasses.
// ─────────────────────────────────────────────────────────────────────────────
async function requireBizAccess(db, tenantId, bizId, uid, role) {
  if (isImplicitAllRole(role)) return true; // owner / super_owner ⇒ all businesses
  const snap = await db.ref(`tenants/${tenantId}/biz_access/${bizId}/${uid}`).once("value");
  if (snap.val() === true) return true;      // structured, fail-closed
  throw { status: 403, msg: "business_access_denied" };
}
function eeValidIds(tenantId, bizId) {
  return typeof tenantId === "string" && typeof bizId === "string" &&
    tenantId.length <= 128 && bizId.length <= 128 &&
    !RTDB_FORBIDDEN.test(tenantId) && !RTDB_FORBIDDEN.test(bizId);
}

async function handleListEntryExceptions(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  let claims;
  try { claims = await requireAuth(req); } catch { res.status(401).json({ error: "unauthorized" }); return; }
  const tenantId = req.query.tenantId, bizId = req.query.bizId;
  const fromDate = req.query.fromDate, toDate = req.query.toDate;
  if (!eeValidIds(tenantId, bizId)) { res.status(400).json({ error: "invalid tenantId or bizId" }); return; }
  if (!isValidBusinessDate(fromDate)) { res.status(400).json({ error: "invalid_from_date" }); return; }
  if (!isValidBusinessDate(toDate)) { res.status(400).json({ error: "invalid_to_date" }); return; }
  const __rangeDays = dateRangeDays(fromDate, toDate);
  if (__rangeDays < 0) { res.status(400).json({ error: "reversed_range" }); return; }
  if (__rangeDays > MAX_LIST_RANGE_DAYS) { res.status(400).json({ error: "range_too_large" }); return; }
  let role;
  try { role = await requireTenantAccess(claims.uid, tenantId, "viewer"); }
  catch (e) { res.status(e?.status || 403).json({ error: e?.msg || "forbidden" }); return; }
  const db = getAdminDb();
  try { await requireBizAccess(db, tenantId, bizId, claims.uid, role); }
  catch (e) { res.status(e?.status || 403).json({ error: e?.msg || "business_access_denied" }); return; }
  try {
    const exceptions = await listEntryExceptions({ tenantId, bizId, fromDate, toDate });
    res.status(200).json({ ok: true, tenantId, bizId, fromDate, toDate, exceptions });
  } catch (e) {
    console.error("[list-entry-exceptions]", e?.message);
    res.status(500).json({ error: "list_failed" });
  }
}

async function eeAuthorizeWrite(req, res) {
  let claims;
  try { claims = await requireAuth(req); } catch { res.status(401).json({ error: "unauthorized" }); return null; }
  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { res.status(400).json({ error: "invalid json" }); return null; } }
  body = body || {};
  const { tenantId, bizId, businessDate, expectedRevision, operationId } = body;
  if (!eeValidIds(tenantId, bizId)) { res.status(400).json({ error: "invalid tenantId or bizId" }); return null; }
  if (!isValidBusinessDate(businessDate)) { res.status(400).json({ error: "invalid_business_date" }); return null; }
  if (!isValidOperationId(operationId)) { res.status(400).json({ error: "invalid_operation_id" }); return null; }
  if (!isValidExpectedRevision(expectedRevision)) { res.status(400).json({ error: "invalid_expected_revision" }); return null; }
  let role;
  try { role = await requireTenantAccess(claims.uid, tenantId, "manager"); }
  catch (e) { res.status(e?.status || 403).json({ error: e?.msg || "forbidden" }); return null; }
  const db = getAdminDb();
  try { await requireBizAccess(db, tenantId, bizId, claims.uid, role); }
  catch (e) { res.status(e?.status || 403).json({ error: e?.msg || "business_access_denied" }); return null; }
  return { claims, role, body, tenantId, bizId, businessDate, expectedRevision, operationId };
}

function eeRespond(res, outcome) {
  if (outcome.outcome === "conflict") {
    const map = { revision_conflict: 409, idempotency_conflict: 409, operation_owner_required: 409, operation_hard_limit_reached: 409, txn_failed: 502 };
    res.status(map[outcome.code] || 409).json({ ok: false, error: outcome.code });
    return;
  }
  const applied = outcome.outcome === "applied";
  res.status(200).json({
    ok: true,
    exception: safeStateView(outcome.state),
    revision: outcome.revision,
    applied,
    replayed: outcome.outcome === "replayed",
    rebuildRequired: applied, // rebuild only when a NEW transition was applied (not on replay)
  });
}

async function handleSetEntryException(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const ctx = await eeAuthorizeWrite(req, res); if (!ctx) return;
  let normalized;
  try { normalized = validateSetInput({ reasonCode: ctx.body.reasonCode, reasonText: ctx.body.reasonText }); }
  catch (e) { res.status(400).json({ error: e?.code || "invalid_input" }); return; }
  const cmd = {
    action: "set", tenantId: ctx.tenantId, bizId: ctx.bizId, businessDate: ctx.businessDate,
    reasonCode: normalized.reasonCode, reasonText: normalized.reasonText,
    actorUid: ctx.claims.uid, actorRole: ctx.role,
    expectedRevision: ctx.expectedRevision, operationId: ctx.operationId, now: Date.now(),
  };
  cmd.requestHash = eeRequestHash(cmd);
  const outcome = await runEntryExceptionTxn(cmd);
  eeRespond(res, outcome);
}

async function handleClearEntryException(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const ctx = await eeAuthorizeWrite(req, res); if (!ctx) return;
  const cmd = {
    action: "clear", tenantId: ctx.tenantId, bizId: ctx.bizId, businessDate: ctx.businessDate,
    reasonCode: null, reasonText: null,
    actorUid: ctx.claims.uid, actorRole: ctx.role,
    expectedRevision: ctx.expectedRevision, operationId: ctx.operationId, now: Date.now(),
  };
  cmd.requestHash = eeRequestHash(cmd);
  const outcome = await runEntryExceptionTxn(cmd);
  eeRespond(res, outcome);
}

// ─────────────────────────────────────────────────────────────────────────────
// Server-mediated PARAMETERIZED business data (checklist_* + analytics/insights).
//   Rules deny direct client access (bizId can't be extracted from these flat
//   keys); the Admin SDK is the only reader/writer. Auth + tenant + authoritative
//   biz_access are enforced; paths are CONSTRUCTED from validated ids only.
// ─────────────────────────────────────────────────────────────────────────────
const BIZDATA_MAX_DOC = 200000;
function bizDataValidTemplateId(id) { return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id) && !RTDB_FORBIDDEN.test(id); }

// Shared read auth (GET): viewer+ within an authorized business.
async function bizDataAuthRead(req, res, tenantId, bizId) {
  let claims;
  try { claims = await requireAuth(req); } catch { res.status(401).json({ error: "unauthorized" }); return null; }
  if (!eeValidIds(tenantId, bizId)) { res.status(400).json({ error: "invalid tenantId or bizId" }); return null; }
  let role;
  try { role = await requireTenantAccess(claims.uid, tenantId, "viewer"); }
  catch (e) { res.status(e?.status || 403).json({ error: e?.msg || "forbidden" }); return null; }
  const db = getAdminDb();
  try { await requireBizAccess(db, tenantId, bizId, claims.uid, role); }
  catch (e) { res.status(e?.status || 403).json({ error: e?.msg || "business_access_denied" }); return null; }
  return { claims, role, db };
}
// Shared write auth (POST): minRole ("manager" | "shift_manager") within an authorized business.
async function bizDataAuthWrite(req, res, minRole) {
  let claims;
  try { claims = await requireAuth(req); } catch { res.status(401).json({ error: "unauthorized" }); return null; }
  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { res.status(400).json({ error: "invalid json" }); return null; } }
  body = body || {};
  const { tenantId, bizId } = body;
  if (!eeValidIds(tenantId, bizId)) { res.status(400).json({ error: "invalid tenantId or bizId" }); return null; }
  let role;
  try { role = await requireTenantAccess(claims.uid, tenantId, minRole); }
  catch (e) { res.status(e?.status || 403).json({ error: e?.msg || "forbidden" }); return null; }
  const db = getAdminDb();
  try { await requireBizAccess(db, tenantId, bizId, claims.uid, role); }
  catch (e) { res.status(e?.status || 403).json({ error: e?.msg || "business_access_denied" }); return null; }
  return { claims, role, db, body, tenantId, bizId };
}
function validVersionToken(t) { return typeof t === "string" && /^[a-f0-9]{64}$/.test(t); }
function bizDataValidDoc(res, doc) {
  // Checklist docs are OBJECTS (never null for set, never a top-level array).
  if (doc == null || typeof doc !== "object" || Array.isArray(doc)) { res.status(400).json({ error: "invalid_doc" }); return false; }
  let str; try { str = JSON.stringify(doc); } catch { res.status(400).json({ error: "invalid_doc" }); return false; } // cyclic
  if (typeof str !== "string") { res.status(400).json({ error: "invalid_doc" }); return false; }
  if (Buffer.byteLength(str, "utf8") > BIZDATA_MAX_DOC) { res.status(400).json({ error: "doc_too_large" }); return false; } // UTF-8 bytes
  try { canonicalizeChecklistDocument(doc); } // rejects cyclic / non-JSON / prototype-pollution keys at any depth
  catch (e) { res.status(400).json({ error: e && e.code === "forbidden_key" ? "forbidden_key" : "invalid_doc" }); return false; }
  return true;
}
function bizDataConflictOrWrite(res, r, doc) {
  if (r.conflict) { res.status(409).json({ ok: false, error: "checklist_conflict" }); return; }
  if (!r.ok) { res.status(500).json({ error: "write_failed" }); return; }
  res.status(200).json({ ok: true, document: doc, versionToken: r.versionToken });
}

async function handleGetChecklistTemplateItems(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const { tenantId, bizId, templateId } = req.query;
  if (!bizDataValidTemplateId(templateId)) { res.status(400).json({ error: "invalid_template_id" }); return; }
  const ctx = await bizDataAuthRead(req, res, tenantId, bizId); if (!ctx) return;
  try { const { document, versionToken } = await getBizDocWithToken(tenantId, bizId, `checklist_template_items:${templateId}`); res.status(200).json({ ok: true, document, versionToken }); }
  catch (e) { res.status(500).json({ error: "read_failed" }); }
}
async function handleSetChecklistTemplateItems(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const ctx = await bizDataAuthWrite(req, res, "manager"); if (!ctx) return;
  const { templateId, doc, expectedVersionToken } = ctx.body;
  if (!bizDataValidTemplateId(templateId)) { res.status(400).json({ error: "invalid_template_id" }); return; }
  if (!validVersionToken(expectedVersionToken)) { res.status(400).json({ error: "invalid_version_token" }); return; }
  if (!bizDataValidDoc(res, doc)) return;
  try { bizDataConflictOrWrite(res, await setBizDocGuarded(ctx.tenantId, ctx.bizId, `checklist_template_items:${templateId}`, doc, expectedVersionToken), doc); }
  catch (e) { res.status(500).json({ error: "write_failed" }); }
}
async function handleGetChecklistRun(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const { tenantId, bizId, businessDate } = req.query;
  if (!isValidBusinessDate(businessDate)) { res.status(400).json({ error: "invalid_business_date" }); return; }
  const ctx = await bizDataAuthRead(req, res, tenantId, bizId); if (!ctx) return;
  try { const { document, versionToken } = await getBizDocWithToken(tenantId, bizId, `checklist_runs:${businessDate}`); res.status(200).json({ ok: true, document, versionToken }); }
  catch (e) { res.status(500).json({ error: "read_failed" }); }
}
async function handleSetChecklistRun(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const ctx = await bizDataAuthWrite(req, res, "shift_manager"); if (!ctx) return;
  const { businessDate, doc, expectedVersionToken } = ctx.body;
  if (!isValidBusinessDate(businessDate)) { res.status(400).json({ error: "invalid_business_date" }); return; }
  if (!validVersionToken(expectedVersionToken)) { res.status(400).json({ error: "invalid_version_token" }); return; }
  if (!bizDataValidDoc(res, doc)) return;
  try { bizDataConflictOrWrite(res, await setBizDocGuarded(ctx.tenantId, ctx.bizId, `checklist_runs:${businessDate}`, doc, expectedVersionToken), doc); }
  catch (e) { res.status(500).json({ error: "write_failed" }); }
}
async function handleGetChecklistSimpleRun(req, res) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const { tenantId, bizId, businessDate, templateId } = req.query;
  if (!isValidBusinessDate(businessDate)) { res.status(400).json({ error: "invalid_business_date" }); return; }
  if (!bizDataValidTemplateId(templateId)) { res.status(400).json({ error: "invalid_template_id" }); return; }
  const ctx = await bizDataAuthRead(req, res, tenantId, bizId); if (!ctx) return;
  try { const { document, versionToken } = await getBizDocWithToken(tenantId, bizId, `checklist_simple_runs:${businessDate}:${templateId}`); res.status(200).json({ ok: true, document, versionToken }); }
  catch (e) { res.status(500).json({ error: "read_failed" }); }
}
async function handleSetChecklistSimpleRun(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const ctx = await bizDataAuthWrite(req, res, "shift_manager"); if (!ctx) return;
  const { businessDate, templateId, doc, expectedVersionToken } = ctx.body;
  if (!isValidBusinessDate(businessDate)) { res.status(400).json({ error: "invalid_business_date" }); return; }
  if (!bizDataValidTemplateId(templateId)) { res.status(400).json({ error: "invalid_template_id" }); return; }
  if (!validVersionToken(expectedVersionToken)) { res.status(400).json({ error: "invalid_version_token" }); return; }
  if (!bizDataValidDoc(res, doc)) return;
  try { bizDataConflictOrWrite(res, await setBizDocGuarded(ctx.tenantId, ctx.bizId, `checklist_simple_runs:${businessDate}:${templateId}`, doc, expectedVersionToken), doc); }
  catch (e) { res.status(500).json({ error: "write_failed" }); }
}
// Derived analytics/insights — bounded date-range READ only (client write is impossible; server/Admin SDK writes them).
async function bizDailyRangeGet(req, res, kind) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const { tenantId, bizId, fromDate, toDate } = req.query;
  if (!isValidBusinessDate(fromDate)) { res.status(400).json({ error: "invalid_from_date" }); return; }
  if (!isValidBusinessDate(toDate)) { res.status(400).json({ error: "invalid_to_date" }); return; }
  const rd = dateRangeDays(fromDate, toDate);
  if (rd < 0) { res.status(400).json({ error: "reversed_range" }); return; }
  if (rd > MAX_LIST_RANGE_DAYS) { res.status(400).json({ error: "range_too_large" }); return; }
  const ctx = await bizDataAuthRead(req, res, tenantId, bizId); if (!ctx) return;
  try { res.status(200).json({ ok: true, tenantId, bizId, kind, docs: await readBizDailyRange(tenantId, bizId, kind, fromDate, toDate) }); }
  catch (e) { console.error(`[get-${kind}-daily]`, e?.message); res.status(500).json({ error: "read_failed" }); }
}
async function handleGetAnalyticsDaily(req, res) { return bizDailyRangeGet(req, res, "analytics"); }
async function handleGetInsightsDaily(req, res) { return bizDailyRangeGet(req, res, "insights"); }

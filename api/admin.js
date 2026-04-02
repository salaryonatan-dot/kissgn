/**
 * /api/admin.js â unified admin endpoint
 *
 * POST ?action=roles          â admin-roles (set/remove user role)
 * POST ?action=create-client  â create new tenant + owner (super_owner only)
 * GET  ?action=list-clients   â list all tenants (super_owner only)
 * POST ?action=delete-client  â delete a tenant (super_owner only)
 * POST ?action=reset-password â reset user password (super_owner only)
 * POST ?action=resend-invite  â resend WhatsApp invite with new temp password (super_owner only)
 */

import { requireAuth } from "../lib/verifyToken.js";
import { requireTenantAccess, isRateLimited,
  getIP, VALID_ROLES } from "../lib/helpers.js";
import { getAdminDb, getAdminAuth } from "../lib/adminSdk.js";
import { sendWhatsApp } from "../lib/sendWhatsApp.js";

const RTDB_FORBIDDEN = /[.#$\[\]\/]/;
const APP_BASE_URL   = process.env.APP_BASE_URL || "https://kissgn.vercel.app";

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
  if (action === "delete-client")     return handleDeleteClient(req, res);
  if (action === "reset-password")    return handleResetPassword(req, res);
  if (action === "resend-invite")     return handleResendInvite(req, res);
  if (action === "complete-profile")  return handleCompleteProfile(req, res);
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
      let ownerName = "", ownerEmail = "", ownerUsername = "", status = "unknown";
      if (usersSnap.exists()) {
        try {
          const users = JSON.parse(usersSnap.val()?._v || "[]");
          const owner = users.find(u => u.role === "owner" || u.role === "super_owner");
          if (owner) {
            ownerName = owner.name || "";
            ownerEmail = owner.email || "";
            ownerUsername = owner.username || "";
            status = owner.email ? "active" : "invited";
          }
        } catch(_) {}
      }

      const inviteSnap = await db.ref(`tenants/${tenantId}/meta/inviteLink`).once("value");
      const inviteLink = inviteSnap.val() || null;

      clients.push({ tenantId, bizName, ownerName, ownerEmail, ownerUsername, status, createdAt, inviteLink });
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

  if (!bizName?.trim() || !ownerUsername?.trim() || !ownerPhone?.trim()) {
    res.status(400).json({ error: "×©×××ª ××××: ×©× ×¢×¡×§, ×©× ××©×ª××©, ×××¤××" });
    return;
  }

  const safeEmail = ownerEmail?.trim() || (ownerUsername.trim().toLowerCase() + "@temp.marjin.app");
  const tenantId = "biz_" + Date.now();
  const tempPass = "Marjin_" + Math.random().toString(36).slice(2, 10);
  const now      = Date.now();

  try {
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
        const existing = await auth.getUserByEmail(safeEmail);
        firebaseUid = existing.uid;
      } else { throw e; }
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

    // Send WhatsApp invite
    let waSent = false;
    if (ownerPhone?.trim()) {
      try {
        const ph = ownerPhone.trim().replace(/^\+/, "");
        const msg = "\uD83C\uDF89 *××¨×× ××× ×-Marjin!*\n\n" +
          "×©× ×¢×¡×§: *" + bizName.trim() + "*\n" +
          "×©× ××©×ª××©: *" + ownerUsername.trim().toLowerCase() + "*\n" +
          "×¡××¡×× ××× ××ª: *" + tempPass + "*\n\n" +
          "\uD83D\uDD17 ×× ××¡× ×××¢×¨××ª:\n" + inviteLink + "\n\n" +
          "_× × ××××××£ ×¡××¡×× ××××¨ ××× ××¡× ××¨××©×× ×_";
        await sendWhatsApp(ph, msg);
        waSent = true;
      } catch (waErr) {
        console.error("[create-client] WhatsApp failed:", waErr.message);
      }
    }

    // SECURITY: tempPassword is NEVER returned in JSON â only sent via WhatsApp
    res.status(200).json({
      ok: true, tenantId, bizName: bizName.trim(),
      ownerEmail: safeEmail, ownerPhone: ownerPhone?.trim() || "",
      inviteLink, waSent
    });

  } catch(e) {
    console.error("[create-client] error:", e.message, e.code);
    res.status(500).json({ error: e.message || "×©×××× ×××¦××¨×ª ××§××" });
  }
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// POST ?action=complete-profile â update email + password via Admin SDK
// (bypasses auth/requires-recent-login for first-time profile setup)
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function handleCompleteProfile(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  let claims;
  try { claims = await requireAuth(req); }
  catch (e) {
    console.error("[complete-profile] auth failed:", e.message);
    res.status(401).json({ error: "unauthorized" }); return;
  }

  const auth = getAdminAuth();
  const { newEmail, newPassword } = req.body || {};

  if (!newEmail?.trim() || !newPassword) {
    res.status(400).json({ error: "Missing newEmail or newPassword" }); return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" }); return;
  }

  try {
    // Update the user's email and password via Admin SDK (no re-auth needed)
    await auth.updateUser(claims.uid, {
      email: newEmail.trim(),
      password: newPassword,
    });

    // Also update username_index and lookup with the new email
    const db = getAdminDb();
    const tenantSnap = await db.ref(`user_tenants/${claims.uid}`).once("value");
    const tenantId = tenantSnap.val();

    if (tenantId) {
      // Find the username for this user
      const usersSnap = await db.ref(`tenants/${tenantId}/app/users`).once("value");
      if (usersSnap.exists()) {
        try {
          const users = JSON.parse(usersSnap.val()?._v || "[]");
          const user = users.find(u => u.firebaseUid === claims.uid);
          if (user?.username) {
            const uname = user.username.toLowerCase();
            await db.ref(`username_index/${uname}`).update({ email: newEmail.trim() });
            await db.ref(`tenants/${tenantId}/lookup/${uname}`).update({ email: newEmail.trim() });
          }
          // Update the user record â set mustCompleteProfile to false and new email
          const updatedUsers = users.map(u =>
            u.firebaseUid === claims.uid
              ? { ...u, email: newEmail.trim(), mustCompleteProfile: false }
              : u
          );
          await db.ref(`tenants/${tenantId}/app/users`).set({ _v: JSON.stringify(updatedUsers) });
        } catch (_) {}
      }
    }

    console.log("[complete-profile] updated email+password for uid:", claims.uid);
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[complete-profile] error:", e.message, e.code);
    res.status(500).json({ error: e.message || "Failed to update profile" });
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

    // Try to delete Firebase Auth users (best effort)
    let deletedUsers = 0;
    for (const uid of Object.keys(members)) {
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

    // Return temp password to super_owner so they can share it
    res.status(200).json({
      ok: true,
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName || "",
      tempPassword: newPass,
      message: "×¡××¡×× ×××¤×¡× ×××¦××× â ××¢××¨ ××ª ××¡××¡×× ×××× ××ª ×××§××"
    });

  } catch(e) {
    console.error("[reset-password] error:", e.message, e.code);
    res.status(500).json({ error: e.message || "×©×××× ××××¤××¡ ×¡××¡××" });
  }
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// POST ?action=resend-invite â resend WhatsApp invite with new temp password
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

  const { tenantId, phone } = req.body || {};

  if (!tenantId || !phone?.trim()) {
    res.status(400).json({ error: "× ××¨×© tenantId ×××¡×¤×¨ ×××¤××" }); return;
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

    // Send WhatsApp
    let waSent = false;
    try {
      const ph = phone.trim().replace(/^\+/, "");
      const msg = "\uD83C\uDF89 *××¨×× ××× ×-Marjin!*\n\n" +
        "×©× ×¢×¡×§: *" + (bizName || tenantId) + "*\n" +
        "×©× ××©×ª××©: *" + (ownerUser.username || ownerUser.email) + "*\n" +
        "×¡××¡×× ××× ××ª: *" + newPass + "*\n\n" +
        "\uD83D\uDD17 ×× ××¡× ×××¢×¨××ª:\n" + inviteLink + "\n\n" +
        "_× × ××××××£ ×¡××¡×× ××××¨ ××× ××¡× ××¨××©×× ×_";
      await sendWhatsApp(ph, msg);
      waSent = true;
    } catch (waErr) {
      console.error("[resend-invite] WhatsApp failed:", waErr.message);
    }

    console.log(`[resend-invite] invite resent for tenant ${tenantId}, waSent=${waSent}`);

    res.status(200).json({
      ok: true,
      tenantId,
      waSent,
      tempPassword: newPass,
      message: waSent
        ? "×××× × × ×©××× ××××© ×××¦××× ×-WhatsApp"
        : "××¡××¡×× ×××¤×¡× ××× ×©××××ª WhatsApp × ××©×× â ××¢××¨ ××ª ××¡××¡×× ××× ××ª"
    });

  } catch(e) {
    console.error("[resend-invite] error:", e.message, e.code);
    res.status(500).json({ error: e.message || "×©×××× ××©××××ª ×××× ×" });
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

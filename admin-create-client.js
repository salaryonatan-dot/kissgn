// /api/admin/create-client — creates a new tenant + owner (super_owner only)
import { requireAuth }            from "../../lib/verifyToken.js";
import { getAdminDb, getAdminAuth } from "../../lib/adminSdk.js";

const APP_BASE_URL = process.env.APP_BASE_URL || "https://kissgn.vercel.app";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" }); return;
  }

  // Auth
  let claims;
  try { claims = await requireAuth(req); }
  catch (e) {
    console.error("[create-client] auth failed:", e.message);
    res.status(401).json({ error: "unauthorized" }); return;
  }

  const db   = getAdminDb();
  const auth = getAdminAuth();

  // Verify caller is super_owner on at least one tenant
  let isSuperOwner = false;
  try {
    const rolesSnap = await db.ref("tenants").once("value");
    if (rolesSnap.exists()) {
      isSuperOwner = Object.keys(rolesSnap.val()).some(tid =>
        rolesSnap.val()[tid]?.roles?.[claims.uid] === "super_owner"
      );
    }
  } catch(e) {
    console.error("[create-client] roles check failed:", e.message);
  }

  if (!isSuperOwner) {
    res.status(403).json({ error: "forbidden — super_owner only" }); return;
  }

  // Validate body
  const { bizName, ownerName, ownerEmail, ownerUsername } = req.body || {};
  if (!bizName?.trim() || !ownerEmail?.trim() || !ownerUsername?.trim()) {
    res.status(400).json({ error: "שדות חובה: שם עסק, אימייל, שם משתמש" }); return;
  }

  const tenantId  = "biz_" + Date.now();
  const tempPass  = "Marjin_" + Math.random().toString(36).slice(2, 10);
  const now       = Date.now();

  try {
    // 1. Create or find Firebase Auth user
    let firebaseUid;
    try {
      const userRecord = await auth.createUser({
        email:       ownerEmail.trim(),
        password:    tempPass,
        displayName: ownerUsername.trim().toLowerCase(),
      });
      firebaseUid = userRecord.uid;
      console.log("[create-client] created auth user:", firebaseUid);
    } catch(e) {
      if (e.code === "auth/email-already-exists") {
        const existing = await auth.getUserByEmail(ownerEmail.trim());
        firebaseUid = existing.uid;
        console.log("[create-client] reusing existing auth user:", firebaseUid);
      } else {
        throw e;
      }
    }

    // 2. Build objects
    const ownerUser = {
      id: "u_" + now,
      name: (ownerName?.trim() || ownerUsername.trim()),
      username: ownerUsername.trim().toLowerCase(),
      email: ownerEmail.trim(),
      role: "owner",
      firebaseUid,
      mustCompleteProfile: true,
      createdAt: now,
    };

    const biz = {
      id: tenantId,
      name: bizName.trim(),
      createdAt: now,
    };

    // 3. Write to RTDB atomically
    const updates = {};
    updates[`tenants/${tenantId}/app/users`]                    = { _v: JSON.stringify([ownerUser]) };
    updates[`tenants/${tenantId}/app/business`]                 = { _v: JSON.stringify([biz]) };
    updates[`tenants/${tenantId}/roles/${firebaseUid}`]         = "owner";
    updates[`tenants/${tenantId}/members/${firebaseUid}`]       = true;
    updates[`tenants/${tenantId}/meta/createdAt`]               = now;
    updates[`tenants/${tenantId}/meta/createdBy`]               = claims.uid;
    updates[`tenants/${tenantId}/lookup/${ownerUsername.trim().toLowerCase()}`] = {
      email: ownerEmail.trim(), firebaseUid
    };
    updates[`user_tenants/${firebaseUid}`]                      = tenantId;
    updates[`username_index/${ownerUsername.trim().toLowerCase()}`] = {
      tenantId, email: ownerEmail.trim()
    };

    const inviteLink = `${APP_BASE_URL}/app?login=1&hint=${encodeURIComponent(ownerUsername.trim().toLowerCase())}`;
    updates[`tenants/${tenantId}/meta/inviteLink`] = inviteLink;

    await db.ref().update(updates);
    console.log("[create-client] tenant created:", tenantId);

    res.status(200).json({
      ok: true,
      tenantId,
      bizName: bizName.trim(),
      ownerEmail: ownerEmail.trim(),
      inviteLink,
      tempPassword: tempPass,
    });

  } catch(e) {
    console.error("[create-client] error:", e.message, e.code);
    res.status(500).json({ error: e.message || "שגיאה ביצירת לקוח" });
  }
}

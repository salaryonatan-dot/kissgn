// /api/config.js — serves Firebase config to the client
// All values come from Vercel environment variables.
// recaptchaSiteKey is optional; all others are required.
export default function handler(req, res) {
  console.log("[config] request from:", req.headers["x-forwarded-for"] || "unknown");

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const required = {
    apiKey:            process.env.FIREBASE_API_KEY,
    authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL:       process.env.FIREBASE_DATABASE_URL,
    projectId:         process.env.FIREBASE_PROJECT_ID,
    storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId:             process.env.FIREBASE_APP_ID,
  };

  for (const [k, v] of Object.entries(required)) {
    if (!v) {
      console.error("[config] missing env var:", k);
      res.status(500).json({ error: `Missing env var: ${k}` });
      return;
    }
  }

  const cfg = {
    ...required,
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || null,
  };

  console.log("[config] returning config for project:", cfg.projectId);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(cfg);
}

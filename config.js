// Node.js serverless — no firebase-admin needed, just env vars
export default function handler(req, res) {
  const cfg = {
    apiKey:            process.env.FIREBASE_API_KEY,
    authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL:       process.env.FIREBASE_DATABASE_URL,
    projectId:         process.env.FIREBASE_PROJECT_ID,
    storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId:             process.env.FIREBASE_APP_ID,
    recaptchaSiteKey:  process.env.RECAPTCHA_SITE_KEY || null,
  };

  for (const [k, v] of Object.entries(cfg)) {
    if (v === undefined) {
      res.status(500).json({ error: `Missing env var for ${k}` });
      return;
    }
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.status(200).json(cfg);
}

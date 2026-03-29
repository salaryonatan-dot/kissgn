// /api/config — serves Firebase client config from Vercel env vars
export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const config = {
    apiKey:            process.env.FIREBASE_API_KEY,
    authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL:       process.env.FIREBASE_DATABASE_URL,
    projectId:         process.env.FIREBASE_PROJECT_ID,
    storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId:             process.env.FIREBASE_APP_ID,
  };

  if (process.env.RECAPTCHA_SITE_KEY) {
    config.recaptchaSiteKey = process.env.RECAPTCHA_SITE_KEY;
  }

  if (!config.apiKey || !config.projectId || !config.databaseURL) {
    return res.status(500).json({ error: "Firebase config incomplete" });
  }

  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  return res.status(200).json(config);
}

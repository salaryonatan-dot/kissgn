export const config = { runtime: "edge" };

export default function handler(req) {
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
      return new Response(JSON.stringify({ error: `Missing env var for ${k}` }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify(cfg), {
    status: 200,
    headers: {
      "Content-Type":   "application/json",
      "Cache-Control":  "no-store",
      "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
    },
  });
}

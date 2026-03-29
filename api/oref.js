// /api/oref — proxy to Israeli Home Front Command alerts API
// Avoids CORS issues when calling oref.org.il directly from browser
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const response = await fetch("https://www.oref.org.il/WarningMessages/alert/alerts.json", {
      headers: {
        "Referer": "https://www.oref.org.il/",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0",
      },
    });

    // oref sometimes returns empty body (no active alerts)
    const text = await response.text();
    const data = text ? JSON.parse(text) : { data: [] };

    res.setHeader("Cache-Control", "no-cache, no-store");
    return res.status(200).json(data);
  } catch (err) {
    console.error("[oref]", err);
    return res.status(200).json({ data: [] }); // fail silently — no alerts
  }
}

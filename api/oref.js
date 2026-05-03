// /api/oref — proxy to Israeli Home Front Command alerts API.
// Avoids CORS issues when calling oref.org.il directly from browser.
//
// Defensive parsing: oref.org.il sometimes returns an HTML error page
// instead of JSON when the service is degraded. Naive JSON.parse on that
// throws SyntaxError, which clutters Vercel logs even though the catch
// already returns {data:[]} so the app keeps working. We now sniff the
// first non-whitespace char before parsing — only attempt JSON.parse if
// the body actually looks like JSON.

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const response = await fetch(
      "https://www.oref.org.il/WarningMessages/alert/alerts.json",
      {
        headers: {
          "Referer": "https://www.oref.org.il/",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": "Mozilla/5.0",
        },
      }
    );

    const text = (await response.text()).trim();

    // Empty body = no active alerts. Return canonical empty shape.
    if (!text) {
      res.setHeader("Cache-Control", "no-cache, no-store");
      return res.status(200).json({ data: [] });
    }

    // Sniff first char: must be '{' (object) or '[' (array) for valid JSON.
    // Anything else (HTML, plain text) → treat as upstream degradation,
    // return empty without logging a noisy SyntaxError.
    const firstChar = text[0];
    if (firstChar !== "{" && firstChar !== "[") {
      res.setHeader("Cache-Control", "no-cache, no-store");
      return res.status(200).json({ data: [] });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Defensive — JSON.parse can still fail on malformed-but-leading-bracket
      // payloads (truncated JSON, etc.). Same fail-silent behavior.
      res.setHeader("Cache-Control", "no-cache, no-store");
      return res.status(200).json({ data: [] });
    }

    res.setHeader("Cache-Control", "no-cache, no-store");
    return res.status(200).json(data);
  } catch (err) {
    console.error("[oref]", err);
    return res.status(200).json({ data: [] });
  }
}

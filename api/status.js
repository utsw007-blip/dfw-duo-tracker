// Vercel serverless function: GET /api/status
// Asks Apple's public pickup data about one part number near NorthPark (75225),
// which lists all five DFW stores, and returns ready / not ready for each.

const PART = process.env.DUO_PART || "MK1E4LL/A"; // iPhone Duo, Star White, 256GB (US)
const ZIP = "75225";
const STORES = [
  { key: "knox", test: /knox/i },
  { key: "northpark", test: /northpark/i },
  { key: "galleria", test: /galleria/i },
  { key: "southlake", test: /southlake/i },
  { key: "universitypark", test: /university park/i },
];

async function lookup() {
  const qs = new URLSearchParams({
    fae: "true",
    little: "false",
    pl: "true",
    "mts.0": "regular",
    "mts.1": "compact",
    "parts.0": PART,
    searchNearby: "true",
    location: ZIP,
  });
  const r = await fetch("https://www.apple.com/shop/fulfillment-messages?" + qs, {
    headers: {
      accept: "application/json, text/javascript, */*; q=0.01",
      "accept-language": "en-US,en;q=0.9",
      referer: "https://www.apple.com/shop/buy-iphone",
      "x-requested-with": "XMLHttpRequest",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
  });
  if (!r.ok) {
    const t = (await r.text()).replace(/\s+/g, " ").slice(0, 200);
    throw new Error("Apple returned " + r.status + (t ? ": " + t : ""));
  }
  const j = await r.json();
  const c = j && j.body && j.body.content;
  return (c && c.pickupMessage && c.pickupMessage.stores) || [];
}

module.exports = async (req, res) => {
  let all;
  try {
    all = await lookup();
  } catch (e) {
    res.status(502).json({ error: "Could not reach Apple", detail: String(e) });
    return;
  }

  const stores = [];
  const missing = [];
  STORES.forEach((def) => {
    const s = all.find((x) => def.test.test(x.storeName || ""));
    if (!s) return missing.push(def.key);
    const pa = s.partsAvailability || {};
    const a = pa[PART] || Object.values(pa)[0] || {};
    stores.push({
      key: def.key,
      name: s.storeName,
      storeNumber: s.storeNumber,
      ready: a.pickupDisplay === "available",
      status: a.pickupDisplay || "unknown",
    });
  });

  // Many visitors share one Apple lookup every ~5 seconds.
  res.setHeader("Cache-Control", "public, s-maxage=5, stale-while-revalidate=10");
  res.status(200).json({ part: PART, updatedAt: new Date().toISOString(), stores, missing });
};

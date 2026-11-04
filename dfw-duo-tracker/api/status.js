// Vercel serverless function: GET /api/status
// Asks Apple's public pickup data about one part number near each DFW store,
// then returns ready / not ready for the five DFW stores.

const PART = process.env.DUO_PART || "MK1E4LL/A"; // iPhone Duo, Star White, 256GB (US)
const ZIPS = ["75225", "75240", "76092", "76107"]; // NorthPark/Knox, Galleria, Southlake, Fort Worth
const STORES = [
  { key: "knox", test: /knox/i },
  { key: "northpark", test: /northpark/i },
  { key: "galleria", test: /galleria/i },
  { key: "southlake", test: /southlake/i },
  { key: "universitypark", test: /university park/i },
];

async function lookup(zip) {
  const qs = new URLSearchParams({
    fae: "true",
    little: "false",
    pl: "true",
    "mts.0": "regular",
    "mts.1": "compact",
    "parts.0": PART,
    searchNearby: "true",
    location: zip,
  });
  const r = await fetch("https://www.apple.com/shop/fulfillment-messages?" + qs, {
    headers: {
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    },
  });
  if (!r.ok) throw new Error("Apple returned " + r.status);
  const j = await r.json();
  const c = j && j.body && j.body.content;
  return (c && c.pickupMessage && c.pickupMessage.stores) || [];
}

module.exports = async (req, res) => {
  const results = await Promise.allSettled(ZIPS.map(lookup));
  const ok = results.filter((r) => r.status === "fulfilled");
  if (!ok.length) {
    res.status(502).json({ error: "Could not reach Apple", detail: String(results[0].reason) });
    return;
  }

  const seen = new Map();
  ok.forEach((r) => r.value.forEach((s) => seen.set(s.storeNumber || s.storeName, s)));
  const all = [...seen.values()];

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
  const body = { part: PART, updatedAt: new Date().toISOString(), stores, missing };
  if (req.query && req.query.debug) body.debugSample = all[0] || null;
  res.status(200).json(body);
};

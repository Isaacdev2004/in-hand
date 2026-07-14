/**
 * Live eBay market estimates via Supabase Edge Function (keys stay server-side).
 * Shape matches MARKET_DATA entries used by MarketValueModal / MarketBadge.
 */

const cache = new Map(); // name -> { data, at }
const TTL_MS = 60 * 60 * 1000; // 1 hour

export function getCachedMarketValue(name) {
  if (!name) return null;
  const hit = cache.get(name);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(name);
    return null;
  }
  return hit.data;
}

export function setCachedMarketValue(name, data) {
  if (name && data) cache.set(name, { data, at: Date.now() });
}

/**
 * @param {string} name — figure / listing search query
 * @returns {Promise<object|null>}
 */
export async function fetchEbayMarketValue(name) {
  const q = (name || "").trim();
  if (q.length < 2) return null;

  const cached = getCachedMarketValue(q);
  if (cached) return cached;

  const supabaseUrl = (process.env.REACT_APP_SUPABASE_URL || "").replace(/\/$/, "");
  const anon = process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anon) {
    throw new Error("Supabase is not configured.");
  }

  const url =
    `${supabaseUrl}/functions/v1/ebay-market-value?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${anon}`,
      apikey: anon,
    },
  });

  const body = await res.json().catch(() => ({}));
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(body?.error || `eBay market lookup failed (${res.status})`);
  }

  const mapped = {
    new: body.new || null,
    used: body.used || null,
    trend: body.trend || "flat",
    lastSold: body.lastSold || body.lastChecked || null,
    history: Array.isArray(body.history) ? body.history : [],
    source: body.source || "ebay_browse",
    sourceLabel: body.sourceLabel || "Current eBay listings",
  };

  if (!mapped.new && !mapped.used) return null;
  setCachedMarketValue(q, mapped);
  return mapped;
}

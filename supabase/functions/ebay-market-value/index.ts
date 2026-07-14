// Live eBay market estimates via Browse API (active listings).
// Secrets: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

let cachedToken: { value: string; expiresAt: number } | null = null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const clientId = Deno.env.get("EBAY_CLIENT_ID");
    const clientSecret = Deno.env.get("EBAY_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      return json({ error: "eBay Production keys not configured on Supabase" }, 500);
    }

    let query = "";
    if (req.method === "GET") {
      query = new URL(req.url).searchParams.get("q") || "";
    } else {
      const body = await req.json().catch(() => ({}));
      query = String(body?.q || body?.name || "");
    }
    query = query.trim().slice(0, 120);
    if (query.length < 2) {
      return json({ error: "Query (q) required" }, 400);
    }

    const token = await getAppToken(clientId, clientSecret);
    const [newTier, usedTier] = await Promise.all([
      searchTier(token, query, "NEW"),
      searchTier(token, query, "USED"),
    ]);

    if (!newTier && !usedTier) {
      return json({
        error: "No eBay listings found for this search",
        q: query,
        new: null,
        used: null,
      }, 404);
    }

    const history = usedTier?.sample || newTier?.sample || [];
    const trend = inferTrend(history);

    return json({
      q: query,
      source: "ebay_browse",
      sourceLabel: "Current eBay listings",
      lastChecked: new Date().toISOString().slice(0, 10),
      lastSold: new Date().toISOString().slice(0, 10),
      new: newTier ? tierPayload(newTier) : null,
      used: usedTier ? tierPayload(usedTier) : null,
      history,
      trend,
    });
  } catch (e) {
    console.error("ebay-market-value", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function tierPayload(t: Aggregate) {
  return {
    avg: t.avg,
    low: t.low,
    high: t.high,
    sales: t.count,
  };
}

type Aggregate = {
  avg: number;
  low: number;
  high: number;
  count: number;
  sample: number[];
};

async function getAppToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }
  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: "grant_type=client_credentials&scope=" +
      encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(
      `eBay OAuth failed: ${body.error_description || body.error || res.status}`,
    );
  }
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + Number(body.expires_in || 7200) * 1000,
  };
  return body.access_token;
}

async function searchTier(
  token: string,
  q: string,
  condition: "NEW" | "USED",
): Promise<Aggregate | null> {
  const params = new URLSearchParams({
    q,
    limit: "50",
    filter: `conditions:{${condition}},buyingOptions:{FIXED_PRICE}`,
  });
  const res = await fetch(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "Content-Type": "application/json",
      },
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.errors?.[0]?.message || body?.error || res.status;
    throw new Error(`eBay Browse ${condition}: ${msg}`);
  }

  const prices: number[] = [];
  for (const item of body.itemSummaries || []) {
    const v = Number(item?.price?.value);
    if (Number.isFinite(v) && v > 0) prices.push(v);
  }
  return aggregatePrices(prices);
}

function aggregatePrices(prices: number[]): Aggregate | null {
  if (!prices.length) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  // Trim extreme outliers (top/bottom 10%) when we have enough samples
  let trimmed = sorted;
  if (sorted.length >= 10) {
    const drop = Math.floor(sorted.length * 0.1);
    trimmed = sorted.slice(drop, sorted.length - drop || undefined);
  }
  if (!trimmed.length) trimmed = sorted;

  const sum = trimmed.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / trimmed.length);
  const low = Math.round(trimmed[0]);
  const high = Math.round(trimmed[trimmed.length - 1]);
  // Sparkline sample: up to 14 evenly spaced prices
  const sample: number[] = [];
  const n = Math.min(14, trimmed.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i / Math.max(n - 1, 1)) * (trimmed.length - 1));
    sample.push(Math.round(trimmed[idx]));
  }

  return { avg, low, high, count: prices.length, sample };
}

function inferTrend(history: number[]): "up" | "down" | "flat" {
  if (history.length < 4) return "flat";
  const mid = Math.floor(history.length / 2);
  const first = history.slice(0, mid);
  const second = history.slice(mid);
  const a = first.reduce((s, v) => s + v, 0) / first.length;
  const b = second.reduce((s, v) => s + v, 0) / second.length;
  const pct = ((b - a) / (a || 1)) * 100;
  if (pct >= 5) return "up";
  if (pct <= -5) return "down";
  return "flat";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

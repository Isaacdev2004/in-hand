// eBay Marketplace Account Deletion / Closure Notification endpoint.
//
// eBay validates this URL by sending a GET with ?challenge_code=... and expects
//   { "challengeResponse": sha256(challengeCode + verificationToken + endpoint) }
// where `endpoint` is the EXACT URL registered in eBay (no query string).
//
// It later sends POST notifications when a user closes their eBay account; we
// just need to acknowledge with 200.
//
// Secrets required on Supabase:
//   EBAY_VERIFICATION_TOKEN  — the same token entered in eBay's "Verification token" field
//   EBAY_ENDPOINT_URL        — the exact endpoint URL entered in eBay (recommended, avoids host mismatch)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const verificationToken = Deno.env.get("EBAY_VERIFICATION_TOKEN");
  if (!verificationToken) {
    return json({ error: "EBAY_VERIFICATION_TOKEN not configured" }, 500);
  }

  const reqUrl = new URL(req.url);
  // Prefer the explicitly configured endpoint so the hash matches exactly what
  // was registered in eBay. Fall back to reconstructing from the request.
  const endpoint = Deno.env.get("EBAY_ENDPOINT_URL") ||
    `${reqUrl.protocol}//${req.headers.get("x-forwarded-host") || reqUrl.host}${reqUrl.pathname}`;

  if (req.method === "GET") {
    const challengeCode = reqUrl.searchParams.get("challenge_code");
    if (!challengeCode) {
      return json({ error: "Missing challenge_code" }, 400);
    }

    const data = new TextEncoder().encode(
      challengeCode + verificationToken + endpoint,
    );
    const digest = await crypto.subtle.digest("SHA-256", data);
    const challengeResponse = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return json({ challengeResponse }, 200);
  }

  if (req.method === "POST") {
    // Actual account-deletion notification. Acknowledge quickly.
    try {
      const body = await req.json().catch(() => ({}));
      console.log("eBay account deletion notification", JSON.stringify(body));
    } catch (_e) {
      // ignore body parse errors; still acknowledge
    }
    return json({ received: true }, 200);
  }

  return json({ error: "Method not allowed" }, 405);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

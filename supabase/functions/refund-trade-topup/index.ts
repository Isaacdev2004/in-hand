import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Refund trade top-up if cancelled before either party ships. */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return json({ error: "STRIPE_SECRET_KEY not configured" }, 500);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!bearer || bearer === anonKey) return json({ error: "Sign in required" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user?.id) return json({ error: "Invalid session" }, 401);

    const { proposalId } = await req.json();
    if (!proposalId) return json({ error: "proposalId required" }, 400);

    const supabase = createClient(supabaseUrl, serviceKey);
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const { data: prop } = await supabase
      .from("trade_proposals")
      .select(
        "id, proposer_id, receiver_id, topup_payment_intent_id, topup_paid_at, status",
      )
      .eq("id", proposalId)
      .maybeSingle();

    if (!prop) return json({ error: "Proposal not found" }, 404);
    if (user.id !== prop.proposer_id && user.id !== prop.receiver_id) {
      return json({ error: "Not a party to this trade" }, 403);
    }
    if (!prop.topup_payment_intent_id || !prop.topup_paid_at) {
      return json({ skipped: true, reason: "no_topup_paid" });
    }

    // Block refund if either party already has a label / tracking for this trade
    const { data: ships } = await supabase
      .from("shipments")
      .select("id, tracking_number")
      .or(`id.eq.sh_trade_${proposalId}_a,id.eq.sh_trade_${proposalId}_b`);
    const shipped = (ships || []).some((s) => !!s.tracking_number);
    if (shipped) {
      return json({ error: "Cannot refund — shipping already started" }, 400);
    }

    await stripe.refunds.create({
      payment_intent: prop.topup_payment_intent_id,
      reason: "requested_by_customer",
      metadata: { proposal_id: proposalId, reason: "trade_cancelled_before_shipping" },
    });

    await supabase
      .from("trade_proposals")
      .update({
        topup_status: "refunded",
        updated_at: new Date().toISOString(),
      })
      .eq("id", proposalId);

    await supabase
      .from("transactions")
      .update({ status: "refunded" })
      .eq("id", `t_topup_${prop.topup_payment_intent_id}`);

    return json({ refunded: true });
  } catch (e) {
    console.error("refund-trade-topup", e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

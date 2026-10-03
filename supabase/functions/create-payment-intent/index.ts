import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import {
  computePurchaseTotals,
  getShippingRate,
  loadShippingRatesFromDb,
} from "../_shared/pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TRADE_FEE_DOLLARS = 2;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return json({ error: "STRIPE_SECRET_KEY not configured" }, 500);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!bearer || bearer === anonKey) {
      return json({ error: "Sign in required" }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user?.id) {
      return json({ error: "Invalid session" }, 401);
    }

    const body = await req.json();
    const purpose = String(body.purpose || "purchase");
    const supabase = createClient(supabaseUrl, serviceKey);
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    let amountCents = Math.round(Number(body.amountCents) || 0);
    let tradeFeeCents = 0;
    let labelCents = 0;
    let shippingLabel = "";

    // Flatten metadata to strings only (Stripe requirement)
    const rawMeta = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
    const metadata: Record<string, string> = {
      purpose,
      user_id: user.id,
    };
    for (const [k, v] of Object.entries(rawMeta)) {
      if (v == null) continue;
      metadata[k] = String(v);
    }

    // Trade / label pay: $2 trade fee + USPS label cost (from shipment rates)
    if (purpose === "trade_fee") {
      tradeFeeCents = Math.round(TRADE_FEE_DOLLARS * 100);
      metadata.purpose = "trade_fee";
      const shipmentId = String(
        body.shipmentId || rawMeta.shipment_id || metadata.shipment_id || "",
      ).trim();
      if (shipmentId) metadata.shipment_id = shipmentId;

      if (shipmentId) {
        const { data: sh } = await supabase
          .from("shipments")
          .select("id, from_user, figure_value, shipping_cost, figure_name")
          .eq("id", shipmentId)
          .maybeSingle();
        if (!sh) return json({ error: "Shipment not found" }, 404);
        if (sh.from_user !== user.id) {
          return json({ error: "Only the sender can pay for this label" }, 403);
        }
        const rates = await loadShippingRatesFromDb(supabase);
        const figureValue = Number(sh.figure_value) || 0;
        const rate = getShippingRate(figureValue, rates);
        const stored = Number(sh.shipping_cost);
        const labelDollars =
          Number.isFinite(stored) && stored > 0 ? stored : Number(rate?.price) || 0;
        labelCents = Math.round(labelDollars * 100);
        shippingLabel = rate?.label || "USPS Ground Advantage";
        metadata.label_cents = String(labelCents);
        metadata.trade_fee_cents = String(tradeFeeCents);
        metadata.figure_name = String(sh.figure_name || "");
      }

      amountCents = tradeFeeCents + labelCents;
    }

    // Trade cash top-up: charged on Accept Trade (held in escrow). Platform takes 5%.
    if (purpose === "topup") {
      const proposalId = String(
        body.proposalId || rawMeta.proposal_id || metadata.proposal_id || "",
      ).trim();
      if (!proposalId) return json({ error: "proposal_id required for topup" }, 400);

      const { data: prop, error: propErr } = await supabase
        .from("trade_proposals")
        .select(
          "id, status, proposer_id, receiver_id, topup_suggested, topup_agreed, topup_payment_intent_id, topup_paid_at",
        )
        .eq("id", proposalId)
        .maybeSingle();
      if (propErr || !prop) return json({ error: "Trade proposal not found" }, 404);
      if (prop.status !== "pending" && prop.status !== "pending_topup") {
        return json({ error: "Proposal is not awaiting top-up" }, 400);
      }
      if (prop.topup_paid_at) {
        return json({ error: "Top-up already paid for this trade" }, 409);
      }

      const topupDollars = Number(prop.topup_agreed || prop.topup_suggested || 0);
      if (topupDollars <= 0) return json({ error: "No top-up on this trade" }, 400);

      const feeDollars = Number((topupDollars * 0.05).toFixed(2));
      const netDollars = Number((topupDollars - feeDollars).toFixed(2));
      amountCents = Math.round(topupDollars * 100);

      metadata.purpose = "topup";
      metadata.proposal_id = proposalId;
      metadata.payer_id = user.id;
      metadata.payee_id = String(
        user.id === prop.proposer_id ? prop.receiver_id : prop.proposer_id,
      );
      metadata.topup_cents = String(amountCents);
      metadata.fee_cents = String(Math.round(feeDollars * 100));
      metadata.net_cents = String(Math.round(netDollars * 100));
      metadata.platform_fee_pct = "5";

      // Only the designated payer (or either party if unclear) may start payment —
      // accept flow always opens sheet for the user who owes; we allow proposer or receiver.
      if (user.id !== prop.proposer_id && user.id !== prop.receiver_id) {
        return json({ error: "Not a party to this trade" }, 403);
      }
    }

    // Purchase: compute totals from listing (never trust client amount)
    if (purpose === "purchase" && body.listingId) {
      const { data: listing, error: listErr } = await supabase
        .from("listings")
        .select("id, owner_id, name, value")
        .eq("id", body.listingId)
        .maybeSingle();
      if (listErr || !listing) return json({ error: "Listing not found" }, 404);
      if (listing.owner_id === user.id) {
        return json({ error: "Cannot buy your own listing" }, 400);
      }
      const value = Number(listing.value);
      const rates = await loadShippingRatesFromDb(supabase);
      const { fee, shipping, insurance, shippingLabel: sLabel, grandTotal, net } =
        computePurchaseTotals(value, rates);
      amountCents = Math.round(grandTotal * 100);
      shippingLabel = sLabel;
      Object.assign(metadata, {
        listing_id: listing.id,
        buyer_id: user.id,
        seller_id: listing.owner_id,
        card_name: listing.name,
        listing_value: String(value),
        fee: String(fee),
        net: String(net),
        shipping: String(shipping),
        insurance: String(insurance),
        shipping_label: sLabel,
      });
    }

    if (amountCents < 50) {
      return json({ error: "Amount too small" }, 400);
    }

    const shipping = body.shipping;
    const intentParams: Record<string, unknown> = {
      amount: amountCents,
      currency: (body.currency || "usd").toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata,
      receipt_email: user.email || undefined,
    };
    if (shipping?.name && shipping?.address) {
      intentParams.shipping = {
        name: shipping.name,
        address: {
          line1: shipping.address.line1,
          line2: shipping.address.line2 || undefined,
          city: shipping.address.city,
          state: shipping.address.state,
          postal_code: shipping.address.postal_code,
          country: shipping.address.country || "US",
        },
      };
    }

    const intent = await stripe.paymentIntents.create(
      intentParams as Stripe.PaymentIntentCreateParams,
    );

    if (purpose === "topup" && metadata.proposal_id) {
      await supabase
        .from("trade_proposals")
        .update({
          topup_payment_intent_id: intent.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", metadata.proposal_id);
    }

    return json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      amountCents,
      tradeFeeCents: purpose === "trade_fee" ? tradeFeeCents : undefined,
      labelCents: purpose === "trade_fee" ? labelCents : undefined,
      shippingLabel: shippingLabel || undefined,
      feeCents: purpose === "topup" ? Number(metadata.fee_cents || 0) : undefined,
      netCents: purpose === "topup" ? Number(metadata.net_cents || 0) : undefined,
    });
  } catch (e) {
    console.error("create-payment-intent", e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

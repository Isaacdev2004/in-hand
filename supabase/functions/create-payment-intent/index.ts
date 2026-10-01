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

    return json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      amountCents,
      tradeFeeCents: purpose === "trade_fee" ? tradeFeeCents : undefined,
      labelCents: purpose === "trade_fee" ? labelCents : undefined,
      shippingLabel: shippingLabel || undefined,
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

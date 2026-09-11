import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { computePurchaseTotals, loadShippingRatesFromDb } from "../_shared/pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
    const metadata: Record<string, string> = {
      purpose,
      user_id: user.id,
      ...(body.metadata || {}),
    };

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
      const { fee, shipping, insurance, shippingLabel, grandTotal, net } =
        computePurchaseTotals(value, rates);
      amountCents = Math.round(grandTotal * 100);
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
        shipping_label: shippingLabel,
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

    const intent = await stripe.paymentIntents.create(intentParams as Stripe.PaymentIntentCreateParams);

    return json({
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      amountCents,
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

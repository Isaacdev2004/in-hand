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
      return new Response(
        JSON.stringify({ error: "STRIPE_SECRET_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!bearer || bearer === anonKey) {
      return new Response(
        JSON.stringify({ error: "Sign in required. Pass Authorization: Bearer <user access token>." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user?.id) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { listingId, buyerId, successUrl, cancelUrl } = await req.json();

    if (!listingId || !buyerId || !successUrl || !cancelUrl) {
      return new Response(
        JSON.stringify({ error: "listingId, buyerId, successUrl, cancelUrl required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (user.id !== buyerId) {
      return new Response(JSON.stringify({ error: "buyerId must match signed-in user" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: listing, error: listErr } = await supabase
      .from("listings")
      .select("id, owner_id, name, value")
      .eq("id", listingId)
      .maybeSingle();

    if (listErr || !listing) {
      return new Response(
        JSON.stringify({ error: "Listing not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (listing.owner_id === buyerId) {
      return new Response(
        JSON.stringify({ error: "Buyer cannot purchase own listing" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const value = Number(listing.value);
    const rates = await loadShippingRatesFromDb(supabase);
    const { fee, shipping, insurance, shippingLabel, grandTotal, net } =
      computePurchaseTotals(value, rates);

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const unitAmount = Math.round(grandTotal * 100);
    if (unitAmount < 50) {
      return new Response(
        JSON.stringify({ error: "Amount too small for Stripe" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: user.email || undefined,
      billing_address_collection: "required",
      shipping_address_collection: {
        allowed_countries: ["US"],
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: unitAmount,
            product_data: {
              name: `In Hand — ${listing.name}`,
              description: `Listing ${listingId} · includes platform fee & estimated shipping`,
            },
          },
        },
      ],
      metadata: {
        listing_id: listingId,
        buyer_id: buyerId,
        seller_id: listing.owner_id,
        card_name: listing.name,
        listing_value: String(value),
        fee: String(fee),
        net: String(net),
        shipping: String(shipping),
        insurance: String(insurance),
        shipping_label: shippingLabel,
      },
    });

    return new Response(
      JSON.stringify({ sessionId: session.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(
      JSON.stringify({ error: String(e?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

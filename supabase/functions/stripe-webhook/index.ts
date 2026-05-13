import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";

Deno.serve(async (req) => {
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!stripeKey || !webhookSecret) {
    return new Response("Stripe not configured", { status: 500 });
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("No signature", { status: 400 });
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed", err);
    return new Response(`Webhook Error: ${err}`, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const md = session.metadata;
  if (!md?.listing_id || !md.buyer_id || !md.seller_id) {
    console.error("Missing metadata on session", session.id);
    return new Response(JSON.stringify({ received: true, skipped: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: seenEvent } = await supabase
    .from("stripe_events")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();

  if (seenEvent) {
    return new Response(JSON.stringify({ received: true, duplicate_event: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const txnId = `t_${session.id}`;
  const shipmentId = `sh_${session.id}`;
  const today = new Date().toISOString().split("T")[0];

  const { data: existing } = await supabase
    .from("transactions")
    .select("id")
    .eq("id", txnId)
    .maybeSingle();

  if (existing) {
    await supabase.from("stripe_events").insert({ id: event.id });
    return new Response(JSON.stringify({ received: true, idempotent: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const amount = parseFloat(md.listing_value);
  const fee = parseFloat(md.fee);
  const net = parseFloat(md.net);
  const shipping = parseFloat(md.shipping ?? "0");

  const { error: txnErr } = await supabase.from("transactions").insert({
    id: txnId,
    type: "purchase",
    buyer_id: md.buyer_id,
    seller_id: md.seller_id,
    card_id: null,
    amount,
    fee,
    net,
    status: "in_escrow",
    method: "stripe",
    date: today,
    card_name: md.card_name,
    rated: false,
  });

  if (txnErr) {
    console.error("transaction insert", txnErr);
    return new Response(JSON.stringify({ error: txnErr.message }), { status: 500 });
  }

  const { error: shipErr } = await supabase.from("shipments").insert({
    id: shipmentId,
    txn_id: txnId,
    tracking_number: "",
    carrier: "USPS Ground",
    status: "label_pending",
    estimated_delivery: "",
    shipping_cost: shipping,
    shipping_label: md.shipping_label ?? "",
    from_user: md.seller_id,
    to_user: md.buyer_id,
    figure_name: md.card_name,
    figure_value: amount,
    funds_released: false,
    auto_released: false,
    delivered_at: null,
    dispute_frozen: false,
    events: [],
  });

  if (shipErr) {
    console.error("shipment insert", shipErr);
    return new Response(JSON.stringify({ error: shipErr.message }), { status: 500 });
  }

  const { error: delErr } = await supabase
    .from("listings")
    .delete()
    .eq("id", md.listing_id);

  if (delErr) {
    console.error("listing delete", delErr);
  }

  const { error: evErr } = await supabase.from("stripe_events").insert({ id: event.id });
  if (evErr && (evErr as { code?: string }).code !== "23505") {
    console.error("stripe_events insert", evErr);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});

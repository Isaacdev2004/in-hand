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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: seenEvent } = await supabase
    .from("stripe_events")
    .select("id")
    .eq("id", event.id)
    .maybeSingle();

  if (seenEvent) {
    return json({ received: true, duplicate_event: true });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = await stripe.checkout.sessions.retrieve(
        (event.data.object as Stripe.Checkout.Session).id,
      );
      await fulfillPurchase(supabase, {
        idKey: session.id,
        md: session.metadata || {},
        shipTo: shipToFromCheckout(session),
        method: "stripe_checkout",
      });
    } else if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object as Stripe.PaymentIntent;
      const md = pi.metadata || {};
      if (md.purpose === "trade_fee") {
        await supabase.from("stripe_events").insert({ id: event.id });
        return json({ received: true, trade_fee: true });
      }
      if (md.purpose === "purchase" || md.listing_id) {
        await fulfillPurchase(supabase, {
          idKey: pi.id,
          md,
          shipTo: shipToFromPaymentIntent(pi),
          method: "stripe_payment_sheet",
        });
      } else {
        await supabase.from("stripe_events").insert({ id: event.id });
        return json({ received: true, skipped: true });
      }
    } else {
      return json({ received: true });
    }

    await supabase.from("stripe_events").insert({ id: event.id });
    return json({ received: true });
  } catch (e) {
    console.error("stripe-webhook fulfill", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

async function fulfillPurchase(
  supabase: ReturnType<typeof createClient>,
  opts: {
    idKey: string;
    md: Stripe.Metadata;
    shipTo: ReturnType<typeof shipToFromCheckout>;
    method: string;
  },
) {
  const { idKey, md, shipTo, method } = opts;
  if (!md?.listing_id || !md.buyer_id || !md.seller_id) {
    throw new Error("Missing purchase metadata");
  }

  const txnId = `t_${idKey}`;
  const shipmentId = `sh_${idKey}`;
  const today = new Date().toISOString().split("T")[0];

  const { data: existing } = await supabase
    .from("transactions")
    .select("id")
    .eq("id", txnId)
    .maybeSingle();
  if (existing) return;

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
    method,
    date: today,
    card_name: md.card_name,
    rated: false,
  });
  if (txnErr) throw txnErr;

  const { data: sellerRow } = await supabase
    .from("users")
    .select("username, addresses")
    .eq("id", md.seller_id)
    .maybeSingle();
  const sellerDefault = Array.isArray(sellerRow?.addresses)
    ? sellerRow.addresses.find((a: { isDefault?: boolean }) => a.isDefault) ||
      sellerRow.addresses[0]
    : null;
  const shipFrom = sellerDefault?.street
    ? {
        name: sellerDefault.name || sellerRow?.username || "Seller",
        street: sellerDefault.street,
        city: sellerDefault.city,
        state: sellerDefault.state,
        zip: sellerDefault.zip,
        country: "US",
      }
    : null;

  if (shipTo) {
    const { data: buyerRow } = await supabase
      .from("users")
      .select("id, addresses")
      .eq("id", md.buyer_id)
      .maybeSingle();
    const existingAddrs = Array.isArray(buyerRow?.addresses) ? buyerRow.addresses : [];
    const hasComplete = existingAddrs.some(
      (a: { street?: string; zip?: string }) => a?.street && a?.zip,
    );
    if (!hasComplete) {
      await supabase
        .from("users")
        .update({
          addresses: [
            {
              id: `stripe_${idKey}`,
              label: "Home",
              name: shipTo.name,
              street: shipTo.street,
              city: shipTo.city,
              state: shipTo.state,
              zip: shipTo.zip,
              isDefault: true,
            },
          ],
        })
        .eq("id", md.buyer_id);
    }
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
    ship_to: shipTo,
    ship_from: shipFrom,
  });
  if (shipErr) throw shipErr;

  await supabase.from("listings").delete().eq("id", md.listing_id);

  await supabase.from("notifications").insert([
    {
      id: `n_buy_s_${shipmentId}`,
      recipient_id: md.seller_id,
      type: "sale",
      is_read: false,
      title: "Item sold — time to ship",
      body: `${md.card_name} sold. Generate your USPS label in the Ship tab.`,
      link: "shipping",
      related_user_id: md.buyer_id,
    },
    {
      id: `n_buy_b_${shipmentId}`,
      recipient_id: md.buyer_id,
      type: "purchase",
      is_read: false,
      title: "Purchase confirmed",
      body: `You bought ${md.card_name}. Tracking will appear when the seller ships.`,
      link: "shipping",
      related_user_id: md.seller_id,
    },
  ]);
}

function shipToFromCheckout(session: Stripe.Checkout.Session) {
  const details = session.shipping_details;
  const addr = details?.address;
  if (!addr?.line1 || !addr.city || !addr.state || !addr.postal_code) return null;
  return {
    name: details?.name || "Buyer",
    street: [addr.line1, addr.line2].filter(Boolean).join(", "),
    city: addr.city,
    state: addr.state,
    zip: addr.postal_code,
    country: addr.country || "US",
  };
}

function shipToFromPaymentIntent(pi: Stripe.PaymentIntent) {
  const details = pi.shipping;
  const addr = details?.address;
  if (!addr?.line1 || !addr.city || !addr.state || !addr.postal_code) return null;
  return {
    name: details?.name || "Buyer",
    street: [addr.line1, addr.line2].filter(Boolean).join(", "),
    city: addr.city,
    state: addr.state,
    zip: addr.postal_code,
    country: addr.country || "US",
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

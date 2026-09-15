import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";

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

    const { shipmentId } = await req.json();
    if (!shipmentId) return json({ error: "shipmentId required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: shipment, error: shipErr } = await admin
      .from("shipments")
      .select("id, from_user, txn_id, funds_released")
      .eq("id", shipmentId)
      .maybeSingle();
    if (shipErr || !shipment) {
      return json({ error: "Shipment not found" }, 404);
    }
    if (!shipment.funds_released) {
      return json({ error: "Escrow not released yet" }, 400);
    }

    // Seller, buyer, or service-triggered session may call after release
    const { data: txn, error: txnErr } = await admin
      .from("transactions")
      .select("id, net, seller_id, buyer_id, stripe_transfer_id, status")
      .eq("id", shipment.txn_id)
      .maybeSingle();
    if (txnErr || !txn) {
      return json({ error: "Transaction not found" }, 404);
    }
    if (txn.stripe_transfer_id) {
      return json({ ok: true, alreadyTransferred: true, transferId: txn.stripe_transfer_id });
    }

    const sellerId = txn.seller_id || shipment.from_user;
    const { data: seller } = await admin
      .from("users")
      .select("id, stripe_account_id")
      .eq("id", sellerId)
      .maybeSingle();

    if (!seller?.stripe_account_id) {
      return json({
        ok: false,
        skipped: true,
        reason: "Seller has not completed Set up payouts (Stripe Connect)",
      });
    }

    const netCents = Math.round(Number(txn.net || 0) * 100);
    if (!Number.isFinite(netCents) || netCents < 1) {
      return json({ error: "Nothing to transfer" }, 400);
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const account = await stripe.accounts.retrieve(seller.stripe_account_id);
    if (!account.payouts_enabled) {
      return json({
        ok: false,
        skipped: true,
        reason: "Seller Connect account not fully verified yet",
      });
    }

    const transfer = await stripe.transfers.create({
      amount: netCents,
      currency: "usd",
      destination: seller.stripe_account_id,
      transfer_group: `inhand_${txn.id}`,
      metadata: {
        inhand_shipment_id: shipment.id,
        inhand_txn_id: txn.id,
        inhand_seller_id: sellerId,
      },
    }, {
      idempotencyKey: `inhand_transfer_${txn.id}`,
    });

    await admin
      .from("transactions")
      .update({ stripe_transfer_id: transfer.id })
      .eq("id", txn.id);

    return json({
      ok: true,
      transferId: transfer.id,
      amountCents: netCents,
      note: "Funds moved to Connect Express; bank payout typically ~2 business days",
    });
  } catch (e) {
    console.error("transfer-seller-payout", e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

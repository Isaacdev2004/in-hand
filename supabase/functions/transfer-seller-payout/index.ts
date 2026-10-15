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
      .select("id, stripe_account_id, payout_preference, instant_payout_card")
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

    const preferInstant =
      seller.payout_preference === "instant" &&
      !!(seller.instant_payout_card as { external_account_id?: string } | null)?.external_account_id;

    let instantPayoutId: string | null = null;
    let instantNote =
      "Funds moved to Connect; standard bank payout typically ~2 business days";

    if (preferInstant) {
      try {
        // Stripe Instant Payouts fee (~1%) is deducted from the payout — seller bears it
        const payout = await stripe.payouts.create(
          {
            amount: netCents,
            currency: "usd",
            method: "instant",
            metadata: {
              inhand_shipment_id: shipment.id,
              inhand_txn_id: txn.id,
            },
          },
          {
            stripeAccount: seller.stripe_account_id,
            idempotencyKey: `inhand_instant_${txn.id}`,
          },
        );
        instantPayoutId = payout.id;
        instantNote =
          "Instant payout initiated — debit card usually within 30 minutes (Stripe ~1% fee deducted)";
      } catch (instErr) {
        console.error("transfer-seller-payout: instant failed, leaving on Connect balance", instErr);
        instantNote = `Transfer OK; Instant Payout failed (${String(
          (instErr as Error)?.message || instErr,
        )}). Funds stay on Connect for standard payout.`;
      }
    }

    return json({
      ok: true,
      transferId: transfer.id,
      amountCents: netCents,
      instantPayoutId,
      payoutPreference: preferInstant ? "instant" : "standard",
      note: instantNote,
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

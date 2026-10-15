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

    const body = await req.json().catch(() => ({}));
    const tokenId = String(body.tokenId || "").trim();
    if (!tokenId.startsWith("tok_")) {
      return json({ error: "Card token required from Stripe Card Element" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    let { data: profile } = await admin
      .from("users")
      .select("id, username, stripe_account_id, payout_preference, instant_payout_card")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile) {
      const username =
        user.user_metadata?.username || user.email?.split("@")[0] || "Collector";
      const row = {
        id: user.id,
        username,
        avatar: username.slice(0, 2).toUpperCase(),
        rating: 5,
        trades_completed: 0,
        joined: new Date().toISOString().split("T")[0],
        location: "",
        wishlist: [],
        wallet_balance: 0,
        payment_methods: [],
        addresses: [],
        flag_count: 0,
      };
      await admin.from("users").upsert(row, { onConflict: "id" });
      profile = { id: user.id, username, stripe_account_id: null, payout_preference: "standard", instant_payout_card: null };
    }

    let accountId = profile.stripe_account_id || "";
    if (!accountId) {
      // Prefer platform-controlled account so debit card can attach via API (in-app Card Element)
      try {
        const account = await stripe.accounts.create({
          country: "US",
          email: user.email || undefined,
          business_type: "individual",
          capabilities: {
            transfers: { requested: true },
            card_payments: { requested: true },
          },
          controller: {
            fees: { payer: "application" },
            losses: { payments: "application" },
            stripe_dashboard: { type: "express" },
            requirement_collection: "application",
          },
          business_profile: {
            product_description: "In Hand collector marketplace payouts",
          },
          metadata: { inhand_user_id: user.id },
        });
        accountId = account.id;
      } catch (ctrlErr) {
        console.warn("attach-instant-payout-card: controller create failed, Express fallback", ctrlErr);
        const account = await stripe.accounts.create({
          type: "express",
          email: user.email || undefined,
          capabilities: {
            transfers: { requested: true },
            card_payments: { requested: true },
          },
          business_profile: {
            product_description: "In Hand collector marketplace payouts",
          },
          metadata: { inhand_user_id: user.id },
        });
        accountId = account.id;
      }
      await admin
        .from("users")
        .update({ stripe_account_id: accountId })
        .eq("id", user.id);
    }

    const card = await stripe.accounts.createExternalAccount(accountId, {
      external_account: tokenId,
      default_for_currency: true,
    });

    if (card.object === "card" && card.funding && card.funding !== "debit") {
      // Still allow — Stripe Instant Payouts eligibility is checked at payout time
      console.warn("attach-instant-payout-card: funding is", card.funding);
    }

    const summary = {
      brand: (card as Stripe.Card).brand || "card",
      last4: (card as Stripe.Card).last4 || "••••",
      exp_month: (card as Stripe.Card).exp_month || null,
      exp_year: (card as Stripe.Card).exp_year || null,
      funding: (card as Stripe.Card).funding || null,
      external_account_id: card.id,
    };

    await admin
      .from("users")
      .update({
        payout_preference: "instant",
        instant_payout_card: summary,
        stripe_account_id: accountId,
      })
      .eq("id", user.id);

    return json({
      ok: true,
      accountId,
      payoutPreference: "instant",
      instantPayoutCard: summary,
    });
  } catch (e) {
    console.error("attach-instant-payout-card", e);
    const msg = String(e?.message ?? e);
    return json(
      {
        error: /external.?account|debit|express|controller/i.test(msg)
          ? `${msg} — In Stripe Dashboard enable debit cards for Connect external accounts, or finish Standard bank setup first.`
          : msg,
      },
      500,
    );
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

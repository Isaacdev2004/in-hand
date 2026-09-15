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

    const { returnUrl, refreshUrl } = await req.json();
    const origin = returnUrl || "https://in-hand-b5gm.vercel.app";
    const refresh = refreshUrl || origin;

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await admin
      .from("users")
      .select("id, username, stripe_account_id")
      .eq("id", user.id)
      .maybeSingle();

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    let accountId = profile?.stripe_account_id;
    if (!accountId) {
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
        settings: {
          payouts: {
            schedule: {
              interval: "daily",
              delay_days: 2,
            },
          },
        },
        metadata: { inhand_user_id: user.id },
      });
      accountId = account.id;
      await admin
        .from("users")
        .update({ stripe_account_id: accountId })
        .eq("id", user.id);
    }

    const account = await stripe.accounts.retrieve(accountId);
    const chargesEnabled = !!(account.charges_enabled && account.payouts_enabled);

    if (chargesEnabled) {
      const login = await stripe.accounts.createLoginLink(accountId);
      return json({
        ready: true,
        accountId,
        url: login.url,
      });
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refresh,
      return_url: origin,
      type: "account_onboarding",
    });

    return json({
      ready: false,
      accountId,
      url: link.url,
    });
  } catch (e) {
    console.error("create-connect-account", e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

    const supabase = createClient(supabaseUrl, serviceKey);
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    let { data: profile } = await supabase
      .from("users")
      .select("id, username, stripe_customer_id, payment_methods")
      .eq("id", user.id)
      .maybeSingle();

    // Auth user without profile row → sync later finds no customer (card "saves" but UI empty)
    if (!profile) {
      const username =
        user.user_metadata?.username || user.email?.split("@")[0] || "Collector";
      const row = {
        id: user.id,
        username,
        avatar: user.user_metadata?.avatar || username.slice(0, 2).toUpperCase(),
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
      const { data: inserted, error: insErr } = await supabase
        .from("users")
        .upsert(row, { onConflict: "id" })
        .select("id, username, stripe_customer_id, payment_methods")
        .maybeSingle();
      if (insErr) {
        console.error("create-setup-intent: profile upsert failed", insErr);
      }
      profile = inserted || row;
    }

    let customerId = profile?.stripe_customer_id || "";
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        name: profile?.username || undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      const { error: updErr } = await supabase
        .from("users")
        .update({ stripe_customer_id: customerId })
        .eq("id", user.id);
      if (updErr) {
        console.error("create-setup-intent: stripe_customer_id update failed", updErr);
      }
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      usage: "off_session",
      metadata: { user_id: user.id },
    });

    return json({
      clientSecret: setupIntent.client_secret,
      customerId,
      livemode: !!setupIntent.livemode,
    });
  } catch (e) {
    console.error("create-setup-intent", e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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

    const { data: profile } = await supabase
      .from("users")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile?.stripe_customer_id) {
      return json({ paymentMethods: [], customerId: null });
    }

    const list = await stripe.paymentMethods.list({
      customer: profile.stripe_customer_id,
      type: "card",
    });

    const customer = await stripe.customers.retrieve(profile.stripe_customer_id);
    const defaultPm =
      typeof customer !== "string" && !customer.deleted
        ? (customer.invoice_settings?.default_payment_method as string) || ""
        : "";

    const paymentMethods = list.data.map((pm, i) => ({
      id: pm.id,
      type: "card",
      brand: pm.card?.brand || "card",
      last4: pm.card?.last4 || "••••",
      expiry: pm.card ? `${String(pm.card.exp_month).padStart(2, "0")}/${String(pm.card.exp_year).slice(-2)}` : "",
      isDefault: pm.id === defaultPm || (!defaultPm && i === 0),
      stripePaymentMethodId: pm.id,
    }));

    if (paymentMethods.length && !paymentMethods.some((p) => p.isDefault)) {
      paymentMethods[0].isDefault = true;
    }

    await supabase
      .from("users")
      .update({ payment_methods: paymentMethods })
      .eq("id", user.id);

    return json({ paymentMethods, customerId: profile.stripe_customer_id });
  } catch (e) {
    console.error("sync-payment-methods", e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

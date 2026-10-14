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
    const ensurePaymentMethodId = String(body?.ensurePaymentMethodId || "").trim();

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

    let customerId = profile?.stripe_customer_id || "";

    // Recover customer if profile row never got stripe_customer_id (common cause of "saved but empty")
    if (!customerId && ensurePaymentMethodId) {
      try {
        const pm = await stripe.paymentMethods.retrieve(ensurePaymentMethodId);
        if (typeof pm.customer === "string" && pm.customer) {
          customerId = pm.customer;
          await supabase
            .from("users")
            .update({ stripe_customer_id: customerId })
            .eq("id", user.id);
        }
      } catch (e) {
        console.warn("sync-payment-methods: PM retrieve failed", e);
      }
    }

    if (!customerId && user.email) {
      const byEmail = await stripe.customers
        .list({ email: user.email, limit: 5 })
        .catch(() => null);
      const hit =
        byEmail?.data?.find((c) => c.metadata?.user_id === user.id) ||
        byEmail?.data?.[0];
      if (hit?.id) {
        customerId = hit.id;
        await supabase
          .from("users")
          .update({ stripe_customer_id: customerId })
          .eq("id", user.id);
      }
    }

    if (!customerId) {
      return json({ paymentMethods: [], customerId: null, warning: "No Stripe customer on file" });
    }

    if (ensurePaymentMethodId) {
      try {
        const pm = await stripe.paymentMethods.retrieve(ensurePaymentMethodId);
        if (!pm.customer) {
          await stripe.paymentMethods.attach(ensurePaymentMethodId, { customer: customerId });
        } else if (pm.customer !== customerId) {
          console.warn("sync-payment-methods: PM belongs to different customer", pm.customer, customerId);
        }
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: ensurePaymentMethodId },
        });
      } catch (e) {
        console.warn("sync-payment-methods: ensure PM failed", e);
      }
    }

    const list = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
    });

    const customer = await stripe.customers.retrieve(customerId);
    const defaultPm =
      typeof customer !== "string" && !customer.deleted
        ? (customer.invoice_settings?.default_payment_method as string) || ""
        : "";

    const paymentMethods = list.data.map((pm, i) => ({
      id: pm.id,
      type: "card",
      brand: pm.card?.brand || "card",
      last4: pm.card?.last4 || "••••",
      expiry: pm.card
        ? `${String(pm.card.exp_month).padStart(2, "0")}/${String(pm.card.exp_year).slice(-2)}`
        : "",
      isDefault: pm.id === defaultPm || (!defaultPm && i === 0),
      stripePaymentMethodId: pm.id,
    }));

    if (paymentMethods.length && !paymentMethods.some((p) => p.isDefault)) {
      paymentMethods[0].isDefault = true;
    }

    const { error: updErr } = await supabase
      .from("users")
      .update({
        payment_methods: paymentMethods,
        stripe_customer_id: customerId,
      })
      .eq("id", user.id);

    if (updErr) {
      console.error("sync-payment-methods: profile update failed", updErr);
      // Still return Stripe list so the app UI can show the card
    }

    return json({ paymentMethods, customerId });
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

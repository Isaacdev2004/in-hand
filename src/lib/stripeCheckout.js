import { loadStripe } from "@stripe/stripe-js";

let stripePromise;

function getStripe() {
  const key = process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY;
  if (!key) return null;
  if (!stripePromise) stripePromise = loadStripe(key);
  return stripePromise;
}

/**
 * Starts hosted Stripe Checkout via Supabase Edge Function
 * `create-checkout-session` (validates listing + totals server-side).
 */
export async function startStripeCheckout(payload) {
  const stripeLoader = getStripe();
  if (!stripeLoader) {
    throw new Error(
      "Stripe publishable key missing. Set REACT_APP_STRIPE_PUBLISHABLE_KEY."
    );
  }

  const supabaseUrl = (process.env.REACT_APP_SUPABASE_URL || "").replace(/\/$/, "");
  const anon = process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anon) {
    throw new Error(
      "Supabase URL and anon key required for checkout. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY."
    );
  }

  const url =
    (process.env.REACT_APP_STRIPE_CHECKOUT_URL || "").trim() ||
    `${supabaseUrl}/functions/v1/create-checkout-session`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anon}`,
      apikey: anon,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Checkout session request failed (${res.status}): ${txt}`);
  }

  const body = await res.json();
  if (!body?.sessionId) throw new Error("Missing sessionId in Stripe response.");

  const stripe = await stripeLoader;
  if (!stripe) throw new Error("Failed to initialize Stripe.js.");
  const { error } = await stripe.redirectToCheckout({ sessionId: body.sessionId });
  if (error) throw error;
}

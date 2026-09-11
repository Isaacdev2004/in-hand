import { loadStripe } from "@stripe/stripe-js";
import { supabase } from "./supabaseClient";

let stripePromise;

function getStripe() {
  const key = process.env.REACT_APP_STRIPE_PUBLISHABLE_KEY;
  if (!key) return null;
  if (!stripePromise) stripePromise = loadStripe(key);
  return stripePromise;
}

async function authHeaders() {
  const anon = process.env.REACT_APP_SUPABASE_ANON_KEY;
  const { data: sessWrap } = await supabase.auth.getSession();
  const accessToken = sessWrap?.session?.access_token;
  if (!accessToken) throw new Error("Sign in required.");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    apikey: anon,
  };
}

/**
 * Creates a PaymentIntent and confirms it with Stripe Payment Element / Payment Sheet UX.
 * Card details never touch our servers — only Stripe.
 * Apple Pay / Google Pay appear when the device + Stripe dashboard allow them.
 */
export async function payWithPaymentSheet({
  amountCents,
  purpose = "purchase",
  metadata = {},
  onReady,
}) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const stripeLoader = getStripe();
  if (!stripeLoader) {
    throw new Error("Stripe publishable key missing.");
  }

  const supabaseUrl = (process.env.REACT_APP_SUPABASE_URL || "").replace(/\/$/, "");
  const headers = await authHeaders();
  const res = await fetch(`${supabaseUrl}/functions/v1/create-payment-intent`, {
    method: "POST",
    headers,
    body: JSON.stringify({ amountCents, purpose, metadata }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `PaymentIntent failed (${res.status})`);
  if (!body.clientSecret) throw new Error("Missing clientSecret");

  const stripe = await stripeLoader;
  if (!stripe) throw new Error("Stripe.js failed to load");

  // Caller mounts Payment Element; we return handles for confirm
  if (typeof onReady === "function") {
    return onReady({ stripe, clientSecret: body.clientSecret, paymentIntentId: body.paymentIntentId });
  }

  // Fallback: browser Payment Request / card via confirmPayment redirect-less
  const result = await stripe.confirmPayment({
    clientSecret: body.clientSecret,
    confirmParams: {
      return_url: window.location.href.split("#")[0],
    },
    redirect: "if_required",
  });
  if (result.error) throw new Error(result.error.message);
  return result.paymentIntent;
}

export async function createPaymentIntent({
  amountCents,
  purpose,
  metadata,
  listingId,
  shipping,
}) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const supabaseUrl = (process.env.REACT_APP_SUPABASE_URL || "").replace(/\/$/, "");
  const headers = await authHeaders();
  const res = await fetch(`${supabaseUrl}/functions/v1/create-payment-intent`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      amountCents,
      purpose,
      metadata,
      listingId,
      shipping,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `PaymentIntent failed (${res.status})`);
  return body;
}

export { getStripe };

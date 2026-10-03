import { supabase } from "./supabaseClient";

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

function fnUrl(name) {
  const base = (process.env.REACT_APP_SUPABASE_URL || "").replace(/\/$/, "");
  return `${base}/functions/v1/${name}`;
}

export function hasUsablePaymentMethod(user) {
  const list = user?.paymentMethods || [];
  return list.some((pm) => pm?.last4 || pm?.stripePaymentMethodId || pm?.id);
}

export function hasStripeConnect(user) {
  return !!(user?.stripeAccountId || user?.stripe_account_id);
}

export async function createSetupIntent() {
  if (!supabase) throw new Error("Supabase is not configured.");
  const res = await fetch(fnUrl("create-setup-intent"), {
    method: "POST",
    headers: await authHeaders(),
    body: "{}",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `SetupIntent failed (${res.status})`);
  return body;
}

export async function syncPaymentMethods() {
  if (!supabase) throw new Error("Supabase is not configured.");
  const res = await fetch(fnUrl("sync-payment-methods"), {
    method: "POST",
    headers: await authHeaders(),
    body: "{}",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Sync failed (${res.status})`);
  return body;
}

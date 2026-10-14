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

export async function syncPaymentMethods({ ensurePaymentMethodId } = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const res = await fetch(fnUrl("sync-payment-methods"), {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      ensurePaymentMethodId: ensurePaymentMethodId || undefined,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Sync failed (${res.status})`);
  return body;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * After SetupIntent succeeds, pull cards from Stripe (retry once — attach can lag).
 */
export async function syncPaymentMethodsAfterSetup(setupIntent) {
  const pmRaw = setupIntent?.payment_method;
  const pmId = typeof pmRaw === "string" ? pmRaw : pmRaw?.id || "";

  let synced = await syncPaymentMethods({ ensurePaymentMethodId: pmId || undefined });
  let methods = synced?.paymentMethods || [];

  if (!methods.length) {
    await sleep(900);
    synced = await syncPaymentMethods({ ensurePaymentMethodId: pmId || undefined });
    methods = synced?.paymentMethods || [];
  }

  // Last resort: show the card from the SetupIntent response so UI isn't empty
  if (!methods.length && pmRaw && typeof pmRaw === "object" && pmRaw.card) {
    methods = [
      {
        id: pmRaw.id || pmId,
        type: "card",
        brand: pmRaw.card.brand || "card",
        last4: pmRaw.card.last4 || "••••",
        expiry: `${String(pmRaw.card.exp_month).padStart(2, "0")}/${String(pmRaw.card.exp_year).slice(-2)}`,
        isDefault: true,
        stripePaymentMethodId: pmRaw.id || pmId,
      },
    ];
  }

  if (!methods.length) {
    throw new Error(
      "Card was confirmed with Stripe but not listed on your profile yet. Tap Refresh from Stripe — if it stays empty, sync-payment-methods may need deploy (Owner).",
    );
  }

  return { ...synced, paymentMethods: methods };
}

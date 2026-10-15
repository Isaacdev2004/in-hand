import { Capacitor } from "@capacitor/core";
import { supabase } from "./supabaseClient";
import { openInAppBrowser } from "./openInAppBrowser";

const WEB_ORIGIN = "https://in-hand-b5gm.vercel.app";

function connectReturnUrls() {
  // Stripe requires https return URLs (custom schemes are rejected).
  // Vercel page can deep-link back via inhand:// after Connect finishes.
  if (Capacitor.isNativePlatform()) {
    return {
      returnUrl: `${WEB_ORIGIN}/?connect=return&app=1`,
      refreshUrl: `${WEB_ORIGIN}/?connect=refresh&app=1`,
    };
  }
  const base = `${window.location.origin}${window.location.pathname}`;
  return {
    returnUrl: `${base}?connect=return`,
    refreshUrl: `${base}?connect=refresh`,
  };
}

/**
 * Starts Stripe Connect Express onboarding (or opens Express dashboard if ready).
 */
export async function startStripeConnectOnboarding() {
  if (!supabase) throw new Error("Supabase is not configured.");
  const supabaseUrl = (process.env.REACT_APP_SUPABASE_URL || "").replace(/\/$/, "");
  const anon = process.env.REACT_APP_SUPABASE_ANON_KEY;
  const { data: sessWrap } = await supabase.auth.getSession();
  const accessToken = sessWrap?.session?.access_token;
  if (!accessToken) throw new Error("Sign in required.");

  const { returnUrl, refreshUrl } = connectReturnUrls();

  const res = await fetch(`${supabaseUrl}/functions/v1/create-connect-account`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: anon,
    },
    body: JSON.stringify({ returnUrl, refreshUrl }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Connect failed (${res.status})`);
  if (!body.url) throw new Error("No Connect onboarding URL returned");
  return body;
}

/**
 * Opens Stripe Connect Express onboarding inside an in-app browser sheet
 * (not the external Safari app). Bank KYC must use Stripe’s hosted form.
 */
export async function openConnectOnboardingInApp(url) {
  if (!url) throw new Error("No Connect URL");
  return openInAppBrowser(url);
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

/** Attach debit card token for Instant Payouts (in-app Card Element → tok_). */
export async function attachInstantPayoutCard(tokenId) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const supabaseUrl = (process.env.REACT_APP_SUPABASE_URL || "").replace(/\/$/, "");
  const res = await fetch(`${supabaseUrl}/functions/v1/attach-instant-payout-card`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ tokenId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Instant payout card failed (${res.status})`);
  return body;
}

/** Prefer instant (debit) or standard (bank) for escrow releases. */
export async function setPayoutPreference(preference) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data: sessWrap } = await supabase.auth.getSession();
  const uid = sessWrap?.session?.user?.id;
  if (!uid) throw new Error("Sign in required.");
  const { error } = await supabase
    .from("users")
    .update({ payout_preference: preference === "instant" ? "instant" : "standard" })
    .eq("id", uid);
  if (error) throw error;
  return { payoutPreference: preference === "instant" ? "instant" : "standard" };
}

/**
 * After escrow release: transfer seller net to their Connect Express account.
 * Bank payout then follows Stripe’s ~2 business-day Express schedule.
 */
export async function transferSellerPayout(shipmentId) {
  if (!supabase || !shipmentId) return { skipped: true };
  const supabaseUrl = (process.env.REACT_APP_SUPABASE_URL || "").replace(/\/$/, "");
  const anon = process.env.REACT_APP_SUPABASE_ANON_KEY;
  const { data: sessWrap } = await supabase.auth.getSession();
  const accessToken = sessWrap?.session?.access_token;
  if (!accessToken) return { skipped: true, reason: "no-session" };

  const res = await fetch(`${supabaseUrl}/functions/v1/transfer-seller-payout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: anon,
    },
    body: JSON.stringify({ shipmentId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Payout transfer failed (${res.status})`);
  return body;
}

import { supabase } from "./supabaseClient";

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

  const returnUrl = `${window.location.origin}${window.location.pathname}?connect=return`;
  const refreshUrl = `${window.location.origin}${window.location.pathname}?connect=refresh`;

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

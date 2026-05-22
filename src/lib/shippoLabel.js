import { supabase } from "./supabaseClient";

/**
 * Purchase a USPS label via Supabase Edge Function (Shippo token stays server-side).
 */
export async function createShippingLabel({ shipmentId, fromAddress }) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const supabaseUrl = (process.env.REACT_APP_SUPABASE_URL || "").replace(/\/$/, "");
  const anon = process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anon) {
    throw new Error("Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY.");
  }

  const { data: sessWrap } = await supabase.auth.getSession();
  const accessToken = sessWrap?.session?.access_token;
  if (!accessToken) {
    throw new Error("Sign in required to generate a label.");
  }

  const url = `${supabaseUrl}/functions/v1/create-shipping-label`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: anon,
    },
    body: JSON.stringify({ shipmentId, fromAddress }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || `Label request failed (${res.status})`);
  }
  return body;
}

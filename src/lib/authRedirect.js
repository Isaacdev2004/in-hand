import { Capacitor } from "@capacitor/core";

/** Web path + native scheme for Supabase email links (signup, reset). */
export const AUTH_CALLBACK_WEB_PATH = "/auth/callback";
export const AUTH_CALLBACK_NATIVE = "inhand://auth/callback";

export function getAuthRedirectUrl() {
  if (typeof window === "undefined") return AUTH_CALLBACK_NATIVE;
  if (Capacitor.isNativePlatform()) return AUTH_CALLBACK_NATIVE;
  return `${window.location.origin}${AUTH_CALLBACK_WEB_PATH}`;
}

export function isAuthCallbackUrl(url) {
  if (!url) return false;
  return (
    url.includes("auth/callback") ||
    url.includes("access_token=") ||
    url.includes("refresh_token=") ||
    url.includes("type=recovery") ||
    /[?&#]code=/.test(url)
  );
}

/**
 * Complete Supabase auth from email deep link (native app or web).
 * Returns true when tokens/code were applied.
 */
export async function handleSupabaseAuthDeepLink(url, supabaseClient) {
  if (!url || !supabaseClient) return false;

  try {
    const codeMatch = url.match(/[?&#]code=([^&#]+)/);
    if (codeMatch?.[1]) {
      const { error } = await supabaseClient.auth.exchangeCodeForSession(
        decodeURIComponent(codeMatch[1])
      );
      if (error) {
        console.warn("In Hand: exchangeCodeForSession failed", error);
        return false;
      }
      return true;
    }

    const hashPart = url.includes("#") ? url.split("#").slice(1).join("#") : "";
    if (hashPart) {
      const params = new URLSearchParams(hashPart);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      if (access_token && refresh_token) {
        const { error } = await supabaseClient.auth.setSession({
          access_token,
          refresh_token,
        });
        if (error) {
          console.warn("In Hand: setSession failed", error);
          return false;
        }
        return true;
      }
    }
  } catch (e) {
    console.warn("In Hand: auth deep link handling failed", e);
  }
  return false;
}

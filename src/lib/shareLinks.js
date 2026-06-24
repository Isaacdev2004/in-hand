import { Capacitor } from "@capacitor/core";

/** Public web origin for listing pages on the web. */
export const DEFAULT_WEB_ORIGIN = "https://in-hand-b5gm.vercel.app";

export function getWebOrigin() {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return process.env.REACT_APP_PUBLIC_ORIGIN || DEFAULT_WEB_ORIGIN;
}

export function getListingDeepLink(listingId) {
  return `inhand://listing/${listingId}`;
}

/**
 * Link copied/shared from the app.
 * Native: inhand:// opens In Hand directly (no Universal Links / extra signing needed).
 * Web: https URL for browser users.
 */
export function getListingShareUrl(listingId) {
  if (typeof window !== "undefined" && Capacitor.isNativePlatform()) {
    return getListingDeepLink(listingId);
  }
  return `${getWebOrigin()}/listing/${listingId}`;
}

/** Extract listing id from inhand:// or https://…/listing/{id} URLs. */
export function parseListingIdFromUrl(url) {
  if (!url) return null;
  try {
    const normalized = url.replace(/^inhand:\/\//, "https://inhand.local/");
    const u = new URL(normalized);
    const m = u.pathname.match(/\/listing\/([^/?#]+)/i);
    return m?.[1] ? decodeURIComponent(m[1]) : null;
  } catch {
    const m = String(url).match(/\/listing\/([^/?#&]+)/i);
    return m?.[1] ? decodeURIComponent(m[1]) : null;
  }
}

export function isListingUrl(url) {
  return !!parseListingIdFromUrl(url);
}

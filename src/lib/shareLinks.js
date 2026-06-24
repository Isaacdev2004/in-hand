/** Public web origin for share links (Universal Links on iOS). */
export const DEFAULT_WEB_ORIGIN = "https://in-hand-b5gm.vercel.app";

export function getWebOrigin() {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return process.env.REACT_APP_PUBLIC_ORIGIN || DEFAULT_WEB_ORIGIN;
}

/** HTTPS link shared in messages — opens the app when Universal Links are configured. */
export function getListingShareUrl(listingId) {
  return `${getWebOrigin()}/listing/${listingId}`;
}

export function getListingDeepLink(listingId) {
  return `inhand://listing/${listingId}`;
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

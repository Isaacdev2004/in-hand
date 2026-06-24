/** Public web origin for listing pages (clickable in iMessage, WhatsApp, etc.). */
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

/** HTTPS link — clickable in messages; mobile web redirects into the app. */
export function getListingShareUrl(listingId) {
  return `${getWebOrigin()}/listing/${listingId}`;
}

/** On mobile browser, jump to the native app (stays on web if app missing). */
export function tryOpenListingInApp(listingId) {
  if (typeof window === "undefined" || !listingId) return;
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (!mobile) return;
  window.location.href = getListingDeepLink(listingId);
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

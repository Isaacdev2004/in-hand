import { Capacitor } from "@capacitor/core";

const STRIPE_HOST =
  /(^|\.)stripe\.com$|(^|\.)stripecdn\.com$|(^|\.)stripe\.network$/i;

/** Connect Express / Dashboard must still open outside the app (bank KYC). */
function isConnectOrDashboard(host) {
  return /^(connect|dashboard)\.stripe\.com$/i.test(host);
}

function shouldKeepPaymentPopupInApp(url) {
  if (!url || typeof url !== "string") return false;
  if (url.startsWith("about:") || url === "blank") return false;
  try {
    const host = new URL(url, window.location.href).hostname;
    if (!STRIPE_HOST.test(host)) return false;
    if (isConnectOrDashboard(host)) return false;
    return true;
  } catch {
    return /stripe/i.test(url) && !/connect\.stripe|dashboard\.stripe/i.test(url);
  }
}

/**
 * Capacitor opens Safari for target=_blank / top-level navigations.
 * Stripe 3DS / Link often calls window.open — return null so Stripe uses an
 * in-page iframe challenge instead of leaving the app.
 */
export function keepStripeInApp() {
  let native = false;
  try {
    native = Capacitor.isNativePlatform();
  } catch {
    native = false;
  }
  if (!native) return;
  if (typeof window === "undefined" || window.__inhandStripeInAppPatched) return;
  window.__inhandStripeInAppPatched = true;

  const originalOpen = window.open.bind(window);
  window.open = (url, target, features) => {
    if (shouldKeepPaymentPopupInApp(String(url || ""))) {
      console.warn("In Hand: blocked Stripe payment window.open — keeping in-app", url);
      return null;
    }
    return originalOpen(url, target, features);
  };
}

export function appReturnUrl() {
  try {
    return window.location.href.split("#")[0] || "https://localhost";
  } catch {
    return "https://localhost";
  }
}

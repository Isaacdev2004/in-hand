import { Capacitor } from "@capacitor/core";

/**
 * Payment Element + wallets often redirect to Safari in Capacitor WKWebView.
 * Always use Card Element on native so card entry + confirm stay in-app.
 */
export function preferCardElement() {
  try {
    if (Capacitor.isNativePlatform()) return true;
  } catch {
    /* ignore */
  }
  try {
    if (typeof window !== "undefined" && window.Capacitor?.isNativePlatform?.()) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function waitForNode(ref, { maxFrames = 60 } = {}) {
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      if (ref?.current) {
        resolve(ref.current);
        return;
      }
      if (i++ >= maxFrames) {
        resolve(ref?.current || null);
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

/** Clear a mount node before remounting Stripe Elements. */
export function clearMountNode(node) {
  if (!node) return;
  try {
    while (node.firstChild) node.removeChild(node.firstChild);
  } catch {
    /* ignore */
  }
}

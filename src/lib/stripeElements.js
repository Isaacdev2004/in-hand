import { Capacitor } from "@capacitor/core";

/** Payment Element (iframes/wallets) is flaky in iOS WKWebView — use Card Element natively. */
export function preferCardElement() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
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

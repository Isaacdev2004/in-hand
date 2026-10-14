import { Capacitor } from "@capacitor/core";

/**
 * Open HTTPS URL inside the app (SFSafariViewController / Chrome Custom Tabs).
 * Falls back to window.open on web.
 */
export async function openInAppBrowser(url, { toolbarColor = "#2C3E50" } = {}) {
  if (!url) throw new Error("Missing URL");
  if (!Capacitor.isNativePlatform()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return { mode: "window" };
  }
  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({
      url,
      presentationStyle: "popover",
      toolbarColor,
    });
    return { mode: "browser", Browser };
  } catch (e) {
    console.warn("In Hand: Browser plugin unavailable, using window.open", e);
    window.open(url, "_blank", "noopener,noreferrer");
    return { mode: "window" };
  }
}

export async function closeInAppBrowser() {
  try {
    if (!Capacitor.isNativePlatform()) return;
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
  } catch {
    /* ignore */
  }
}

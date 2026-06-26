import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { Keyboard } from "@capacitor/keyboard";
import { supabase } from "../lib/supabaseClient";
import { handleSupabaseAuthDeepLink, isAuthCallbackUrl } from "../lib/authRedirect";
import { isListingUrl, parseListingIdFromUrl } from "../lib/shareLinks";

/** Deep-link handler: auth callback, listing share, or ?tab=browse|vault|wallet */
async function handleIncomingUrl(url) {
  if (!url || typeof window === "undefined") return;

  if (isAuthCallbackUrl(url) && supabase) {
    const ok = await handleSupabaseAuthDeepLink(url, supabase);
    if (ok) {
      window.dispatchEvent(new CustomEvent("inhand:auth-complete"));
      return;
    }
  }

  if (isListingUrl(url)) {
    const listingId = parseListingIdFromUrl(url);
    if (listingId) {
      try {
        sessionStorage.setItem("inhand-pending-listing", listingId);
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new CustomEvent("inhand:open-listing", { detail: { listingId } }));
      return;
    }
  }

  try {
    const parsed = new URL(url.replace(/^inhand:\/\//, "https://inhand.local/"));
    const tab = parsed.searchParams.get("tab");
    if (tab) {
      window.dispatchEvent(new CustomEvent("inhand:navigate", { detail: { tab } }));
    }
  } catch {
    /* ignore malformed URLs */
  }
}

export async function initCapacitor() {
  if (!Capacitor.isNativePlatform()) return;

  document.documentElement.classList.add("capacitor-native");
  document.body.classList.add("capacitor-native");

  try {
    await StatusBar.setStyle({ style: Style.Light });
    if (Capacitor.getPlatform() === "ios") {
      await StatusBar.setOverlaysWebView({ overlay: false });
    }
  } catch (e) {
    console.warn("In Hand: StatusBar init skipped", e);
  }

  try {
    await SplashScreen.hide();
  } catch (e) {
    console.warn("In Hand: SplashScreen hide skipped", e);
  }

  try {
    const setKeyboardHeight = (height) => {
      const px = `${Math.max(0, Math.round(height))}px`;
      document.documentElement.style.setProperty("--ih-keyboard-height", px);
    };

    const syncKeyboardFromViewport = () => {
      const vv = window.visualViewport;
      if (!vv) return;
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      if (inset > 60) {
        document.body.classList.add("keyboard-open");
        setKeyboardHeight(inset);
        window.dispatchEvent(new CustomEvent("inhand:keyboard-show"));
      } else if (inset < 24) {
        document.body.classList.remove("keyboard-open");
        setKeyboardHeight(0);
      }
    };

    Keyboard.setScroll({ isDisabled: true }).catch(() => {});

    Keyboard.addListener("keyboardWillShow", (info) => {
      document.body.classList.add("keyboard-open");
      setKeyboardHeight(info.keyboardHeight ?? 0);
      window.dispatchEvent(new CustomEvent("inhand:keyboard-show"));
      setTimeout(syncKeyboardFromViewport, 50);
    });
    Keyboard.addListener("keyboardDidShow", (info) => {
      document.body.classList.add("keyboard-open");
      setKeyboardHeight(info.keyboardHeight ?? 0);
      window.dispatchEvent(new CustomEvent("inhand:keyboard-show"));
    });
    Keyboard.addListener("keyboardWillHide", () => {
      document.body.classList.remove("keyboard-open");
      setKeyboardHeight(0);
    });
    Keyboard.addListener("keyboardDidHide", () => {
      document.body.classList.remove("keyboard-open");
      setKeyboardHeight(0);
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", syncKeyboardFromViewport);
      window.visualViewport.addEventListener("scroll", syncKeyboardFromViewport);
    }
  } catch (e) {
    console.warn("In Hand: Keyboard listeners skipped", e);
  }

  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) await handleIncomingUrl(launch.url);
    App.addListener("appUrlOpen", (event) => {
      handleIncomingUrl(event.url);
    });
  } catch (e) {
    console.warn("In Hand: App URL listeners skipped", e);
  }
}

export { Capacitor };

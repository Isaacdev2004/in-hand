import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";
import { Keyboard } from "@capacitor/keyboard";
import { supabase } from "../lib/supabaseClient";
import {
  handleSupabaseAuthDeepLink,
  isAuthCallbackUrl,
  isPasswordRecoveryUrl,
} from "../lib/authRedirect";
import { isListingUrl, parseListingIdFromUrl } from "../lib/shareLinks";

/** Deep-link handler: auth callback, listing share, or ?tab=browse|vault|wallet */
async function handleIncomingUrl(url) {
  if (!url || typeof window === "undefined") return;

  if (isAuthCallbackUrl(url) && supabase) {
    const recovery = isPasswordRecoveryUrl(url);
    const ok = await handleSupabaseAuthDeepLink(url, supabase);
    if (ok) {
      window.dispatchEvent(
        new CustomEvent("inhand:auth-complete", { detail: { recovery } })
      );
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

function forceLayoutRefresh() {
  try {
    window.dispatchEvent(new Event("resize"));
    document.documentElement.style.height = "100%";
    document.body.style.height = "100%";
    // Nudge WKWebView to paint after cold start / resume
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
    });
  } catch {
    /* ignore */
  }
}

async function hideSplashSafe() {
  try {
    await SplashScreen.hide({ fadeOutDuration: 200 });
  } catch (e) {
    console.warn("In Hand: SplashScreen hide skipped", e);
  }
}

export async function initCapacitor() {
  if (!Capacitor.isNativePlatform()) return;

  document.documentElement.classList.add("capacitor-native");
  document.body.classList.add("capacitor-native");

  try {
    // Edge-to-edge: draw under status bar; CSS safe-area insets pad content
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#f4f6f8" });
  } catch (e) {
    console.warn("In Hand: StatusBar init skipped", e);
  }

  // Hide splash ASAP so a stuck auth load isn't covered forever
  await hideSplashSafe();
  forceLayoutRefresh();
  // Second hide after first paint — iOS sometimes ignores the first call on cold start
  setTimeout(() => {
    hideSplashSafe();
    forceLayoutRefresh();
  }, 400);

  try {
    Keyboard.addListener("keyboardWillShow", (info) => {
      const h = Math.max(0, Number(info?.keyboardHeight) || 0);
      document.documentElement.classList.add("keyboard-open");
      document.body.classList.add("keyboard-open");
      document.documentElement.style.setProperty("--ih-keyboard-height", `${h}px`);
      window.dispatchEvent(new CustomEvent("inhand:keyboard-show", { detail: { height: h } }));
      // Keep focused field above the keyboard
      requestAnimationFrame(() => {
        const el = document.activeElement;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
          try {
            el.scrollIntoView({ block: "center", behavior: "smooth" });
          } catch {
            /* ignore */
          }
        }
      });
    });
    Keyboard.addListener("keyboardWillHide", () => {
      document.documentElement.classList.remove("keyboard-open");
      document.body.classList.remove("keyboard-open");
      document.documentElement.style.setProperty("--ih-keyboard-height", "0px");
    });
  } catch (e) {
    console.warn("In Hand: Keyboard listeners skipped", e);
  }

  // WebView / forms: scroll focused inputs into view whenever keyboard is up
  document.addEventListener(
    "focusin",
    (e) => {
      const t = e.target;
      if (!t || !(t instanceof HTMLElement)) return;
      if (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA" && !t.isContentEditable) return;
      setTimeout(() => {
        try {
          t.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch {
          /* ignore */
        }
      }, 120);
    },
    true
  );

  try {
    const launch = await App.getLaunchUrl();
    if (launch?.url) await handleIncomingUrl(launch.url);
    App.addListener("appUrlOpen", (event) => {
      handleIncomingUrl(event.url);
    });

    // Background → foreground: re-paint + let React re-check session
    App.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) return;
      forceLayoutRefresh();
      hideSplashSafe();
      window.dispatchEvent(new CustomEvent("inhand:app-resume"));
    });
  } catch (e) {
    console.warn("In Hand: App URL listeners skipped", e);
  }
}

export { Capacitor };

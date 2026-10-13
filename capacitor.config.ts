import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.inhand.collector",
  appName: "In Hand",
  webDir: "build",
  server: {
    androidScheme: "https",
    iosScheme: "https",
    // Keep Stripe 3DS / Elements hosts inside the WebView (not Safari)
    allowNavigation: [
      "stripe.com",
      "*.stripe.com",
      "js.stripe.com",
      "hooks.stripe.com",
      "checkout.stripe.com",
      "pay.stripe.com",
      "hooks.stripe.com",
      "m.stripe.com",
      "m.stripe.network",
      "api.stripe.com",
      "3ds.stripe.com",
      "verify.stripe.com",
      "stripecdn.com",
      "*.stripecdn.com",
    ],
  },
  ios: {
    // Let CSS env(safe-area-inset-*) own the insets — "automatic" letterboxes the WebView
    contentInset: "never",
    // Inner CSS handles vertical scroll; native pan was letting pages slide sideways
    scrollEnabled: false,
    backgroundColor: "#f4f6f8",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
      backgroundColor: "#f4f6f8",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#f4f6f8",
    },
    Keyboard: {
      resize: "native",
      resizeOnFullScreen: true,
    },
  },
};

export default config;

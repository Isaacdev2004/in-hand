import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.inhand.collector",
  appName: "In Hand",
  webDir: "build",
  server: {
    androidScheme: "https",
    iosScheme: "https",
  },
  ios: {
    // Let CSS env(safe-area-inset-*) own the insets — "automatic" letterboxes the WebView
    contentInset: "never",
    scrollEnabled: true,
    backgroundColor: "#f4f6f8",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1800,
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

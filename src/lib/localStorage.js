/**
 * Persistent key/value for web + Capacitor WebView.
 * Used for onboarding flag and optional local DB cache.
 */
export function getLocal(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setLocal(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Attach window.storage so existing call sites keep working. */
export function installWindowStorage() {
  if (typeof window === "undefined") return;
  if (window.storage?.get && window.storage?.set) return;
  window.storage = {
    get: async (key) => getLocal(key),
    set: async (key, value) => {
      setLocal(key, value);
    },
  };
}

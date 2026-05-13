import { createClient } from "@supabase/supabase-js";

const url = process.env.REACT_APP_SUPABASE_URL;
const anon = process.env.REACT_APP_SUPABASE_ANON_KEY;

/**
 * Shared Supabase browser client. Fails fast in dev if env is missing
 * (so you notice before shipping a broken build).
 */
export const supabase =
  url && anon
    ? createClient(url, anon, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // Default Web Locks cross-tab sync fights React Strict Mode + concurrent
          // sign-in + onAuthStateChange ("lock … stolen"). Single-tab SPA: run auth
          // work without a global lock (fine for one client instance).
          lock: async (_name, _acquireTimeout, fn) => await fn(),
        },
      })
    : null;

export function assertSupabase() {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY in .env"
    );
  }
  return supabase;
}

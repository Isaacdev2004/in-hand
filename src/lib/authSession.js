import { supabase } from "./supabaseClient";

function profileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    avatar: row.avatar,
    verified: !!row.verified,
    isAdmin: !!row.is_admin,
  };
}

/** Lightweight profile from Auth user when DB profile fetch is slow/unavailable. */
export function profileFromAuthUser(user) {
  if (!user?.id) return null;
  const username =
    user.user_metadata?.username ||
    user.email?.split("@")[0] ||
    "Collector";
  return {
    id: user.id,
    username,
    avatar: user.user_metadata?.avatar || username.slice(0, 2).toUpperCase(),
    verified: !!user.user_metadata?.verified,
  };
}

function withTimeout(promise, ms, label = "timeout") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label)), ms);
    }),
  ]);
}

export async function ensureUserProfile(user) {
  if (!supabase || !user?.id) return null;

  const { data: existing, error: readError } = await supabase
    .from("users")
    .select("id, username, avatar, verified, is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (readError) throw readError;
  if (existing) return profileFromRow(existing);

  const username =
    user.user_metadata?.username ||
    user.email?.split("@")[0] ||
    "Collector";

  const row = {
    id: user.id,
    username,
    avatar: user.user_metadata?.avatar || username.slice(0, 2).toUpperCase(),
    rating: 5,
    trades_completed: 0,
    joined: new Date().toISOString().split("T")[0],
    location: "",
    wishlist: [],
    wallet_balance: 0,
    payment_methods: [],
    addresses: [],
    flag_count: 0,
  };

  const { error: insertError } = await supabase.from("users").insert(row);
  if (insertError) throw insertError;

  return profileFromRow(row);
}

/**
 * Resolve session + profile with timeouts so iOS cold start never hangs
 * on "Loading your account…".
 */
export async function resolveAuthBootstrap(timeoutMs = 4500) {
  if (!supabase) return null;

  const {
    data: { session },
    error,
  } = await withTimeout(supabase.auth.getSession(), timeoutMs, "getSession timeout");

  if (error) throw error;
  if (!session?.user) return null;

  try {
    return await withTimeout(
      ensureUserProfile(session.user),
      timeoutMs,
      "ensureUserProfile timeout",
    );
  } catch (err) {
    console.warn("In Hand: profile fetch slow/failed, using auth fallback", err);
    return profileFromAuthUser(session.user);
  }
}

export async function loadSessionProfile() {
  if (!supabase) return null;

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();

  if (error) throw error;
  if (!session?.user) return null;

  return ensureUserProfile(session.user);
}

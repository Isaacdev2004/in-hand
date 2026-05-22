import { supabase } from "./supabaseClient";

/**
 * Patch the signed-in user's row in public.users (RLS: own row only).
 * Pass app-shaped camelCase fields; they are mapped to DB columns.
 */
export async function updateOwnUser(userId, patch) {
  if (!supabase) return { data: null, error: null, skipped: true };
  const row = {};
  if (patch.username !== undefined) row.username = patch.username;
  if (patch.avatar !== undefined) row.avatar = patch.avatar;
  if (patch.location !== undefined) row.location = patch.location;
  if (patch.wishlist !== undefined) row.wishlist = patch.wishlist;
  if (patch.addresses !== undefined) row.addresses = patch.addresses;
  if (patch.paymentMethods !== undefined) row.payment_methods = patch.paymentMethods;
  if (patch.walletBalance !== undefined) row.wallet_balance = patch.walletBalance;
  if (patch.rating !== undefined) row.rating = patch.rating;
  if (patch.tradesCompleted !== undefined) row.trades_completed = patch.tradesCompleted;
  if (patch.flagCount !== undefined) row.flag_count = patch.flagCount;
  if (Object.keys(row).length === 0) return { data: null, error: null };
  return supabase.from("users").update(row).eq("id", userId);
}

/** Update wallet and return the saved balance from Postgres. */
export async function updateWalletBalance(userId, walletBalance) {
  if (!supabase) return { data: null, error: null, skipped: true };
  return supabase
    .from("users")
    .update({ wallet_balance: walletBalance })
    .eq("id", userId)
    .select("wallet_balance")
    .maybeSingle();
}

/** Keep AppShell `db.users` in sync when the signed-in row was missing from the bulk load. */
export function patchUserWalletInList(users, userId, walletBalance, authProfile) {
  const list = users || [];
  const idx = list.findIndex((u) => u.id === userId);
  if (idx >= 0) {
    return list.map((u) =>
      u.id === userId ? { ...u, walletBalance } : u
    );
  }
  return [
    ...list,
    {
      id: userId,
      username: authProfile?.username || "You",
      avatar: authProfile?.avatar || "??",
      walletBalance,
      paymentMethods: [],
      addresses: [],
      wishlist: [],
      rating: 5,
      tradesCompleted: 0,
      joined: new Date().toISOString().split("T")[0],
      location: "",
      verified: !!authProfile?.verified,
      flagCount: 0,
    },
  ];
}

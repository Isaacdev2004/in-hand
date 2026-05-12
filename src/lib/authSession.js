import { supabase } from "./supabaseClient";

function profileFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    avatar: row.avatar,
  };
}

export async function ensureUserProfile(user) {
  if (!supabase || !user?.id) return null;

  const { data: existing, error: readError } = await supabase
    .from("users")
    .select("id, username, avatar")
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
    avatar: username.slice(0, 2).toUpperCase(),
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

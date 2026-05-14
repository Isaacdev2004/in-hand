/**
 * Maps Supabase rows (snake_case + table name "listings") into the legacy
 * in-memory `db` shape used by in-hand-v5.jsx — use when you wire AppShell
 * to Supabase (after running supabase/migrations and optional seed.sql).
 */

function msgTs(iso) {
  if (!iso) return "";
  const s = String(iso).replace("T", " ");
  return s.length >= 16 ? s.slice(0, 16) : s;
}

function userFromRow(r) {
  if (!r) return r;
  return {
    id: r.id,
    username: r.username,
    avatar: r.avatar,
    rating: r.rating != null ? Number(r.rating) : 5,
    tradesCompleted: r.trades_completed ?? 0,
    joined: r.joined,
    location: r.location,
    wishlist: r.wishlist || [],
    walletBalance: r.wallet_balance != null ? Number(r.wallet_balance) : 0,
    paymentMethods: r.payment_methods || [],
    addresses: r.addresses || [],
    flagCount: r.flag_count ?? 0,
    verified: !!r.verified,
  };
}

function listingFromRow(r) {
  if (!r) return r;
  return {
    id: r.id,
    ownerId: r.owner_id,
    name: r.name,
    brand: r.brand,
    line: r.line,
    isNew: r.is_new,
    value: r.value != null ? Number(r.value) : 0,
    image: r.image,
    photos: Array.isArray(r.photos) ? r.photos : r.photos || [],
    tags: r.tags || [],
    description: r.description,
    wantsTrade: r.wants_trade,
    wantsBuy: r.wants_buy,
    listedAt: r.listed_at,
    videoUrl: r.video_url || "",
  };
}

function txnFromRow(r) {
  if (!r) return r;
  return {
    id: r.id,
    type: r.type,
    buyerId: r.buyer_id,
    sellerId: r.seller_id,
    cardId: r.card_id,
    amount: r.amount != null ? Number(r.amount) : 0,
    fee: r.fee != null ? Number(r.fee) : 0,
    net: r.net != null ? Number(r.net) : 0,
    status: r.status,
    method: r.method,
    date: r.date,
    cardName: r.card_name,
    rated: r.rated,
  };
}

function shipmentFromRow(r) {
  if (!r) return r;
  return {
    id: r.id,
    txnId: r.txn_id,
    trackingNumber: r.tracking_number ?? "",
    carrier: r.carrier,
    status: r.status,
    estimatedDelivery: r.estimated_delivery,
    shippingCost: r.shipping_cost != null ? Number(r.shipping_cost) : 0,
    shippingLabel: r.shipping_label,
    fromUser: r.from_user,
    toUser: r.to_user,
    figureName: r.figure_name,
    figureValue: r.figure_value != null ? Number(r.figure_value) : 0,
    fundsReleased: r.funds_released,
    autoReleased: r.auto_released,
    deliveredAt: r.delivered_at,
    disputeFrozen: r.dispute_frozen,
    events: r.events || [],
  };
}

function disputeFromRow(r) {
  if (!r) return r;
  return {
    id: r.id,
    txnId: r.txn_id,
    raisedBy: r.raised_by,
    againstUserId: r.against_user_id,
    shipmentId: r.shipment_id,
    reason: r.reason,
    detail: r.detail,
    status: r.status,
    resolution: r.resolution,
    adminNote: r.admin_note,
    raisedAt: r.raised_at,
    resolvedAt: r.resolved_at,
    figureValue: r.figure_value,
    figureName: r.figure_name,
    disputeType: r.type || "purchase",
    againstUsername: r.against_user || "",
  };
}

function ratingFromRow(r) {
  if (!r) return r;
  return {
    id: r.id,
    txnId: r.txn_id,
    fromUserId: r.from_user_id,
    toUserId: r.to_user_id,
    score: r.score,
    comment: r.comment,
    type: r.type,
    date: r.date,
  };
}

function notifFromRow(r) {
  if (!r) return r;
  return {
    id: r.id,
    type: r.type,
    read: r.is_read,
    ts: r.created_at
      ? String(r.created_at).replace("T", " ").slice(0, 16)
      : "",
    title: r.title,
    body: r.body,
    cardId: r.card_id,
    link: r.link,
    userId: r.related_user_id,
  };
}

/**
 * Build legacy `messages` thread array from normalized conversation tables.
 */
export function mergeConversationsToThreads(conversations, participants, chatRows) {
  const partsByC = {};
  for (const p of participants) {
    if (!partsByC[p.conversation_id]) partsByC[p.conversation_id] = [];
    partsByC[p.conversation_id].push(p.user_id);
  }
  const msgsByC = {};
  for (const m of chatRows) {
    if (!msgsByC[m.conversation_id]) msgsByC[m.conversation_id] = [];
    msgsByC[m.conversation_id].push({
      id: m.id,
      from: m.from_user_id,
      text: m.body,
      ts: msgTs(m.created_at),
    });
  }
  return (conversations || []).map((c) => ({
    id: c.id,
    participants: partsByC[c.id] || [],
    cardId: c.card_id,
    cardName: c.card_name,
    cardImage: c.card_image,
    flagCount: c.flag_count ?? 0,
    flags: c.flags || [],
    messages: msgsByC[c.id] || [],
  }));
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} [forUserId] — when set, only load notifications for this user (matches "current user" in the app)
 */
export async function fetchAppDatabaseShape(client, forUserId) {
  const [
    { data: users, error: e1 },
    { data: listings, error: e2 },
    { data: transactions, error: e3 },
    { data: shipments, error: e4 },
    { data: disputes, error: e5 },
    { data: ratings, error: e6 },
    { data: conversations, error: e7 },
    { data: cParts, error: e8 },
    { data: chatMessages, error: e9 },
    { data: notifs, error: e10 },
  ] = await Promise.all([
    client.from("users").select("*"),
    client.from("listings").select("*"),
    client.from("transactions").select("*"),
    client.from("shipments").select("*"),
    client.from("disputes").select("*"),
    client.from("ratings").select("*"),
    client.from("conversations").select("*"),
    client.from("conversation_participants").select("*"),
    client.from("chat_messages").select("*").order("created_at", { ascending: true }),
    forUserId
      ? client.from("notifications").select("*").eq("recipient_id", forUserId)
      : client.from("notifications").select("*"),
  ]);
  const err = e1 || e2 || e3 || e4 || e5 || e6 || e7 || e8 || e9 || e10;
  if (err) throw err;

  const messages = mergeConversationsToThreads(
    conversations || [],
    cParts || [],
    chatMessages || []
  );

  return {
    users: (users || []).map(userFromRow),
    cards: (listings || []).map(listingFromRow),
    transactions: (transactions || []).map(txnFromRow),
    shipments: (shipments || []).map(shipmentFromRow),
    disputes: (disputes || []).map(disputeFromRow),
    ratings: (ratings || []).map(ratingFromRow),
    messages,
    notifications: (notifs || []).map(notifFromRow),
  };
}

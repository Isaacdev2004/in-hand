import { supabase } from "./supabaseClient";

function transactionToRow(txn) {
  return {
    id: txn.id,
    type: txn.type,
    buyer_id: txn.buyerId,
    seller_id: txn.sellerId,
    card_id: txn.cardId || null,
    amount: txn.amount ?? 0,
    fee: txn.fee ?? 0,
    net: txn.net ?? 0,
    status: txn.status,
    method: txn.method || null,
    date: txn.date || null,
    card_name: txn.cardName || null,
    rated: !!txn.rated,
  };
}

function shipmentToRow(s) {
  return {
    id: s.id,
    txn_id: s.txnId,
    tracking_number: s.trackingNumber || "",
    carrier: s.carrier || null,
    status: s.status,
    estimated_delivery: s.estimatedDelivery || null,
    shipping_cost: s.shippingCost ?? 0,
    shipping_label: s.shippingLabel || null,
    from_user: s.fromUser,
    to_user: s.toUser,
    figure_name: s.figureName || null,
    figure_value: s.figureValue ?? 0,
    funds_released: !!s.fundsReleased,
    auto_released: !!s.autoReleased,
    delivered_at: s.deliveredAt || null,
    dispute_frozen: !!s.disputeFrozen,
    events: s.events || [],
  };
}

function disputeToRow(d) {
  return {
    id: d.id,
    txn_id: d.txnId,
    raised_by: d.raisedBy,
    against_user_id: d.againstUserId,
    shipment_id: d.shipmentId || null,
    reason: d.reason,
    detail: d.detail || null,
    status: d.status,
    resolution: d.resolution || null,
    admin_note: d.adminNote || null,
    raised_at: d.raisedAt || null,
    resolved_at: d.resolvedAt || null,
    figure_value: d.figureValue ?? 0,
    figure_name: d.figureName || null,
    type: d.disputeType || "purchase",
    against_user: d.againstUsername ?? null,
  };
}

function ratingToRow(r) {
  return {
    id: r.id,
    txn_id: r.txnId,
    from_user_id: r.fromUserId,
    to_user_id: r.toUserId,
    score: r.score,
    comment: r.comment || null,
    type: r.type || null,
    date: r.date || null,
  };
}

export async function upsertTransaction(txn) {
  if (!supabase) return { data: null, error: null, skipped: true };
  return supabase
    .from("transactions")
    .upsert(transactionToRow(txn), { onConflict: "id" });
}

export async function updateTransaction(txnId, patch) {
  if (!supabase) return { data: null, error: null, skipped: true };
  const row = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.rated !== undefined) row.rated = !!patch.rated;
  if (patch.net !== undefined) row.net = patch.net;
  return supabase.from("transactions").update(row).eq("id", txnId);
}

export async function upsertShipment(shipment) {
  if (!supabase) return { data: null, error: null, skipped: true };
  return supabase
    .from("shipments")
    .upsert(shipmentToRow(shipment), { onConflict: "id" });
}

export async function updateShipmentById(shipmentId, patch) {
  if (!supabase) return { data: null, error: null, skipped: true };
  const row = {};
  if (patch.trackingNumber !== undefined) row.tracking_number = patch.trackingNumber;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.events !== undefined) row.events = patch.events;
  if (patch.fundsReleased !== undefined) row.funds_released = !!patch.fundsReleased;
  if (patch.autoReleased !== undefined) row.auto_released = !!patch.autoReleased;
  if (patch.deliveredAt !== undefined) row.delivered_at = patch.deliveredAt;
  if (patch.disputeFrozen !== undefined) row.dispute_frozen = !!patch.disputeFrozen;
  return supabase.from("shipments").update(row).eq("id", shipmentId);
}

export async function updateShipmentByTxnId(txnId, patch) {
  if (!supabase) return { data: null, error: null, skipped: true };
  const row = {};
  if (patch.trackingNumber !== undefined) row.tracking_number = patch.trackingNumber;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.events !== undefined) row.events = patch.events;
  return supabase.from("shipments").update(row).eq("txn_id", txnId);
}

export async function insertConversation(thread) {
  if (!supabase) return { data: null, error: null, skipped: true };
  const { error: cErr } = await supabase.from("conversations").insert({
    id: thread.id,
    card_id: thread.cardId || null,
    card_name: thread.cardName || null,
    card_image: thread.cardImage || null,
    flag_count: thread.flagCount || 0,
    flags: thread.flags || [],
  });
  if (cErr) return { data: null, error: cErr };
  const participants = (thread.participants || []).map((userId) => ({
    conversation_id: thread.id,
    user_id: userId,
  }));
  const { error: pErr } = await supabase
    .from("conversation_participants")
    .insert(participants);
  return { data: !pErr, error: pErr };
}

export async function insertChatMessage(threadId, msg) {
  if (!supabase) return { data: null, error: null, skipped: true };
  return supabase.from("chat_messages").insert({
    id: msg.id,
    conversation_id: threadId,
    from_user_id: msg.from,
    body: msg.text,
    created_at: new Date().toISOString(),
  });
}

export async function updateConversationFlags(threadId, flags, flagCount) {
  if (!supabase) return { data: null, error: null, skipped: true };
  return supabase
    .from("conversations")
    .update({ flags: flags || [], flag_count: flagCount || 0 })
    .eq("id", threadId);
}

export async function insertDispute(dispute) {
  if (!supabase) return { data: null, error: null, skipped: true };
  return supabase.from("disputes").insert(disputeToRow(dispute));
}

export async function insertRating(rating) {
  if (!supabase) return { data: null, error: null, skipped: true };
  return supabase.from("ratings").insert(ratingToRow(rating));
}

/** Escrow release: credits seller wallet + completes txn (SECURITY DEFINER RPC). */
export async function tryReleaseEscrow(shipmentId, autoAfterDelay) {
  if (!supabase) return { data: null, error: null, skipped: true };
  return supabase.rpc("try_release_escrow", {
    p_shipment_id: shipmentId,
    p_auto_after_delay: autoAfterDelay,
  });
}

export async function insertNotification(n) {
  if (!supabase) return { data: null, error: null, skipped: true };
  return supabase.from("notifications").insert({
    id: n.id,
    recipient_id: n.recipientId,
    type: n.type,
    is_read: !!n.read,
    title: n.title ?? null,
    body: n.body ?? null,
    card_id: n.cardId ?? null,
    link: n.link ?? null,
    related_user_id: n.relatedUserId ?? n.userId ?? null,
  });
}

export async function markNotificationRead(notificationId) {
  if (!supabase) return { data: null, error: null, skipped: true };
  return supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId);
}

export async function markAllNotificationsRead(recipientId) {
  if (!supabase) return { data: null, error: null, skipped: true };
  return supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("recipient_id", recipientId)
    .eq("is_read", false);
}

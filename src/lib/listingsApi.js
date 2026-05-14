import { supabase } from "./supabaseClient";

function toListingRow(card) {
  return {
    id: card.id,
    owner_id: card.ownerId,
    name: card.name,
    brand: card.brand,
    line: card.line,
    is_new: card.isNew,
    value: card.value,
    image: card.image,
    photos: card.photos || [],
    tags: card.tags || [],
    description: card.description || null,
    wants_trade: !!card.wantsTrade,
    wants_buy: !!card.wantsBuy,
    listed_at: card.listedAt || null,
    video_url: card.videoUrl || null,
  };
}

export async function createListing(card) {
  if (!supabase) return { data: null, error: null, skipped: true };
  return supabase.from("listings").insert(toListingRow(card));
}

export async function updateListing(cardId, patch) {
  if (!supabase) return { data: null, error: null, skipped: true };
  const row = {};
  if (patch.ownerId !== undefined) row.owner_id = patch.ownerId;
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.brand !== undefined) row.brand = patch.brand;
  if (patch.line !== undefined) row.line = patch.line;
  if (patch.isNew !== undefined) row.is_new = patch.isNew;
  if (patch.value !== undefined) row.value = patch.value;
  if (patch.image !== undefined) row.image = patch.image;
  if (patch.photos !== undefined) row.photos = patch.photos || [];
  if (patch.tags !== undefined) row.tags = patch.tags || [];
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.wantsTrade !== undefined) row.wants_trade = !!patch.wantsTrade;
  if (patch.wantsBuy !== undefined) row.wants_buy = !!patch.wantsBuy;
  if (patch.listedAt !== undefined) row.listed_at = patch.listedAt;
  if (patch.videoUrl !== undefined) row.video_url = patch.videoUrl || null;
  return supabase.from("listings").update(row).eq("id", cardId);
}

export async function deleteListing(cardId) {
  if (!supabase) return { data: null, error: null, skipped: true };
  return supabase.from("listings").delete().eq("id", cardId);
}

export async function transferListingOwnership(transfers) {
  if (!supabase) return { data: null, error: null, skipped: true };
  for (const t of transfers || []) {
    const { error } = await updateListing(t.id, {
      ownerId: t.ownerId,
      wantsTrade: t.wantsTrade,
      wantsBuy: t.wantsBuy,
    });
    if (error) return { data: null, error };
  }
  return { data: true, error: null };
}

/** Two-party figure swap (bypasses listing owner-only UPDATE RLS). */
export async function swapTradeListings(takeId, giveId) {
  if (!supabase) return { data: null, error: null, skipped: true };
  return supabase.rpc("swap_trade_listings", {
    p_take_id: takeId,
    p_give_id: giveId,
  });
}

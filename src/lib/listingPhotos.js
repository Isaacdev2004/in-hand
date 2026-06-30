import { supabase } from "./supabaseClient";

export function isDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:");
}

/** Upload a compressed image (data URL) to the listing-photos bucket; returns public URL. */
export async function uploadListingPhotoDataUrl(dataUrl, ownerId, listingId, index) {
  if (!supabase) return dataUrl;
  if (!isDataUrl(dataUrl)) return dataUrl;

  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const ext = (blob.type?.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const path = `${ownerId}/${listingId}/${index}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from("listing-photos").upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: true,
  });
  if (error) throw error;

  const { data } = supabase.storage.from("listing-photos").getPublicUrl(path);
  return data.publicUrl;
}

/** Replace base64 photos with storage URLs before saving a listing row. */
export async function resolveListingPhotosForSave(photos, ownerId, listingId) {
  const list = photos || [];
  const resolved = [];
  for (let i = 0; i < list.length; i++) {
    resolved.push(await uploadListingPhotoDataUrl(list[i], ownerId, listingId, i));
  }
  return resolved;
}

export function formatListingSaveError(error) {
  if (!error) return "Could not save figure.";
  const code = error.code;
  const msg = String(error.message || "");
  if (code === "23503" || /foreign key/i.test(msg)) {
    return "Your account profile is not set up yet. Sign out, sign in again, then retry.";
  }
  if (code === "42501" || /row-level security/i.test(msg)) {
    return "Not signed in properly. Sign out and sign in again, then retry.";
  }
  if (/video_url/i.test(msg)) {
    return "Database needs a small update (video_url). Run the latest Supabase migration.";
  }
  if (/payload too large|entity too large/i.test(msg)) {
    return "Photos are too large. Try fewer or smaller images.";
  }
  return msg.length <= 100 ? msg : "Could not save figure. Try again with fewer photos.";
}

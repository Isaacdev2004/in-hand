import { supabase } from "./supabaseClient";

export const DEFAULT_USPS_RATES = [
  { maxValue: 50, label: "Small Flat Rate Box", price: 9.45, insurance: 0 },
  { maxValue: 100, label: "Medium Flat Rate Box", price: 14.65, insurance: 0 },
  { maxValue: 500, label: "Large Flat Rate Box", price: 19.95, insurance: 2.75 },
  { maxValue: 99999, label: "Large Flat Rate Box", price: 19.95, insurance: 4.95 },
];

export const INSURANCE_THRESHOLD = 100;

let cachedRates = DEFAULT_USPS_RATES.map((r) => ({ ...r }));

export function getCachedShippingRates() {
  return cachedRates;
}

export function setCachedShippingRates(rates) {
  if (Array.isArray(rates) && rates.length) {
    cachedRates = normalizeRates(rates);
  }
  return cachedRates;
}

export function normalizeRates(rates) {
  return [...rates]
    .map((r, i) => ({
      maxValue: Number(r.maxValue ?? r.max_value) || 0,
      label: String(r.label || "USPS box").trim() || "USPS box",
      price: Number(r.price) || 0,
      insurance: Number(r.insurance) || 0,
      sortOrder: r.sortOrder ?? r.sort_order ?? i + 1,
    }))
    .sort((a, b) => a.maxValue - b.maxValue);
}

export function getShippingRate(value, rates = cachedRates) {
  const list = normalizeRates(rates);
  const v = Number(value) || 0;
  return list.find((r) => v <= r.maxValue) || list[list.length - 1];
}

export function getInsuranceCost(value, rates = cachedRates) {
  if (Number(value) <= INSURANCE_THRESHOLD) return 0;
  return getShippingRate(value, rates)?.insurance || 0;
}

export async function fetchShippingRates() {
  if (!supabase) return getCachedShippingRates();
  const { data, error } = await supabase
    .from("shipping_rates")
    .select("id, max_value, label, price, insurance, sort_order")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  if (!data?.length) return getCachedShippingRates();
  return setCachedShippingRates(data);
}

export async function saveShippingRates(rates) {
  if (!supabase) {
    setCachedShippingRates(rates);
    return { error: null };
  }
  const rows = normalizeRates(rates).map((r, i) => ({
    max_value: r.maxValue,
    label: r.label,
    price: r.price,
    insurance: r.insurance,
    sort_order: i + 1,
    updated_at: new Date().toISOString(),
  }));
  const { error: delErr } = await supabase
    .from("shipping_rates")
    .delete()
    .gte("id", 0);
  if (delErr) return { error: delErr };
  const { error } = await supabase.from("shipping_rates").insert(rows);
  if (!error) setCachedShippingRates(rates);
  return { error };
}

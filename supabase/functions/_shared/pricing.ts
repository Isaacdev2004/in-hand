/** Checkout totals. Rates load from public.shipping_rates when available. */

export const PLATFORM_FEE = 0.05;
export const INSURANCE_THRESHOLD = 100;

export const DEFAULT_USPS_RATES = [
  { maxValue: 50, label: "Small Flat Rate Box", price: 9.45, insurance: 0 },
  { maxValue: 100, label: "Medium Flat Rate Box", price: 14.65, insurance: 0 },
  { maxValue: 500, label: "Large Flat Rate Box", price: 19.95, insurance: 2.75 },
  { maxValue: 99999, label: "Large Flat Rate Box", price: 19.95, insurance: 4.95 },
];

export type ShippingRate = {
  maxValue: number;
  label: string;
  price: number;
  insurance: number;
};

export function normalizeRates(rows: unknown): ShippingRate[] {
  const list = Array.isArray(rows) ? rows : [];
  const mapped = list.map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      maxValue: Number(r.maxValue ?? r.max_value) || 0,
      label: String(r.label || "USPS box"),
      price: Number(r.price) || 0,
      insurance: Number(r.insurance) || 0,
    };
  }).sort((a, b) => a.maxValue - b.maxValue);
  return mapped.length ? mapped : DEFAULT_USPS_RATES;
}

export function getShippingRate(value: number, rates: ShippingRate[] = DEFAULT_USPS_RATES) {
  const list = normalizeRates(rates);
  return list.find((r) => value <= r.maxValue) ?? list[list.length - 1];
}

export function getInsuranceCost(value: number, rates: ShippingRate[] = DEFAULT_USPS_RATES) {
  if (value <= INSURANCE_THRESHOLD) return 0;
  return getShippingRate(value, rates).insurance ?? 0;
}

export async function loadShippingRatesFromDb(
  // deno-lint-ignore no-explicit-any
  client: { from: (t: string) => any },
): Promise<ShippingRate[]> {
  try {
    const { data, error } = await client
      .from("shipping_rates")
      .select("max_value, label, price, insurance, sort_order")
      .order("sort_order", { ascending: true });
    if (error || !data?.length) return DEFAULT_USPS_RATES;
    return normalizeRates(data);
  } catch {
    return DEFAULT_USPS_RATES;
  }
}

export function computePurchaseTotals(
  listingValue: number,
  rates: ShippingRate[] = DEFAULT_USPS_RATES,
) {
  const fee = Number((listingValue * PLATFORM_FEE).toFixed(2));
  const itemPlusFee = Number((listingValue + fee).toFixed(2));
  const rate = getShippingRate(listingValue, rates);
  const shipping = rate.price;
  const insurance = getInsuranceCost(listingValue, rates);
  const grandTotal = Number((itemPlusFee + shipping + insurance).toFixed(2));
  const net = Number((listingValue - fee).toFixed(2));
  return {
    fee,
    shipping,
    insurance,
    shippingLabel: rate.label,
    grandTotal,
    net,
  };
}

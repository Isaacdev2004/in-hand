/** Mirrors src/in-hand-v5.jsx fee + USPS helpers for server-side checkout totals. */
export const PLATFORM_FEE = 0.05;

const USPS_RATES = [
  { maxValue: 50, label: "Small Flat Rate Box", price: 9.45, insurance: 0 },
  { maxValue: 100, label: "Medium Flat Rate Box", price: 14.65, insurance: 0 },
  { maxValue: 500, label: "Large Flat Rate Box", price: 19.95, insurance: 2.75 },
  { maxValue: 99999, label: "Large Flat Rate Box", price: 19.95, insurance: 4.95 },
];

const INSURANCE_THRESHOLD = 100;

export function getShippingRate(value: number) {
  return USPS_RATES.find((r) => value <= r.maxValue) ?? USPS_RATES[USPS_RATES.length - 1];
}

export function getInsuranceCost(value: number) {
  if (value <= INSURANCE_THRESHOLD) return 0;
  return getShippingRate(value).insurance ?? 0;
}

export function computePurchaseTotals(listingValue: number) {
  const fee = Number((listingValue * PLATFORM_FEE).toFixed(2));
  const itemPlusFee = Number((listingValue + fee).toFixed(2));
  const rate = getShippingRate(listingValue);
  const shipping = rate.price;
  const insurance = getInsuranceCost(listingValue);
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

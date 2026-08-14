import { getShippingRate, type ShippingRate } from "./pricing.ts";

export type ShippoAddress = {
  name: string;
  street1: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
};

export function parcelForFigureValue(value: number, rates?: ShippingRate[]) {
  const rate = getShippingRate(value, rates);
  if (rate.label.includes("Small")) {
    return {
      length: "8.6875",
      width: "5.4375",
      height: "1.75",
      weight: "1",
      distance_unit: "in",
      mass_unit: "lb",
    };
  }
  if (rate.label.includes("Medium")) {
    return {
      length: "11.25",
      width: "8.75",
      height: "6",
      weight: "2",
      distance_unit: "in",
      mass_unit: "lb",
    };
  }
  return {
    length: "12",
    width: "12",
    height: "5.5",
    weight: "3",
    distance_unit: "in",
    mass_unit: "lb",
  };
}

export function pickDefaultAddress(
  addresses: Array<{
    name?: string;
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    isDefault?: boolean;
  }> | null | undefined,
): ShippoAddress | null {
  if (!addresses?.length) return null;
  const addr = addresses.find((a) => a.isDefault) ?? addresses[0];
  if (!addr?.street || !addr?.city || !addr?.state || !addr?.zip) return null;
  return {
    name: addr.name || "Recipient",
    street1: addr.street,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
    country: "US",
  };
}

export async function shippoRequest<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`https://api.goshippo.com${path}`, {
    ...init,
    headers: {
      Authorization: `ShippoToken ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      (body as { detail?: string }).detail ||
      (body as { message?: string }).message ||
      JSON.stringify(body);
    throw new Error(`Shippo ${res.status}: ${detail}`);
  }
  return body as T;
}

export function pickUspsGroundRate(
  rates: Array<{
    object_id: string;
    provider: string;
    servicelevel?: { name?: string; token?: string };
    amount: string;
  }>,
) {
  const usps = rates.filter((r) => r.provider === "USPS");
  const ground = usps.find((r) => {
    const n = (r.servicelevel?.name || "").toLowerCase();
    const t = (r.servicelevel?.token || "").toLowerCase();
    return n.includes("ground") || t.includes("ground");
  });
  return ground ?? usps[0] ?? rates[0];
}

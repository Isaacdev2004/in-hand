import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { loadShippingRatesFromDb } from "../_shared/pricing.ts";
import {
  parcelForFigureValue,
  pickDefaultAddress,
  pickUspsGroundRate,
  shippoRequest,
  storedAddressFromRecord,
  type ShippoAddress,
} from "../_shared/shippo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const shippoToken = Deno.env.get("SHIPPO_API_TOKEN");
    if (!shippoToken) {
      return json({ error: "SHIPPO_API_TOKEN not configured on Supabase" }, 500);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!bearer || bearer === anonKey) {
      return json({ error: "Sign in required." }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user?.id) {
      return json({ error: "Invalid or expired session" }, 401);
    }

    const { shipmentId, fromAddress } = await req.json();
    if (!shipmentId || !fromAddress?.street || !fromAddress?.city || !fromAddress?.state || !fromAddress?.zip) {
      return json({ error: "shipmentId and complete fromAddress required" }, 400);
    }

    const { data: shipment, error: shipErr } = await supabase
      .from("shipments")
      .select("id, txn_id, from_user, to_user, figure_value, figure_name, tracking_number, status, ship_to")
      .eq("id", shipmentId)
      .maybeSingle();

    if (shipErr || !shipment) {
      return json({ error: "Shipment not found" }, 404);
    }

    if (shipment.from_user !== user.id) {
      return json({ error: "Only the seller can generate this label" }, 403);
    }

    if (shipment.tracking_number) {
      return json({ error: "Label already generated for this shipment" }, 409);
    }

    const { data: buyer, error: buyerErr } = await supabase
      .from("users")
      .select("id, username, addresses")
      .eq("id", shipment.to_user)
      .maybeSingle();

    if (buyerErr || !buyer) {
      return json({ error: "Buyer profile not found" }, 404);
    }

    const toAddr =
      storedAddressFromRecord(shipment.ship_to) ||
      pickDefaultAddress(buyer.addresses);
    if (!toAddr) {
      return json({
        error:
          "No buyer shipping address on this order. The buyer must complete Stripe Checkout with a US address.",
      }, 400);
    }

    const from: ShippoAddress = {
      name: fromAddress.name || "Seller",
      street1: fromAddress.street,
      city: fromAddress.city,
      state: fromAddress.state,
      zip: fromAddress.zip,
      country: "US",
    };

    const figureValue = Number(shipment.figure_value) || 50;
    const rates = await loadShippingRatesFromDb(supabase);
    const parcel = parcelForFigureValue(figureValue, rates);

    type ShipmentRes = {
      rates: Array<{
        object_id: string;
        provider: string;
        servicelevel?: { name?: string; token?: string };
        amount: string;
      }>;
    };

    const shippoShipment = await shippoRequest<ShipmentRes>(shippoToken, "/shipments/", {
      method: "POST",
      body: JSON.stringify({
        address_from: from,
        address_to: toAddr,
        parcels: [parcel],
        async: false,
      }),
    });

    const rate = pickUspsGroundRate(shippoShipment.rates || []);
    if (!rate?.object_id) {
      return json({ error: "No USPS rates returned from Shippo" }, 502);
    }

    type TransactionRes = {
      status: string;
      tracking_number?: string;
      label_url?: string;
      messages?: Array<{ text?: string }>;
    };

    const txn = await shippoRequest<TransactionRes>(shippoToken, "/transactions/", {
      method: "POST",
      body: JSON.stringify({
        rate: rate.object_id,
        label_file_type: "PDF",
        async: false,
      }),
    });

    if (txn.status !== "SUCCESS" || !txn.tracking_number) {
      const msg = txn.messages?.map((m) => m.text).filter(Boolean).join("; ") ||
        "Label purchase failed";
      return json({ error: msg }, 502);
    }

    const events = [{
      date: new Date().toISOString().slice(0, 16).replace("T", " "),
      location: "Origin",
      description: "Shipping label created via Shippo",
    }];

    const { error: updErr } = await supabase
      .from("shipments")
      .update({
        tracking_number: txn.tracking_number,
        shipping_label: txn.label_url || "",
        carrier: rate.servicelevel?.name || "USPS",
        status: "accepted",
        events,
        ship_from: {
          name: from.name,
          street: from.street1,
          city: from.city,
          state: from.state,
          zip: from.zip,
          country: "US",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", shipmentId);

    if (updErr) {
      return json({ error: "Label created but failed to save shipment", detail: updErr.message }, 500);
    }

    const now = Date.now();
    const tracking = txn.tracking_number;
    const item = shipment.figure_name || "your figure";
    await supabase.from("notifications").insert([
      {
        id: `n_label_b_${shipmentId}_${now}`,
        recipient_id: shipment.to_user,
        type: "shipping",
        is_read: false,
        title: "Your figure is on the way",
        body: `${item} has a USPS label. Tracking ${tracking}.`,
        link: "shipping",
        related_user_id: shipment.from_user,
      },
      {
        id: `n_label_s_${shipmentId}_${now}`,
        recipient_id: shipment.from_user,
        type: "shipping",
        is_read: false,
        title: "Shipping label created",
        body: `USPS tracking for ${item}: ${tracking}.`,
        link: "shipping",
        related_user_id: shipment.to_user,
      },
    ]);

    return json({
      trackingNumber: txn.tracking_number,
      labelUrl: txn.label_url || null,
      carrier: rate.servicelevel?.name || "USPS",
      labelCost: rate.amount,
      shipTo: {
        name: toAddr.name,
        street: toAddr.street1,
        city: toAddr.city,
        state: toAddr.state,
        zip: toAddr.zip,
      },
    });
  } catch (e) {
    console.error("create-shipping-label", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

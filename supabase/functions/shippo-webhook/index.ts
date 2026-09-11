import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, shippo-signature",
};

/** Map Shippo tracking status → In Hand shipment status */
function mapShippoStatus(status?: string) {
  const s = (status || "").toUpperCase();
  if (s === "DELIVERED") return "delivered";
  if (s === "TRANSIT" || s === "IN_TRANSIT") return "in_transit";
  if (s === "OUT_FOR_DELIVERY") return "out_for_delivery";
  if (s === "FAILURE" || s === "RETURNED") return "in_transit";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const event = payload?.event || payload?.data || payload;
    const trackingStatus = event?.tracking_status || event?.trackingStatus || {};
    const trackingNumber =
      event?.tracking_number ||
      trackingStatus?.tracking_number ||
      payload?.data?.tracking_number;
    const statusRaw =
      trackingStatus?.status ||
      event?.status ||
      payload?.data?.tracking_status?.status;
    const mapped = mapShippoStatus(statusRaw);

    if (!trackingNumber || !mapped) {
      return json({ received: true, skipped: true });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: shipment, error } = await supabase
      .from("shipments")
      .select("id, from_user, to_user, figure_name, status, delivered_at, events, tracking_number")
      .eq("tracking_number", trackingNumber)
      .maybeSingle();

    if (error || !shipment) {
      return json({ received: true, notFound: true });
    }

    if (shipment.status === "delivered" && mapped === "delivered") {
      return json({ received: true, already: true });
    }

    const now = new Date().toISOString();
    const events = Array.isArray(shipment.events) ? [...shipment.events] : [];
    events.push({
      date: now.slice(0, 16).replace("T", " "),
      location: trackingStatus?.status_details || trackingStatus?.location || "USPS",
      description: trackingStatus?.status_details || `Status: ${statusRaw}`,
    });

    const patch: Record<string, unknown> = {
      status: mapped,
      events,
      updated_at: now,
    };
    if (mapped === "delivered") {
      patch.delivered_at = shipment.delivered_at || now;
    }

    await supabase.from("shipments").update(patch).eq("id", shipment.id);

    if (mapped === "delivered") {
      const item = shipment.figure_name || "your figure";
      const ts = Date.now();
      await supabase.from("notifications").insert([
        {
          id: `n_del_b_${shipment.id}_${ts}`,
          recipient_id: shipment.to_user,
          type: "delivered",
          is_read: false,
          title: "📬 Delivered — 7 day window open",
          body: `${item} was delivered. You have 7 days to report a problem, then rate your trade partner.`,
          link: "shipping",
          related_user_id: shipment.from_user,
        },
        {
          id: `n_del_s_${shipment.id}_${ts}`,
          recipient_id: shipment.from_user,
          type: "delivered",
          is_read: false,
          title: "📬 Delivered — 7 day window open",
          body: `${item} was delivered. Escrow releases in 7 days if no dispute. Rate your partner after.`,
          link: "shipping",
          related_user_id: shipment.to_user,
        },
      ]);
    }

    return json({ received: true, status: mapped });
  } catch (e) {
    console.error("shippo-webhook", e);
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

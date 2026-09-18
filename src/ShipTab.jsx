import { useState } from "react";
import { createShippingLabel } from "./lib/shippoLabel";
import { getShippingRate } from "./lib/shippingRates";
import { supabase } from "./lib/supabaseClient";

function normalizeAddr(raw, nameFallback = "") {
  if (!raw) return null;
  const street = String(raw.street || raw.street1 || "").trim();
  const city = String(raw.city || "").trim();
  const state = String(raw.state || "").trim();
  const zip = String(raw.zip || raw.postal_code || "").trim();
  if (!street || !city || !state || !zip) return null;
  return {
    name: String(raw.name || nameFallback || "").trim() || nameFallback || "Recipient",
    street,
    city,
    state,
    zip,
    country: raw.country || "US",
  };
}

function pickUserAddress(user) {
  if (!user) return null;
  const a = user.addresses?.find((x) => x.isDefault) || user.addresses?.[0];
  return normalizeAddr(a, user.username);
}

function isHttpImageUrl(value) {
  if (!value || typeof value !== "string") return false;
  const v = value.trim();
  return /^https?:\/\//i.test(v) || v.startsWith("data:image") || /supabase\.co\/storage/i.test(v);
}

function ShipThumb({ card, size = 44 }) {
  const src = card?.photos?.[0] || (isHttpImageUrl(card?.image) ? card.image : null);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        style={{ width: size, height: size, borderRadius: 12, objectFit: "cover", flexShrink: 0, background: "rgba(255,255,255,0.15)" }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        background: "rgba(255,255,255,0.15)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 22,
        flexShrink: 0,
      }}
    >
      {card?.image && !isHttpImageUrl(card.image) ? card.image : "📦"}
    </div>
  );
}

/**
 * Simplified Ship tab — one card per outbound shipment, two actions:
 * Generate Label + Forward Label via Email.
 */
export default function ShipTab({
  shipments,
  transactions,
  cards,
  activeUserId,
  getUser,
  fmt,
  onLabelCreated,
  onMarkShipped,
  onTrack,
  onOpenMessages,
  onNotify,
  onOpenAddresses,
}) {
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const outbound = (shipments || [])
    .filter((s) => s.fromUser === activeUserId)
    .sort((a, b) => {
      const aNeed = !a.trackingNumber ? 0 : 1;
      const bNeed = !b.trackingNumber ? 0 : 1;
      return aNeed - bNeed;
    });

  const inbound = (shipments || []).filter((s) => s.toUser === activeUserId && s.fromUser !== activeUserId);

  const resolveParty = (s) => {
    const txn = (transactions || []).find((t) => t.id === s.txnId);
    const isTrade = txn?.type === "trade";
    const buyer = getUser(s.toUser);
    const seller = getUser(s.fromUser);
    const shipTo = normalizeAddr(s.shipTo, buyer?.username) || pickUserAddress(buyer);
    const shipFrom = normalizeAddr(s.shipFrom, seller?.username) || pickUserAddress(seller);
    const rate = getShippingRate(s.figureValue);
    const card = (cards || []).find((c) => c.name === s.figureName) || null;
    const other = getUser(s.toUser);
    return { txn, isTrade, buyer, seller, shipTo, shipFrom, rate, card, other };
  };

  const handleGenerate = async (s) => {
    const { shipTo, shipFrom } = resolveParty(s);
    if (!shipFrom) {
      onNotify?.("❌ Add your return address first (Account → Shipping Addresses)");
      onOpenAddresses?.();
      return;
    }
    if (!shipTo) {
      onNotify?.("❌ Recipient address missing — ask them to save one, or open Messages");
      return;
    }
    if (!supabase) {
      onNotify?.("❌ Shipping labels require Supabase / Shippo");
      return;
    }
    setBusyId(s.id);
    try {
      const result = await createShippingLabel({
        shipmentId: s.id,
        fromAddress: shipFrom,
        toAddress: shipTo,
      });
      await onLabelCreated?.(s, result.trackingNumber, {
        labelUrl: result.labelUrl,
        carrier: result.carrier || "USPS",
      });
      onNotify?.("✅ Label ready — use Forward Label to email the PDF");
    } catch (err) {
      console.error("In Hand: quick label failed", err);
      onNotify?.(`❌ ${err?.message || "Could not generate label"}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleForward = async (s) => {
    const labelUrl = s.shippingLabel;
    const tn = s.trackingNumber;
    if (!tn && !labelUrl) {
      onNotify?.("Generate the label first, then forward it");
      return;
    }
    const subject = `In Hand USPS label — ${s.figureName}`;
    const body = [
      `Shipping label for ${s.figureName}`,
      tn ? `Tracking: ${tn}` : "",
      labelUrl ? `PDF label: ${labelUrl}` : "Open In Hand → Ship to download the label.",
      "",
      "Sent via In Hand",
    ]
      .filter(Boolean)
      .join("\n");

    if (labelUrl && typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: subject, text: body, url: labelUrl });
        return;
      } catch {
        /* fall through */
      }
    }
    window.open(
      `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
      "_blank"
    );
  };

  const renderOutboundCard = (s) => {
    const { txn, isTrade, shipTo, shipFrom, rate, card, other } = resolveParty(s);
    const needsLabel = !s.trackingNumber;
    const canMarkShipped = !!s.trackingNumber && (s.status === "accepted" || s.status === "label_created");
    const expanded = expandedId === s.id;
    const busy = busyId === s.id;
    const ready = !!(shipTo && shipFrom);
    const subline = isTrade
      ? `Trade with ${other?.username || "collector"} · $${fmt(s.figureValue)}`
      : `Sale to ${other?.username || "buyer"} · $${fmt(s.figureValue)}`;

    return (
      <div
        key={s.id}
        style={{
          background: "#fff",
          borderRadius: 22,
          overflow: "hidden",
          marginBottom: 16,
          boxShadow: "0 4px 18px rgba(0,0,0,0.07)",
          border: "1px solid #E4EBF2",
        }}
      >
        <div
          style={{
            background: "linear-gradient(135deg,#2C3E50,#3A5A7A)",
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <ShipThumb card={card} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {s.figureName}
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 3 }}>{subline}</div>
          </div>
          <span
            style={{
              flexShrink: 0,
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 0.6,
              borderRadius: 20,
              padding: "5px 10px",
              background: isTrade ? "#f9ca24" : "rgba(0,0,0,0.35)",
              color: isTrade ? "#2C3E50" : "#fff",
            }}
          >
            {isTrade ? "🤝 TRADE" : "💰 SALE"}
          </span>
        </div>

        <div style={{ padding: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#aaa", letterSpacing: 1, marginBottom: 6 }}>SHIP TO</div>
              {shipTo ? (
                <>
                  <div style={{ fontWeight: 800, fontSize: 14, color: "#2C3E50" }}>{shipTo.name}</div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                    {expanded
                      ? `${shipTo.street}, ${shipTo.city}, ${shipTo.state} ${shipTo.zip}`
                      : `${shipTo.city}, ${shipTo.state} ${shipTo.zip}`}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: "#f0932b", fontWeight: 600 }}>
                  Address not on file — ask the recipient to save one in Account
                </div>
              )}
            </div>
            {shipTo && (
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : s.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#3A7BD5",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: "0 0 0 8px",
                  whiteSpace: "nowrap",
                }}
              >
                {expanded ? "Hide ↑" : "Full address ↓"}
              </button>
            )}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "#f7f9fc",
              borderRadius: 14,
              padding: "12px 14px",
              marginBottom: 14,
            }}
          >
            <span style={{ fontSize: 22 }}>📮</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13, color: "#2C3E50" }}>USPS Ground Advantage</div>
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{rate?.label || "Flat Rate Box"}</div>
            </div>
            <div style={{ fontWeight: 900, fontSize: 16, color: "#00b894" }}>${Number(rate?.price || s.shippingCost || 0).toFixed(2)}</div>
          </div>

          {s.trackingNumber ? (
            <div
              style={{
                background: "#f0fff8",
                borderRadius: 12,
                padding: "10px 12px",
                marginBottom: 12,
                fontFamily: "monospace",
                fontSize: 11,
                color: "#2C3E50",
                fontWeight: 600,
              }}
            >
              Tracking: {s.trackingNumber}
            </div>
          ) : null}

          {!shipFrom && (
            <div style={{ fontSize: 11, color: "#ff6b6b", fontWeight: 600, marginBottom: 10 }}>
              Your return address is missing — add it under Account → Shipping Addresses.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {needsLabel && (
              <button
                type="button"
                disabled={busy}
                onClick={() => handleGenerate(s)}
                style={{
                  width: "100%",
                  background: ready ? "linear-gradient(135deg,#2C3E50,#1a252f)" : "#9aa5b1",
                  border: "none",
                  borderRadius: 14,
                  padding: "14px 16px",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: busy ? "wait" : "pointer",
                  opacity: busy ? 0.75 : 1,
                }}
              >
                {busy ? "Generating label…" : "🏷️  Generate Shipping Label"}
              </button>
            )}
            <button
              type="button"
              onClick={() => handleForward(s)}
              style={{
                width: "100%",
                background: "#EAF1FA",
                border: "none",
                borderRadius: 14,
                padding: "14px 16px",
                color: "#2C3E50",
                fontWeight: 800,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              ✉️  Forward Label via Email
            </button>
            {canMarkShipped && (
              <button
                type="button"
                onClick={() => onMarkShipped?.(s)}
                style={{
                  width: "100%",
                  background: "#3A7BD5",
                  border: "none",
                  borderRadius: 14,
                  padding: "12px 16px",
                  color: "#fff",
                  fontWeight: 800,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Mark as Shipped
              </button>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => onTrack?.(s)}
                style={{
                  flex: 1,
                  background: "#EEF2F7",
                  border: "none",
                  borderRadius: 12,
                  padding: "10px",
                  fontWeight: 700,
                  fontSize: 12,
                  color: "#555",
                  cursor: "pointer",
                }}
              >
                Track
              </button>
              {other && (
                <button
                  type="button"
                  onClick={() => onOpenMessages?.(other.id, card || { name: s.figureName, image: "📦" })}
                  style={{
                    flex: 1,
                    background: "#EEF2F7",
                    border: "none",
                    borderRadius: 12,
                    padding: "10px",
                    fontWeight: 700,
                    fontSize: 12,
                    color: "#3A7BD5",
                    cursor: "pointer",
                  }}
                >
                  Message
                </button>
              )}
            </div>
          </div>

          <div style={{ marginTop: 12, textAlign: "center", fontSize: 10, color: "#bbb", lineHeight: 1.4 }}>
            Label pre-filled with buyer and seller addresses from your transaction.
            {txn ? ` · ${txn.type}` : ""}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 90px" }}>
      <div style={{ fontWeight: 800, fontSize: 18, color: "#2C3E50", marginBottom: 4 }}>Ship</div>
      <div style={{ fontSize: 12, color: "#888", marginBottom: 16, lineHeight: 1.45 }}>
        All shipments via USPS Ground Advantage. Labels are purchased for you — no rate picking.
      </div>

      {outbound.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 16px", background: "#fff", borderRadius: 22, border: "1px dashed #DCE6F0" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: "#2C3E50", marginBottom: 6 }}>No labels to process</div>
          <div style={{ fontSize: 12, color: "#aaa", lineHeight: 1.5 }}>
            When a sale or trade is confirmed, a shipment card appears here automatically.
          </div>
        </div>
      ) : (
        outbound.map(renderOutboundCard)
      )}

      {inbound.length > 0 && (
        <>
          <div style={{ fontWeight: 700, fontSize: 12, color: "#bbb", letterSpacing: 1, margin: "24px 0 12px" }}>INCOMING TO YOU</div>
          {inbound.map((s) => {
            const other = getUser(s.fromUser);
            return (
              <div
                key={s.id}
                style={{
                  background: "#fff",
                  borderRadius: 16,
                  padding: "14px 16px",
                  marginBottom: 10,
                  border: "1px solid #E4EBF2",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: "#2C3E50" }}>{s.figureName}</div>
                  <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>From {other?.username || "seller"}</div>
                  {s.trackingNumber && (
                    <div style={{ fontSize: 10, fontFamily: "monospace", color: "#555", marginTop: 4 }}>{s.trackingNumber}</div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onTrack?.(s)}
                  style={{
                    background: "#EEF2F7",
                    border: "none",
                    borderRadius: 10,
                    padding: "8px 12px",
                    fontWeight: 700,
                    fontSize: 11,
                    color: "#555",
                    cursor: "pointer",
                  }}
                >
                  Track
                </button>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

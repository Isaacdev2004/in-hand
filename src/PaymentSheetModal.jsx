import { useEffect, useRef, useState } from "react";
import { createPaymentIntent, getStripe } from "./lib/stripePaymentSheet";

/**
 * In-app Stripe Payment Sheet (Payment Element).
 * Supports cards + Apple Pay / Google Pay when Stripe + device allow.
 * Card numbers never touch our backend.
 */
export default function PaymentSheetModal({
  title = "Pay securely",
  subtitle = "Card details are handled by Stripe — never stored in In Hand.",
  amountCents,
  amountLabel,
  purpose = "purchase",
  listingId,
  metadata = {},
  requireShipping = false,
  defaultShipping,
  onSuccess,
  onClose,
}) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ship, setShip] = useState({
    name: defaultShipping?.name || "",
    street: defaultShipping?.street || "",
    city: defaultShipping?.city || "",
    state: defaultShipping?.state || "",
    zip: defaultShipping?.zip || "",
  });
  const mountRef = useRef(null);
  const elementsRef = useRef(null);
  const stripeRef = useRef(null);
  const peRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const shippingPayload =
          requireShipping && ship.street && ship.city && ship.state && ship.zip
            ? {
                name: ship.name || "Buyer",
                address: {
                  line1: ship.street,
                  city: ship.city,
                  state: ship.state,
                  postal_code: ship.zip,
                  country: "US",
                },
              }
            : undefined;

        // For purchase we create intent after address is ready (re-run when ship changes via Pay click)
        // Initial mount: create without shipping if not required; if required wait until user taps Pay
        if (requireShipping) {
          setLoading(false);
          return;
        }

        const { clientSecret } = await createPaymentIntent({
          amountCents,
          purpose,
          metadata: { ...metadata, listingId },
          listingId,
        });
        if (cancelled) return;
        const stripe = await getStripe();
        if (!stripe) throw new Error("Stripe failed to load");
        stripeRef.current = stripe;
        const elements = stripe.elements({
          clientSecret,
          appearance: { theme: "stripe", variables: { borderRadius: "12px" } },
        });
        elementsRef.current = elements;
        const pe = elements.create("payment", {
          layout: "tabs",
          wallets: { applePay: "auto", googlePay: "auto" },
        });
        peRef.current = pe;
        if (mountRef.current) {
          pe.mount(mountRef.current);
        }
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || "Could not start payment");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      try {
        peRef.current?.unmount?.();
      } catch (_) {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountCents, purpose, listingId, requireShipping]);

  const ensureElements = async () => {
    if (elementsRef.current && stripeRef.current) return;
    if (requireShipping) {
      if (!ship.name || !ship.street || !ship.city || !ship.state || !ship.zip) {
        throw new Error("Enter a complete US shipping address");
      }
    }
    const shippingPayload =
      requireShipping
        ? {
            name: ship.name,
            address: {
              line1: ship.street,
              city: ship.city,
              state: ship.state,
              postal_code: ship.zip,
              country: "US",
            },
          }
        : undefined;

    const { clientSecret } = await createPaymentIntent({
      amountCents,
      purpose,
      metadata: { ...metadata, listing_id: listingId },
      listingId,
      shipping: shippingPayload,
    });
    const stripe = await getStripe();
    if (!stripe) throw new Error("Stripe failed to load");
    stripeRef.current = stripe;
    const elements = stripe.elements({
      clientSecret,
      appearance: { theme: "stripe", variables: { borderRadius: "12px" } },
    });
    elementsRef.current = elements;
    if (peRef.current) {
      try {
        peRef.current.unmount();
      } catch (_) {
        /* ignore */
      }
    }
    const pe = elements.create("payment", {
      layout: "tabs",
      wallets: { applePay: "auto", googlePay: "auto" },
    });
    peRef.current = pe;
    if (mountRef.current) pe.mount(mountRef.current);
  };

  const handlePay = async () => {
    setBusy(true);
    setError("");
    try {
      await ensureElements();
      const stripe = stripeRef.current;
      const elements = elementsRef.current;
      const { error: submitErr } = await elements.submit();
      if (submitErr) throw new Error(submitErr.message);

      const confirmParams = {
        return_url: window.location.href.split("#")[0],
      };
      if (requireShipping) {
        confirmParams.shipping = {
          name: ship.name,
          address: {
            line1: ship.street,
            city: ship.city,
            state: ship.state,
            postal_code: ship.zip,
            country: "US",
          },
        };
      }

      const { error: confErr, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams,
        redirect: "if_required",
      });
      if (confErr) throw new Error(confErr.message);
      if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "processing") {
        onSuccess?.(paymentIntent, requireShipping ? ship : null);
        return;
      }
      throw new Error("Payment not completed");
    } catch (e) {
      setError(e?.message || "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  const IS = {
    background: "#fff",
    border: "1px solid #d8e0ea",
    borderRadius: 12,
    padding: "11px 12px",
    fontSize: 14,
    width: "100%",
    outline: "none",
    boxSizing: "border-box",
    marginBottom: 8,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 800,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "28px 28px 0 0",
          padding: "24px 20px 40px",
          width: "100%",
          maxWidth: 430,
          maxHeight: "92vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: "#2C3E50" }}>{title}</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{subtitle}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{ background: "#E4EBF2", border: "none", borderRadius: "50%", width: 32, height: 32, fontSize: 16, cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        {amountLabel && (
          <div
            style={{
              background: "#f0fff8",
              border: "1px solid #00b89433",
              borderRadius: 14,
              padding: "12px 14px",
              marginBottom: 14,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: "#2C3E50" }}>Total</span>
            <span style={{ fontSize: 20, fontWeight: 900, color: "#00b894" }}>{amountLabel}</span>
          </div>
        )}

        {requireShipping && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", marginBottom: 8, letterSpacing: 0.8 }}>
              SHIP TO (required)
            </div>
            <input value={ship.name} onChange={(e) => setShip((s) => ({ ...s, name: e.target.value }))} placeholder="Full name *" style={IS} />
            <input value={ship.street} onChange={(e) => setShip((s) => ({ ...s, street: e.target.value }))} placeholder="Street address *" style={IS} />
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
              <input value={ship.city} onChange={(e) => setShip((s) => ({ ...s, city: e.target.value }))} placeholder="City *" style={IS} />
              <input value={ship.state} onChange={(e) => setShip((s) => ({ ...s, state: e.target.value }))} placeholder="ST *" maxLength={2} style={IS} />
              <input value={ship.zip} onChange={(e) => setShip((s) => ({ ...s, zip: e.target.value }))} placeholder="ZIP *" maxLength={10} style={IS} />
            </div>
          </div>
        )}

        <div
          ref={mountRef}
          id="inhand-payment-element"
          style={{
            minHeight: requireShipping ? 0 : 180,
            marginBottom: 12,
            display: requireShipping && loading ? "none" : "block",
          }}
        />

        {loading && !requireShipping && (
          <div style={{ textAlign: "center", padding: "24px 0", color: "#aaa", fontSize: 13 }}>Loading secure payment…</div>
        )}

        {error && (
          <div style={{ background: "#fff0f0", borderRadius: 12, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: "#ff6b6b", fontWeight: 600 }}>
            {error}
          </div>
        )}

        <button
          type="button"
          disabled={busy}
          onClick={handlePay}
          style={{
            width: "100%",
            background: "#2C3E50",
            border: "none",
            borderRadius: 14,
            padding: "14px",
            color: "#fff",
            fontWeight: 800,
            fontSize: 15,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Processing…" : amountLabel ? `Pay ${amountLabel}` : "Pay now"}
        </button>
        <div style={{ fontSize: 10, color: "#aaa", textAlign: "center", marginTop: 10 }}>
          Powered by Stripe · Apple Pay / Google Pay when available
        </div>
      </div>
    </div>
  );
}

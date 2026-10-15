import { useEffect, useMemo, useRef, useState } from "react";
import { createPaymentIntent, getStripe } from "./lib/stripePaymentSheet";
import { clearMountNode, preferCardElement, waitForNode } from "./lib/stripeElements";

function fmtMoney(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

function pmId(pm) {
  return pm?.stripePaymentMethodId || pm?.id || "";
}

/**
 * In-app Stripe pay sheet.
 * Shows saved cards first; optional “new card” via Card Element.
 */
export default function PaymentSheetModal({
  title = "Pay securely",
  subtitle = "Card details are handled by Stripe — never stored in In Hand.",
  amountCents,
  amountLabel,
  breakdown = null,
  purpose = "purchase",
  listingId,
  metadata = {},
  requireShipping = false,
  defaultShipping,
  savedPaymentMethods = [],
  onSuccess,
  onClose,
}) {
  const methods = useMemo(
    () => (Array.isArray(savedPaymentMethods) ? savedPaymentMethods.filter((p) => pmId(p)) : []),
    [savedPaymentMethods],
  );
  const defaultPm = methods.find((p) => p.isDefault) || methods[0] || null;
  const [selectedPmId, setSelectedPmId] = useState(defaultPm ? pmId(defaultPm) : "new");
  const useSaved = selectedPmId && selectedPmId !== "new";

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [chargedCents, setChargedCents] = useState(amountCents);
  const [lines, setLines] = useState(breakdown || []);
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
  const cardRef = useRef(null);
  const peRef = useRef(null);
  const clientSecretRef = useRef("");
  const mountGen = useRef(0);
  const useCard = preferCardElement();

  useEffect(() => {
    if (defaultPm && selectedPmId === "new" && methods.length) {
      setSelectedPmId(pmId(defaultPm));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methods.length]);

  const destroy = () => {
    try {
      cardRef.current?.destroy?.();
    } catch {
      /* ignore */
    }
    try {
      peRef.current?.unmount?.();
    } catch {
      /* ignore */
    }
    cardRef.current = null;
    peRef.current = null;
    elementsRef.current = null;
  };

  const applyIntentMeta = (intent) => {
    if (intent.amountCents) setChargedCents(intent.amountCents);
    if (purpose === "trade_fee" && (intent.tradeFeeCents != null || intent.labelCents != null)) {
      const next = [];
      if (intent.tradeFeeCents != null) {
        next.push({ label: "Trade fee", amountCents: intent.tradeFeeCents });
      }
      if (intent.labelCents != null && intent.labelCents > 0) {
        next.push({
          label: intent.shippingLabel ? `USPS label (${intent.shippingLabel})` : "USPS shipping label",
          amountCents: intent.labelCents,
        });
      }
      if (next.length) setLines(next);
    }
  };

  const mountNewCardForm = async (clientSecret, gen) => {
    const stripe = await getStripe();
    if (!stripe) {
      throw new Error(
        "Stripe publishable key missing. Rebuild with REACT_APP_STRIPE_PUBLISHABLE_KEY (same mode as Supabase secret).",
      );
    }
    if (gen !== mountGen.current) return;

    destroy();
    clearMountNode(mountRef.current);
    stripeRef.current = stripe;
    clientSecretRef.current = clientSecret;

    const node = await waitForNode(mountRef);
    if (!node || gen !== mountGen.current) {
      throw new Error("Payment form container not ready — close and try again");
    }

    if (useCard) {
      const elements = stripe.elements();
      elementsRef.current = elements;
      const card = elements.create("card", {
        style: {
          base: {
            fontSize: "16px",
            color: "#2C3E50",
            "::placeholder": { color: "#aaa" },
          },
        },
      });
      cardRef.current = card;
      await new Promise((resolve, reject) => {
        card.on("ready", resolve);
        card.on("change", (e) => {
          if (e.error) setError(e.error.message);
          else setError("");
        });
        try {
          card.mount(node);
        } catch (err) {
          reject(err);
        }
        setTimeout(resolve, 400);
      });
    } else {
      const elements = stripe.elements({
        clientSecret,
        appearance: {
          theme: "stripe",
          variables: { borderRadius: "12px", colorPrimary: "#2C3E50" },
        },
      });
      elementsRef.current = elements;
      const pe = elements.create("payment", {
        layout: "tabs",
        wallets: { applePay: "never", googlePay: "never" },
      });
      peRef.current = pe;
      pe.mount(node);
    }
  };

  const fetchIntent = async (shippingPayload, paymentMethodId) => {
    const intent = await createPaymentIntent({
      amountCents,
      purpose,
      metadata: { ...metadata, ...(listingId ? { listingId } : {}) },
      listingId,
      shipmentId: metadata?.shipment_id,
      proposalId: metadata?.proposal_id,
      shipping: shippingPayload,
      paymentMethodId: paymentMethodId || undefined,
    });
    if (!intent.clientSecret) throw new Error("PaymentIntent missing client secret");
    applyIntentMeta(intent);
    return intent;
  };

  const boot = async () => {
    const gen = ++mountGen.current;
    setLoading(true);
    setReady(false);
    setError("");
    try {
      const stripe = await getStripe();
      if (!stripe) throw new Error("Stripe publishable key missing");
      stripeRef.current = stripe;

      if (requireShipping) {
        setLoading(false);
        setReady(!!useSaved);
        return;
      }

      if (useSaved) {
        // Saved card: create PI with customer + PM; no Card Element needed
        const intent = await fetchIntent(undefined, selectedPmId);
        if (gen !== mountGen.current) return;
        clientSecretRef.current = intent.clientSecret;
        destroy();
        setReady(true);
        setLoading(false);
        return;
      }

      const intent = await fetchIntent(undefined);
      if (gen !== mountGen.current) return;
      await mountNewCardForm(intent.clientSecret, gen);
      if (gen !== mountGen.current) return;
      setReady(true);
      setLoading(false);
    } catch (e) {
      if (gen !== mountGen.current) return;
      console.error("In Hand: PaymentSheetModal", e);
      const msg = e?.message || "Could not start payment";
      setError(
        /elements store/i.test(msg)
          ? "Payment form failed to load. Tap Retry — if it keeps happening, Stripe test/live keys may be mismatched."
          : msg,
      );
      setLoading(false);
      setReady(false);
    }
  };

  useEffect(() => {
    boot();
    return () => {
      mountGen.current += 1;
      destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountCents, purpose, listingId, requireShipping, metadata?.shipment_id, selectedPmId]);

  const shippingPayloadOrThrow = () => {
    if (!requireShipping) return undefined;
    if (!ship.name || !ship.street || !ship.city || !ship.state || !ship.zip) {
      throw new Error("Enter a complete US shipping address");
    }
    return {
      name: ship.name,
      address: {
        line1: ship.street,
        city: ship.city,
        state: ship.state,
        postal_code: ship.zip,
        country: "US",
      },
    };
  };

  const handlePay = async () => {
    setBusy(true);
    setError("");
    try {
      const stripe = stripeRef.current || (await getStripe());
      if (!stripe) throw new Error("Stripe not ready — tap Retry");
      stripeRef.current = stripe;

      const shippingPayload = shippingPayloadOrThrow();
      let paymentIntent;

      if (useSaved) {
        const intent = await fetchIntent(shippingPayload, selectedPmId);
        clientSecretRef.current = intent.clientSecret;
        const confirmOpts = {
          payment_method: selectedPmId,
        };
        if (shippingPayload) {
          confirmOpts.shipping = {
            name: shippingPayload.name,
            address: shippingPayload.address,
          };
        }
        const { error: confErr, paymentIntent: pi } = await stripe.confirmCardPayment(
          clientSecretRef.current,
          confirmOpts,
          { handleActions: true },
        );
        if (confErr) throw new Error(confErr.message);
        paymentIntent = pi;
      } else if (useCard) {
        if (!clientSecretRef.current || !cardRef.current) {
          const gen = ++mountGen.current;
          const intent = await fetchIntent(shippingPayload);
          await mountNewCardForm(intent.clientSecret, gen);
        }
        const card = cardRef.current;
        if (!card || !clientSecretRef.current) throw new Error("Card form not ready — tap Retry");
        const confirmOpts = { payment_method: { card } };
        if (shippingPayload) {
          confirmOpts.shipping = {
            name: shippingPayload.name,
            address: shippingPayload.address,
          };
        }
        const { error: confErr, paymentIntent: pi } = await stripe.confirmCardPayment(
          clientSecretRef.current,
          confirmOpts,
          { handleActions: true },
        );
        if (confErr) throw new Error(confErr.message);
        paymentIntent = pi;
      } else {
        const elements = elementsRef.current;
        if (!elements || !clientSecretRef.current) {
          const gen = ++mountGen.current;
          const intent = await fetchIntent(shippingPayload);
          await mountNewCardForm(intent.clientSecret, gen);
        }
        const els = elementsRef.current;
        if (!els) throw new Error("Payment form not ready — tap Retry");
        const { error: submitErr } = await els.submit();
        if (submitErr) throw new Error(submitErr.message);
        const confirmParams = { return_url: window.location.href.split("#")[0] };
        if (shippingPayload) {
          confirmParams.shipping = {
            name: shippingPayload.name,
            address: shippingPayload.address,
          };
        }
        const { error: confErr, paymentIntent: pi } = await stripe.confirmPayment({
          elements: els,
          confirmParams,
          redirect: "if_required",
        });
        if (confErr) throw new Error(confErr.message);
        paymentIntent = pi;
      }

      if (paymentIntent?.status === "requires_action") {
        throw new Error("Bank verification stayed incomplete — try again without leaving the app");
      }
      if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "processing") {
        onSuccess?.(paymentIntent, requireShipping ? ship : null);
        return;
      }
      throw new Error("Payment not completed");
    } catch (e) {
      const msg = e?.message || "Payment failed";
      setError(
        /elements store/i.test(msg)
          ? "Payment form glitched. Close this sheet and try again, or tap Retry."
          : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  const displayLabel = amountLabel || fmtMoney(chargedCents);
  const IS = {
    background: "#fff",
    border: "1px solid #d8e0ea",
    borderRadius: 12,
    padding: "11px 12px",
    fontSize: 16,
    width: "100%",
    outline: "none",
    boxSizing: "border-box",
    marginBottom: 8,
  };

  const showNewCardMount = !useSaved;

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
        className="inhand-sheet"
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

        {(lines?.length > 0 || displayLabel) && (
          <div
            style={{
              background: "#f0fff8",
              border: "1px solid #00b89433",
              borderRadius: 14,
              padding: "12px 14px",
              marginBottom: 14,
            }}
          >
            {(lines || []).map((row) => (
              <div
                key={row.label}
                style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13, color: "#555" }}
              >
                <span>{row.label}</span>
                <span style={{ fontWeight: 700 }}>{fmtMoney(row.amountCents)}</span>
              </div>
            ))}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: lines?.length ? 8 : 0,
                paddingTop: lines?.length ? 8 : 0,
                borderTop: lines?.length ? "1px solid #00b89433" : "none",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: "#2C3E50" }}>Total</span>
              <span style={{ fontSize: 20, fontWeight: 900, color: "#00b894" }}>
                {fmtMoney(chargedCents) || displayLabel}
              </span>
            </div>
          </div>
        )}

        {methods.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#aaa", marginBottom: 8, letterSpacing: 0.8 }}>
              PAY WITH
            </div>
            {methods.map((pm) => {
              const id = pmId(pm);
              const selected = selectedPmId === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedPmId(id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: selected ? "#EAF1FA" : "#f9f9f9",
                    border: `2px solid ${selected ? "#3A7BD5" : "transparent"}`,
                    borderRadius: 14,
                    padding: "12px 14px",
                    marginBottom: 8,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <span style={{ fontSize: 22 }}>💳</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#2C3E50" }}>
                      {(pm.brand || "Card").toString()} ···· {pm.last4}
                    </div>
                    {pm.expiry && <div style={{ fontSize: 11, color: "#aaa" }}>Expires {pm.expiry}</div>}
                  </div>
                  {pm.isDefault && (
                    <span style={{ fontSize: 9, background: "#e8fff6", color: "#00b894", borderRadius: 6, padding: "2px 8px", fontWeight: 700 }}>
                      DEFAULT
                    </span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setSelectedPmId("new")}
              style={{
                width: "100%",
                textAlign: "left",
                background: selectedPmId === "new" ? "#EAF1FA" : "#f9f9f9",
                border: `2px solid ${selectedPmId === "new" ? "#3A7BD5" : "transparent"}`,
                borderRadius: 14,
                padding: "12px 14px",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
                color: "#2C3E50",
              }}
            >
              + Use a different card
            </button>
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

        {showNewCardMount && (
          <div
            style={{
              position: "relative",
              minHeight: 120,
              marginBottom: 12,
              padding: useCard ? "14px 12px" : 0,
              border: useCard ? "1px solid #d8e0ea" : "none",
              borderRadius: 12,
              background: "#fff",
            }}
          >
            <div ref={mountRef} id="inhand-payment-element" style={{ minHeight: useCard ? 40 : 160 }} />
            {loading && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(255,255,255,0.92)",
                  color: "#aaa",
                  fontSize: 13,
                  borderRadius: 12,
                }}
              >
                Loading secure payment…
              </div>
            )}
          </div>
        )}

        {/* Keep mount node in DOM when using saved card so remounts work */}
        {!showNewCardMount && <div ref={mountRef} style={{ display: "none" }} />}

        {useSaved && loading && (
          <div style={{ textAlign: "center", color: "#aaa", fontSize: 13, marginBottom: 12 }}>Preparing saved card…</div>
        )}

        {error && (
          <div style={{ background: "#fff0f0", borderRadius: 12, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: "#ff6b6b", fontWeight: 600, lineHeight: 1.45 }}>
            {error}
          </div>
        )}

        {!ready && !loading && showNewCardMount && (
          <button
            type="button"
            onClick={boot}
            style={{
              width: "100%",
              background: "#EAF1FA",
              border: "none",
              borderRadius: 14,
              padding: "12px",
              color: "#2C3E50",
              fontWeight: 800,
              fontSize: 14,
              cursor: "pointer",
              marginBottom: 10,
            }}
          >
            Retry loading payment form
          </button>
        )}

        <button
          type="button"
          disabled={busy || loading}
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
            opacity: busy || loading ? 0.7 : 1,
          }}
        >
          {busy ? "Processing…" : `Pay ${fmtMoney(chargedCents) || displayLabel}`}
        </button>
        <div style={{ fontSize: 10, color: "#aaa", textAlign: "center", marginTop: 10 }}>
          Powered by Stripe · card details never touch In Hand
        </div>
      </div>
    </div>
  );
}

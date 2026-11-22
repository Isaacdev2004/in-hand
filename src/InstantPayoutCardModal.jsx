import { useEffect, useRef, useState } from "react";
import { getStripe } from "./lib/stripePaymentSheet";
import { attachInstantPayoutCard } from "./lib/stripeConnect";
import { clearMountNode, waitForNode } from "./lib/stripeElements";

const fieldWrap = {
  border: "1px solid #d8e0ea",
  borderRadius: 12,
  padding: "12px 14px",
  background: "#fff",
  marginBottom: 10,
};

const labelStyle = {
  fontSize: 11,
  fontWeight: 700,
  color: "#888",
  marginBottom: 6,
  letterSpacing: 0.3,
};

/**
 * Instant payout debit card — Card Element fields entirely in-app (no Stripe website).
 */
export default function InstantPayoutCardModal({ onSuccess, onClose }) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const numberRef = useRef(null);
  const expiryRef = useRef(null);
  const cvcRef = useRef(null);
  const numberEl = useRef(null);
  const expiryEl = useRef(null);
  const cvcEl = useRef(null);
  const stripeRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const stripe = await getStripe();
        if (!stripe) throw new Error("Stripe publishable key missing");
        if (cancelled) return;
        stripeRef.current = stripe;

        const style = {
          base: { fontSize: "16px", color: "#2C3E50", "::placeholder": { color: "#aaa" } },
        };
        const elements = stripe.elements();

        const numNode = await waitForNode(numberRef);
        const expNode = await waitForNode(expiryRef);
        const cvcNode = await waitForNode(cvcRef);
        if (!numNode || !expNode || !cvcNode || cancelled) throw new Error("Card form not ready");

        clearMountNode(numNode);
        clearMountNode(expNode);
        clearMountNode(cvcNode);

        const cardNumber = elements.create("cardNumber", { style, showIcon: true });
        const cardExpiry = elements.create("cardExpiry", { style });
        const cardCvc = elements.create("cardCvc", { style });
        numberEl.current = cardNumber;
        expiryEl.current = cardExpiry;
        cvcEl.current = cardCvc;

        const onChange = (e) => {
          if (e.error) setError(e.error.message);
          else setError("");
        };
        cardNumber.on("change", onChange);
        cardExpiry.on("change", onChange);
        cardCvc.on("change", onChange);

        cardNumber.mount(numNode);
        cardExpiry.mount(expNode);
        cardCvc.mount(cvcNode);

        setReady(true);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || "Could not load card form");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      try {
        numberEl.current?.destroy?.();
        expiryEl.current?.destroy?.();
        cvcEl.current?.destroy?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const handleSave = async () => {
    setBusy(true);
    setError("");
    try {
      if (!name.trim()) throw new Error("Enter the name on the debit card");
      const stripe = stripeRef.current;
      const cardNumber = numberEl.current;
      if (!stripe || !cardNumber) throw new Error("Card form not ready");
      const { token, error: tokErr } = await stripe.createToken(cardNumber, {
        name: name.trim(),
      });
      if (tokErr) throw new Error(tokErr.message);
      if (!token?.id) throw new Error("Could not tokenize card");
      if (token.card?.funding && token.card.funding !== "debit") {
        console.warn("In Hand: card funding is", token.card.funding);
      }
      const result = await attachInstantPayoutCard(token.id);
      onSuccess?.(result);
    } catch (e) {
      setError(e?.message || "Could not save debit card");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 860,
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: "#2C3E50" }}>Set Up Instant Payout</div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{ background: "#E4EBF2", border: "none", borderRadius: "50%", width: 32, height: 32, fontSize: 16, cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        <div style={{ marginBottom: 4 }}>
          <div style={labelStyle}>Debit card number</div>
          <div style={{ ...fieldWrap, position: "relative", minHeight: 24 }}>
            <div ref={numberRef} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 4 }}>
          <div>
            <div style={labelStyle}>Expiry</div>
            <div style={{ ...fieldWrap, minHeight: 24 }}>
              <div ref={expiryRef} />
            </div>
          </div>
          <div>
            <div style={labelStyle}>CVC</div>
            <div style={{ ...fieldWrap, minHeight: 24 }}>
              <div ref={cvcRef} />
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Name on card</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name on card"
            style={{
              width: "100%",
              border: "1px solid #d8e0ea",
              borderRadius: 12,
              padding: "12px 14px",
              fontSize: 16,
              boxSizing: "border-box",
              outline: "none",
            }}
          />
        </div>

        {loading && (
          <div style={{ textAlign: "center", color: "#aaa", fontSize: 13, marginBottom: 12 }}>Loading secure card form…</div>
        )}

        {error && (
          <div style={{ background: "#fff0f0", borderRadius: 12, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: "#ff6b6b", fontWeight: 600, lineHeight: 1.45 }}>
            {error}
          </div>
        )}

        <button
          type="button"
          disabled={busy || loading || !ready}
          onClick={handleSave}
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
            opacity: busy || loading || !ready ? 0.7 : 1,
            marginBottom: 12,
          }}
        >
          {busy ? "Saving…" : "Save Debit Card"}
        </button>

        <div style={{ fontSize: 12, color: "#555", textAlign: "center", lineHeight: 1.5 }}>
          Money arrives within 30 minutes
          <br />
          Stripe 1% fee applies
        </div>
      </div>
    </div>
  );
}

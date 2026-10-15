import { useEffect, useRef, useState } from "react";
import { getStripe } from "./lib/stripePaymentSheet";
import { attachInstantPayoutCard } from "./lib/stripeConnect";
import { clearMountNode, waitForNode } from "./lib/stripeElements";

/**
 * Collect debit card in-app (Card Element) for Stripe Instant Payouts.
 * No Stripe website / webview — tokenize + attach to Connect account.
 */
export default function InstantPayoutCardModal({ onSuccess, onClose }) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const mountRef = useRef(null);
  const cardRef = useRef(null);
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
        clearMountNode(mountRef.current);
        const node = await waitForNode(mountRef);
        if (!node || cancelled) throw new Error("Card form not ready");
        const elements = stripe.elements();
        const card = elements.create("card", {
          style: {
            base: { fontSize: "16px", color: "#2C3E50", "::placeholder": { color: "#aaa" } },
          },
          hidePostalCode: false,
        });
        cardRef.current = card;
        card.on("change", (e) => {
          if (e.error) setError(e.error.message);
          else setError("");
        });
        card.mount(node);
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
        cardRef.current?.destroy?.();
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
      const card = cardRef.current;
      if (!stripe || !card) throw new Error("Card form not ready");
      const { token, error: tokErr } = await stripe.createToken(card, {
        name: name.trim(),
      });
      if (tokErr) throw new Error(tokErr.message);
      if (!token?.id) throw new Error("Could not tokenize card");
      if (token.card?.funding && token.card.funding !== "debit") {
        // Soft warn — Instant Payouts require eligible debit; still try attach
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: "#2C3E50" }}>Set Up Instant Payout</div>
            <div style={{ fontSize: 11, color: "#888", marginTop: 4, lineHeight: 1.45 }}>
              Debit card only · money usually within 30 minutes · Stripe ~1% fee (you pay)
            </div>
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
            marginBottom: 12,
            boxSizing: "border-box",
            outline: "none",
          }}
        />

        <div
          style={{
            position: "relative",
            minHeight: 48,
            marginBottom: 12,
            padding: "14px 12px",
            border: "1px solid #d8e0ea",
            borderRadius: 12,
            background: "#fff",
          }}
        >
          <div ref={mountRef} style={{ minHeight: 40 }} />
          {loading && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.92)", color: "#aaa", fontSize: 13, borderRadius: 12 }}>
              Loading secure card form…
            </div>
          )}
        </div>

        <div style={{ background: "#f0fff8", border: "1px solid #00b89433", borderRadius: 12, padding: "10px 12px", marginBottom: 12, fontSize: 11, color: "#555", lineHeight: 1.5 }}>
          Money arrives within ~30 minutes after escrow releases. Stripe&apos;s Instant Payout fee (~1%) is deducted from your payout — In Hand does not add an extra fee.
        </div>

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
          }}
        >
          {busy ? "Saving…" : "Save Debit Card"}
        </button>
        <div style={{ fontSize: 10, color: "#aaa", textAlign: "center", marginTop: 10 }}>
          Stays in the app · powered by Stripe
        </div>
      </div>
    </div>
  );
}

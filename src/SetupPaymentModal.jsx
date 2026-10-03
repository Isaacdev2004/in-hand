import { useEffect, useRef, useState } from "react";
import { getStripe } from "./lib/stripePaymentSheet";
import { createSetupIntent, syncPaymentMethods } from "./lib/stripeCustomer";

/**
 * Save a card with Stripe SetupIntent (Apple Pay / card).
 * Never touches raw card numbers — Stripe Elements only.
 */
export default function SetupPaymentModal({
  title = "Add a payment method",
  subtitle = "Required to buy, propose trades, or accept trades with a cash top-up. Card details stay with Stripe.",
  onSuccess,
  onClose,
}) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
        const { clientSecret } = await createSetupIntent();
        if (cancelled) return;
        const stripe = await getStripe();
        if (!stripe) throw new Error("Stripe failed to load");
        stripeRef.current = stripe;
        const elements = stripe.elements({
          clientSecret,
          appearance: { theme: "stripe", variables: { borderRadius: "12px", colorPrimary: "#2C3E50" } },
        });
        elementsRef.current = elements;
        const pe = elements.create("payment", {
          layout: "tabs",
          wallets: { applePay: "auto", googlePay: "auto" },
        });
        peRef.current = pe;
        await new Promise((r) => requestAnimationFrame(r));
        if (mountRef.current && !cancelled) pe.mount(mountRef.current);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || "Could not start card setup");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      try {
        peRef.current?.unmount?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const handleSave = async () => {
    setBusy(true);
    setError("");
    try {
      const stripe = stripeRef.current;
      const elements = elementsRef.current;
      if (!stripe || !elements) throw new Error("Form not ready — close and try again");
      const { error: submitErr } = await elements.submit();
      if (submitErr) throw new Error(submitErr.message);
      const { error: confErr, setupIntent } = await stripe.confirmSetup({
        elements,
        confirmParams: { return_url: window.location.href.split("#")[0] },
        redirect: "if_required",
      });
      if (confErr) throw new Error(confErr.message);
      if (setupIntent?.status !== "succeeded" && setupIntent?.status !== "processing") {
        throw new Error("Card was not saved");
      }
      const synced = await syncPaymentMethods();
      onSuccess?.(synced?.paymentMethods || []);
    } catch (e) {
      setError(e?.message || "Could not save card");
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
        zIndex: 850,
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
            <div style={{ fontSize: 11, color: "#888", marginTop: 4, lineHeight: 1.45 }}>{subtitle}</div>
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

        <div style={{ position: "relative", minHeight: 180, marginBottom: 12 }}>
          <div ref={mountRef} />
          {loading && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "#fff",
                color: "#aaa",
                fontSize: 13,
              }}
            >
              Loading secure card form…
            </div>
          )}
        </div>

        {error && (
          <div style={{ background: "#fff0f0", borderRadius: 12, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: "#ff6b6b", fontWeight: 600 }}>
            {error}
          </div>
        )}

        <button
          type="button"
          disabled={busy || loading}
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
            opacity: busy || loading ? 0.7 : 1,
          }}
        >
          {busy ? "Saving…" : "Save payment method"}
        </button>
        <div style={{ fontSize: 10, color: "#aaa", textAlign: "center", marginTop: 10 }}>
          Powered by Stripe · never stored on In Hand servers
        </div>
      </div>
    </div>
  );
}

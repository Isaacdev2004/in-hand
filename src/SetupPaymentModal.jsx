import { useEffect, useRef, useState } from "react";
import { getStripe } from "./lib/stripePaymentSheet";
import { createSetupIntent, syncPaymentMethods } from "./lib/stripeCustomer";
import { clearMountNode, preferCardElement, waitForNode } from "./lib/stripeElements";

/**
 * Save a card with Stripe SetupIntent.
 * Native iOS uses Card Element (reliable in WKWebView); web can use Payment Element.
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
  const [ready, setReady] = useState(false);
  const mountRef = useRef(null);
  const elementsRef = useRef(null);
  const stripeRef = useRef(null);
  const cardRef = useRef(null);
  const peRef = useRef(null);
  const clientSecretRef = useRef("");
  const genRef = useRef(0);
  const useCard = preferCardElement();

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

  const mountForm = async (clientSecret, gen) => {
    const stripe = await getStripe();
    if (!stripe) {
      throw new Error(
        "Stripe publishable key missing or failed to load. Rebuild the app with REACT_APP_STRIPE_PUBLISHABLE_KEY set (must match live/test secret on Supabase).",
      );
    }
    if (gen !== genRef.current) return;

    destroy();
    clearMountNode(mountRef.current);
    stripeRef.current = stripe;
    clientSecretRef.current = clientSecret;

    const node = await waitForNode(mountRef);
    if (!node || gen !== genRef.current) {
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
        // ready event may not fire on some WebViews — resolve after mount
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
        wallets: { applePay: "auto", googlePay: "auto" },
      });
      peRef.current = pe;
      pe.mount(node);
    }
  };

  const boot = async () => {
    const gen = ++genRef.current;
    setLoading(true);
    setReady(false);
    setError("");
    try {
      const { clientSecret } = await createSetupIntent();
      if (!clientSecret) throw new Error("SetupIntent returned no client secret — is create-setup-intent deployed?");
      if (gen !== genRef.current) return;
      await mountForm(clientSecret, gen);
      if (gen !== genRef.current) return;
      setReady(true);
      setLoading(false);
    } catch (e) {
      if (gen !== genRef.current) return;
      console.error("In Hand: SetupPaymentModal", e);
      const msg = e?.message || "Could not start card setup";
      setError(
        /404|Failed to fetch|FunctionsRelay/i.test(msg)
          ? "Card setup API not reachable. Deploy create-setup-intent on Supabase (Owner account)."
          : msg,
      );
      setLoading(false);
      setReady(false);
    }
  };

  useEffect(() => {
    boot();
    return () => {
      genRef.current += 1;
      destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setBusy(true);
    setError("");
    try {
      const stripe = stripeRef.current;
      if (!stripe) throw new Error("Stripe not ready");

      if (useCard) {
        const card = cardRef.current;
        if (!card) throw new Error("Card form not ready — tap Retry");
        const { error: confErr, setupIntent } = await stripe.confirmCardSetup(
          clientSecretRef.current,
          { payment_method: { card } },
          { handleActions: true },
        );
        if (confErr) throw new Error(confErr.message);
        if (setupIntent?.status === "requires_action") {
          throw new Error("Card verification needs another step — try again in the app sheet");
        }
        if (setupIntent?.status !== "succeeded" && setupIntent?.status !== "processing") {
          throw new Error("Card was not saved");
        }
      } else {
        const elements = elementsRef.current;
        if (!elements) throw new Error("Form not ready — tap Retry");
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
          <div ref={mountRef} id="inhand-setup-card-mount" style={{ minHeight: useCard ? 40 : 160 }} />
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
              Loading secure card form…
            </div>
          )}
        </div>

        {error && (
          <div style={{ background: "#fff0f0", borderRadius: 12, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: "#ff6b6b", fontWeight: 600, lineHeight: 1.45 }}>
            {error}
          </div>
        )}

        {!ready && !loading && (
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
            Retry loading card form
          </button>
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
          {busy ? "Saving…" : "Save payment method"}
        </button>
        <div style={{ fontSize: 10, color: "#aaa", textAlign: "center", marginTop: 10 }}>
          Powered by Stripe · never stored on In Hand servers
        </div>
      </div>
    </div>
  );
}

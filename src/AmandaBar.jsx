import React, { useEffect, useRef, useState } from "react";

/**
 * Ask Amanda — the desk's assistant, on every page.
 *
 * The panel is thin on purpose: it sends the conversation to /api/amanda/chat, where the figures are
 * computed by the engine and the words come from Muse Spark. Nothing here invents a number, and if
 * the endpoint cannot answer, the panel says so in the client's own eyes rather than guessing.
 *
 * "Powered by Meta" is a statement of fact, not decoration: the reply is written by a Meta model,
 * the distances and prices are computed in the Worker before that model is called.
 */
const NAVY = "#0a1f3c";
const GOLD = "#c9a227";
const GOLD_LIGHT = "#f5e7bd";
const PAPER = "#ffffff";

const CHIPS = [
  "Quote DDP Nairobi to Kampala, 27 tonnes",
  "What documents clear a container at Mombasa?",
  "How long does Mombasa to Kigali take?",
  "I want to source solar panels from China",
];

export default function AmandaBar({ contextHint = "", country = "KE", lang = "en" }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const bodyRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, busy, open]);

  async function send(text) {
    const question = String(text ?? draft).trim();
    if (!question || busy) return;
    const next = [...messages, { role: "user", content: question }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/amanda/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.slice(-8),
          context: { page: (typeof window !== "undefined" && window.location.hash.replace(/^#\/?/, "")) || "desk", hint: contextHint.slice(0, 400), country, lang },
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `the desk answered ${res.status}`);
      setMessages((m) => [...m, { role: "assistant", content: out.reply || "(no answer)" }]);
      if (out.degraded) setNote("Computed figures only — the model is briefly offline.");
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `I could not reach the desk just now (${err.message}). The desk is on +254 718 554 383 and altovexgl@gmail.com.` },
      ]);
      setNote("Offline — please try again, or call the desk.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ask Amanda"
          style={{
            position: "fixed", right: 16, bottom: 16, zIndex: 60, display: "flex",
            alignItems: "center", gap: 10, padding: "10px 16px", minHeight: 48,
            borderRadius: 999, border: `2px solid ${GOLD}`, background: NAVY, color: PAPER,
            cursor: "pointer", boxShadow: "0 6px 24px rgba(10,31,60,.28)",
          }}
        >
          <span style={{ fontWeight: 700 }}>Ask Amanda</span>
          <span style={{ fontSize: 11, color: GOLD_LIGHT, borderLeft: `1px solid ${GOLD}`, paddingLeft: 10 }}>Powered by Meta</span>
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="Ask Amanda"
          style={{
            position: "fixed", right: 12, bottom: 12, zIndex: 60, width: "min(420px, calc(100vw - 24px))",
            maxHeight: "min(640px, calc(100vh - 24px))", display: "flex", flexDirection: "column",
            background: PAPER, borderRadius: 14, border: `2px solid ${GOLD}`,
            boxShadow: "0 18px 48px rgba(10,31,60,.34)", overflow: "hidden",
          }}
        >
          <header style={{ background: NAVY, color: PAPER, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700 }}>Ask Amanda</div>
              <div style={{ fontSize: 11, color: GOLD_LIGHT }}>Powered by Meta · Altovex Global Logistics</div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close Ask Amanda"
              style={{ background: "transparent", color: PAPER, border: `1px solid ${GOLD}`, borderRadius: 8, minWidth: 36, minHeight: 36, cursor: "pointer" }}>
              ✕
            </button>
          </header>

          <div ref={bodyRef} style={{ padding: 12, overflowY: "auto", flex: 1, background: "#f7f9fc" }}>
            {messages.length === 0 && (
              <div style={{ fontSize: 13, color: "#33465e" }}>
                <p style={{ margin: "0 0 10px" }}>
                  Sourcing, ocean freight, clearing, warehousing and last mile — DDP. Ask me anything on the
                  shipment, or pick one of these.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {CHIPS.map((c) => (
                    <button key={c} type="button" onClick={() => send(c)}
                      style={{ fontSize: 12, padding: "7px 10px", borderRadius: 999, border: `1px solid ${GOLD}`, background: PAPER, color: NAVY, cursor: "pointer", textAlign: "left" }}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", margin: "8px 0" }}>
                <div style={{
                  maxWidth: "86%", padding: "9px 11px", borderRadius: 10, fontSize: 13.5, lineHeight: 1.45,
                  whiteSpace: "pre-wrap", background: m.role === "user" ? NAVY : PAPER,
                  color: m.role === "user" ? PAPER : NAVY, border: m.role === "user" ? "none" : "1px solid #dbe4ef",
                }}>
                  {m.content}
                </div>
              </div>
            ))}

            {busy && <div style={{ fontSize: 12.5, color: "#5a6b80", padding: "6px 2px" }}>Amanda is checking the desk…</div>}
            {note && <div role="status" style={{ fontSize: 12, color: "#7a5a00", background: GOLD_LIGHT, borderRadius: 8, padding: "6px 8px", marginTop: 6 }}>{note}</div>}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(); }} style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid #dbe4ef", background: PAPER }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about a shipment, a price, a document…"
              aria-label="Your question for Amanda"
              style={{ flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 8, border: "1px solid #c3cfdd", fontSize: 14 }}
            />
            <button type="submit" disabled={busy || !draft.trim()}
              style={{ padding: "10px 16px", minHeight: 44, borderRadius: 8, border: "none", background: busy ? "#8a7a3a" : GOLD, color: NAVY, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>
              {busy ? "…" : "Send"}
            </button>
          </form>
          <div style={{ fontSize: 10.5, color: "#6b7c91", padding: "0 12px 10px", background: PAPER }}>
            Indicative answers. Prices and bookings are confirmed by the desk in writing.
          </div>
        </section>
      )}
    </>
  );
}

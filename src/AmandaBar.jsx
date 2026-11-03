import React, { useState } from "react";
import { COUNTRIES, GREETINGS, localeSystemPrompt } from "./lib/countries.mjs";

const NAVY = "#0a1f3c";
const GOLD = "#c9a227";
const GOLD_LIGHT = "#f5e7bd";

/**
 * AmandaBar — bottom chat bar, safe to mount on every page.
 * Multilingual: country prop selects currency/tax/rails context and the
 * reply language (EN default + one local language per country). The
 * reasoning model answers in that language; figures stay engine-verbatim.
 * Voice notes go through Muse Voice Transcribe (25 languages,
 * code-switching) before structuring.
 */
export default function AmandaBar({ contextHint = "", country = "KE", lang = "en" }) {
  const c = COUNTRIES[country] || COUNTRIES.KE;
  const greet = GREETINGS[lang] || GREETINGS.en;
  /* Lazy-imports explainQuote from ./lib/meta.js on submit only.
   * explainQuote(quoteFigures, context): figures come from contextHint or
   * fall back to the raw question text; the model only restates figures,
   * never computes. Without a model key it throws ModelUnavailable and we
   * show the labelled fallback instead of invented output. */
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState("");
  const [replyKind, setReplyKind] = useState("idle"); // idle | ok | fallback
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setReply("");
    setReplyKind("idle");
    try {
      const { explainQuote } = await import("./lib/meta.js");
      const figures = contextHint && contextHint.trim() ? contextHint.trim() : "none";
      const locale = localeSystemPrompt(country, lang);
      const out = await explainQuote({ question: `${locale}\n\n${q}`, figures }, `${locale}\n\n${q}`);
      setReply(out && out.text ? out.text : "(empty answer from model)");
      setReplyKind("ok");
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      const label = err && err.name === "ModelUnavailable" ? "Amanda (offline): " : "Amanda (unavailable): ";
      setReply(label + msg);
      setReplyKind("fallback");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 50,
        background: NAVY,
        borderTop: `2px solid ${GOLD}`,
        padding: "8px 12px",
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{ display: "flex", gap: 8, maxWidth: 900, margin: "0 auto", alignItems: "center" }}
      >
        <span className="amandabar-label" style={{ color: GOLD, fontWeight: 700, whiteSpace: "nowrap" }}>Amanda · {c.currency}</span>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={greet}
          aria-label="Ask Amanda"
          style={{
            flex: "1 1 140px",
            minWidth: 0,
            padding: "8px 10px",
            borderRadius: 6,
            border: `1px solid ${GOLD}`,
            background: "#ffffff",
            color: NAVY,
          }}
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          style={{
            padding: "10px 18px",
            minHeight: 44,
            borderRadius: 6,
            border: "none",
            background: busy ? "#8a7a3a" : GOLD,
            color: NAVY,
            fontWeight: 700,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "…" : "Ask"}
        </button>
      </form>
      {replyKind !== "idle" && (
        <div
          role="status"
          style={{
            maxWidth: 900,
            margin: "8px auto 0",
            padding: "8px 10px",
            borderRadius: 6,
            background: replyKind === "ok" ? "#ffffff" : GOLD_LIGHT,
            color: NAVY,
            fontSize: 14,
            whiteSpace: "pre-wrap",
          }}
        >
          {reply}
        </div>
      )}
    </div>
  );
}

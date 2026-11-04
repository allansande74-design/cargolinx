import React, { useEffect, useRef, useState } from "react";

/**
 * Ask Amanda — the desk's assistant, on every page, in the form the client actually uses.
 *
 * Text, voice, a photograph, or a video (one frame of it): all four reach the same Worker route.
 * Voice is turned into 16 kHz WAV here, transcribed by Meta's speech model server-side, and the
 * transcript becomes the question — the client sees what was heard, so a mis-hearing is visible
 * rather than silent. Photographs go to the model as an image part; a video is sampled to a single
 * frame, which is stated plainly rather than pretending the model watched the film.
 *
 * The figures are still computed in the Worker and handed to the model. Nothing here invents a number,
 * and "Powered by Meta" is a statement of fact: the words are a Meta model's, the numbers are ours.
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

const mediaBtn = {
  fontSize: 12,
  padding: "7px 10px",
  borderRadius: 8,
  border: "1px solid #c3cfdd",
  background: "#eef3f9",
  color: NAVY,
  cursor: "pointer",
  minHeight: 34,
};

/** Any recording, resampled to the 16 kHz mono WAV the speech endpoint expects. */
async function toWav16k(blob) {
  const buf = await blob.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const decoded = await new Ctx().decodeAudioData(buf);
  const rate = 16000;
  const frames = Math.max(1, Math.ceil(decoded.duration * rate));
  const off = new OfflineAudioContext(1, frames, rate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const put = (at, str) => { for (let i = 0; i < str.length; i += 1) view.setUint8(at + i, str.charCodeAt(i)); };
  put(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  put(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  let at = 44;
  for (let i = 0; i < pcm.length; i += 1, at += 2) {
    const v = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(at, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = reject;
  r.readAsDataURL(blob);
});

/** Downscale a picture so a phone photo does not become an enormous request. */
function shrink(file, max = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = reject;
    img.src = url;
  });
}

/** One frame from a video, because a chat model reads a picture, not a film. */
function firstFrame(file, at = 0.6) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const url = URL.createObjectURL(file);
    v.onloadeddata = () => { v.currentTime = Math.min(at, (v.duration || 1) / 2); };
    v.onseeked = () => {
      const c = document.createElement("canvas");
      const scale = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    v.onerror = reject;
    v.src = url;
  });
}

export default function AmandaBar({ contextHint = "", country = "KE", lang = "en" }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const bodyRef = useRef(null);
  const recorder = useRef(null);
  const chunks = useRef([]);
  const photoInput = useRef(null);
  const videoInput = useRef(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [messages, busy, open, status]);

  async function send(payload) {
    const text = typeof payload === "string" ? payload : payload?.text;
    const audio = typeof payload === "object" ? payload?.audio : null;
    const image = typeof payload === "object" ? payload?.image : null;
    if ((!text && !audio && !image) || busy) return;

    const label = text ?? (audio ? "Voice note" : "Photograph");
    const next = [...messages, { role: "user", content: label }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    setNote("");
    setStatus(audio ? "Listening…" : "Looking at it…");
    try {
      const res = await fetch("/api/amanda/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.slice(-8),
          audio: audio ?? undefined,
          image: image ?? undefined,
          context: {
            page: (typeof window !== "undefined" && window.location.hash.replace(/^#\/?/, "")) || "desk",
            hint: contextHint.slice(0, 400),
            country,
            lang,
          },
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `the desk answered ${res.status}`);
      setMessages((m) => {
        const shown = out.transcript ? [...m.slice(0, -1), { role: "user", content: `“${out.transcript}”` }] : m;
        return [...shown, { role: "assistant", content: out.reply || "(no answer)" }];
      });
      if (out.degraded) setNote("Computed figures only — the model is briefly offline.");
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `I could not reach the desk just now (${err.message}). The desk is on +254 718 554 383 and altovexgl@gmail.com.` },
      ]);
      setNote("Offline — please try again, or call the desk.");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  async function toggleMic() {
    if (recorder.current && recorder.current.state === "recording") {
      recorder.current.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const rec = new MediaRecorder(stream);
      recorder.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setStatus("Listening…");
        try {
          const wav = await toWav16k(new Blob(chunks.current, { type: chunks.current[0]?.type || "audio/webm" }));
          const dataUrl = await toBase64(wav);
          setStatus("");
          await send({ audio: dataUrl, text: "Voice note" });
        } catch (err) {
          setStatus("");
          setNote(`That recording could not be used: ${err.message}`);
        }
      };
      rec.start();
      setStatus("Recording — press the microphone again to stop.");
    } catch {
      setNote("The microphone is not available on this device.");
    }
  }

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const image = await shrink(file);
      await send({ image, text: file.name ? `Photograph: ${file.name}` : "Photograph" });
    } catch {
      setNote("That picture could not be read.");
    }
  }

  /** Live video is opened by appointment with the CTO; until the avatar channel ships, a clip is a
   *  file, not a call, and the panel says so rather than implying a call is ringing. */
  function askForVideo() {
    setNote("Live video is by authentication — the CTO joins by appointment. Call the desk on +254 718 554 383 to book it; the video desk itself is being finished.");
  }

  async function onVideo(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const image = await firstFrame(file);
      await send({ image, text: `A frame from ${file.name || "a video"}` });
    } catch {
      setNote("That video could not be read.");
    }
  }

  const micOn = recorder.current && recorder.current.state === "recording";

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
                  Sourcing, ocean freight, clearing, warehousing and last mile — DDP. Type, speak, or send a
                  photo of the cargo or a document.
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

            {busy && <div style={{ fontSize: 12.5, color: "#5a6b80", padding: "6px 2px" }}>{status || "Amanda is checking the desk…"}</div>}
            {!busy && status && <div style={{ fontSize: 12.5, color: "#5a6b80", padding: "6px 2px" }}>{status}</div>}
            {note && <div role="status" style={{ fontSize: 12, color: "#7a5a00", background: GOLD_LIGHT, borderRadius: 8, padding: "6px 8px", marginTop: 6 }}>{note}</div>}
          </div>

          <div style={{ display: "flex", gap: 6, padding: "8px 10px 0", background: PAPER }}>
            <button type="button" onClick={toggleMic} aria-label={micOn ? "Stop recording" : "Speak to Amanda"}
              style={{ ...mediaBtn, background: micOn ? "#f3d7d7" : "#eef3f9" }}>
              {micOn ? "◼ Stop" : "🎤 Voice"}
            </button>
            <button type="button" onClick={() => photoInput.current?.click()} aria-label="Send a photograph" style={mediaBtn}>📷 Photo</button>
            <button type="button" onClick={askForVideo} aria-label="Video call with the desk"
              style={{ ...mediaBtn, opacity: 0.85 }}>🎥 Video — by appointment</button>
            <input ref={photoInput} type="file" accept="image/*" onChange={onPhoto} style={{ display: "none" }} />
            <input ref={videoInput} type="file" accept="video/*" onChange={onVideo} style={{ display: "none" }} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(draft); }} style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid #dbe4ef", background: PAPER }}>
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
            Indicative answers. Prices and bookings are confirmed by the desk in writing. A video is read as a
            single frame, and the reply says so.
          </div>
        </section>
      )}
    </>
  );
}

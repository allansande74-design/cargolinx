import React, { useEffect, useMemo, useRef, useState } from "react";
import { landedCost, quote, floorPrice, KE_RATES } from "../engine/landed.mjs";
import { planEta, applyEvent } from "../engine/eta.mjs";
import { STORES, all, put, saveShipment, savePhoto, getPhoto, newId, kvGet } from "./lib/db.js";
import { flush, queueDepth, getConfig, setConfig } from "./lib/sync.js";
import { probe, readCargoPhoto, transcribeVoice, explainQuote, getModelConfig, setModelConfig } from "./lib/meta.js";
import { quoteHtml } from "./lib/quote-doc.mjs";

const money = (n, ccy = "KES") =>
  `${ccy} ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v) => (v === "" || v === null ? 0 : Number(v));

const LANES = {
  "Mombasa - Kampala": [
    { name: "Mombasa - Nairobi", km: 485, speedKph: 50 },
    { name: "Nairobi - Eldoret", km: 320, speedKph: 55 },
    { name: "Eldoret - Malaba", km: 130, speedKph: 50, border: true },
    { name: "Malaba - Kampala", km: 250, speedKph: 45 },
  ],
  "Nairobi - Kampala": [
    { name: "Nairobi - Eldoret", km: 320, speedKph: 55 },
    { name: "Eldoret - Malaba", km: 130, speedKph: 50, border: true },
    { name: "Malaba - Kampala", km: 250, speedKph: 45 },
  ],
  "Mombasa - Nairobi": [{ name: "Mombasa - Nairobi", km: 485, speedKph: 50 }],
  "Nairobi - Kigali": [
    { name: "Nairobi - Eldoret", km: 320, speedKph: 55 },
    { name: "Eldoret - Malaba", km: 130, speedKph: 50, border: true },
    { name: "Malaba - Kampala", km: 250, speedKph: 45 },
    { name: "Kampala - Kigali", km: 510, speedKph: 50, border: true },
  ],
};

const DUTY_BANDS = [
  { v: 0, label: "0% — raw materials, capital goods" },
  { v: 0.1, label: "10% — intermediate, not available locally" },
  { v: 0.25, label: "25% — intermediate, available locally" },
  { v: 0.35, label: "35% — finished goods" },
];

function Money({ value, ccy }) {
  return <span className="money">{money(value, ccy)}</span>;
}

function Badges({ online, queue, backend, model }) {
  return (
    <div className="badges">
      <span className={`badge ${online ? "on" : "off"}`}>{online ? "Online" : "Offline — writes queued"}</span>
      <span className={`badge ${queue > 0 ? "warn" : ""}`}>{queue} queued</span>
      <span className="badge">{backend}</span>
      <span className={`badge ${model.live ? "on" : "warn"}`}>{model.live ? "Models live" : "Models off"}</span>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("new");
  const [shipments, setShipments] = useState([]);
  const [queue, setQueue] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [backend, setBackend] = useState({ label: "Demo server (loopback, on this device)", mode: "loopback" });
  const [model, setModel] = useState({ live: false, reason: "checking" });
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState("");

  async function refresh() {
    setShipments(((await all(STORES.shipments)) ?? []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
    setQueue(await queueDepth());
    const cfg = await getConfig();
    setBackend(cfg);
  }

  useEffect(() => {
    refresh();
    probe().then(setModel);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const id = setInterval(() => flush().then(refresh), 20000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      clearInterval(id);
    };
  }, []);

  async function syncNow() {
    setBusy("Syncing");
    const res = await flush();
    await refresh();
    setBusy("");
    return res;
  }

  const selected = shipments.find((s) => s.id === selectedId) ?? shipments[0] ?? null;

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>CargoLinx</h1>
          <div className="sub">Offline freight desk · East African corridors</div>
        </div>
        <Badges online={online} queue={queue} backend={backend.mode === "supabase" ? "Supabase" : "Local demo server"} model={model} />
      </header>

      <nav className="tabs" role="tablist">
        {[
          ["new", "New shipment"],
          ["quote", "Quote"],
          ["track", "Tracking & POD"],
          ["settings", "Setup"],
        ].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>

      <main>
        {tab === "new" && <NewShipment onCreated={async (s) => { await refresh(); setSelectedId(s.id); setTab("quote"); }} model={model} />}
        {tab === "quote" && <QuoteView shipment={selected} shipments={shipments} onPick={setSelectedId} onChange={refresh} model={model} />}
        {tab === "track" && <TrackView shipment={selected} shipments={shipments} onPick={setSelectedId} onChange={refresh} />}
        {tab === "settings" && <Settings backend={backend} model={model} onChanged={async () => { await refresh(); probe().then(setModel); }} queue={queue} onSync={syncNow} busy={busy} />}
      </main>

      <footer>
        Figures are computed by the local engine from dated statutory rates; model output explains, never prices.
        {model.live ? "" : " Model-assisted steps are disabled until a Meta key is configured."}
      </footer>
    </div>
  );
}

function NewShipment({ onCreated, model }) {
  const [form, setForm] = useState({
    lane: "Nairobi - Kampala",
    origin: "Nairobi",
    destination: "Kampala",
    cargo: "",
    qty: 1,
    weightKg: "",
    goods: "",
    freight: "",
    duty: 0.25,
    clearing: "",
    transport: "",
    lastMile: "",
  });
  const [photoId, setPhotoId] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [read, setRead] = useState(null);
  const [note, setNote] = useState("");
  const [transcript, setTranscript] = useState("");
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function pickPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const id = await savePhoto(file, { kind: "cargo-intake" });
    setPhotoId(id);
    setPhotoUrl(URL.createObjectURL(file));
    setRead(null);
  }

  async function readPhoto() {
    setErr("");
    if (!photoUrl) return setErr("Attach a photograph first.");
    try {
      const out = await readCargoPhoto(photoUrl, `${form.cargo} ${form.origin} to ${form.destination}`);
      setRead(out);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function transcribe() {
    setErr("");
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return setErr("This browser cannot record audio. Type the note instead — the quote does not depend on it.");
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        try {
          const out = await transcribeVoice(blob);
          setTranscript(out.text);
          if (!note) setNote(out.text);
        } catch (e) {
          setErr(e.message);
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e) {
      setErr(`Microphone unavailable: ${e.message}`);
    }
  }

  async function structureNote() {
    setErr("");
    try {
      const { structureJob } = await import("./lib/meta.js");
      const out = await structureJob(note);
      setForm((f) => ({
        ...f,
        cargo: out.cargo ?? f.cargo,
        qty: out.quantity ?? f.qty,
        weightKg: out.weightKg ?? f.weightKg,
        origin: out.origin ?? f.origin,
        destination: out.destination ?? f.destination,
      }));
    } catch (e) {
      setErr(e.message);
    }
  }

  async function create() {
    setErr("");
    if (!form.goods || !form.freight) return setErr("Goods value and freight are needed before a cost can be computed.");
    setSaving(true);
    try {
      const id = newId("shp");
      const ref = `CLX-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 900 + 100)}`;
      const segments = (LANES[form.lane] ?? LANES["Nairobi - Kampala"]).map((s) => ({
        ...s,
        source: "planner default — replace with the operator's own run data",
      }));
      const etaPlan = planEta({ segments, departAt: new Date().toISOString(), customsHours: 6 });
      const shipment = {
        id,
        ref,
        lane: form.lane,
        origin: form.origin,
        destination: form.destination,
        cargo: form.cargo || "Unspecified cargo",
        qty: num(form.qty) || 1,
        weightKg: num(form.weightKg),
        value: { goods: num(form.goods), freight: num(form.freight) },
        dutyRate: num(form.duty),
        services: { clearing: num(form.clearing), transport: num(form.transport), lastMile: num(form.lastMile) },
        marginPct: 0.3,
        photoId,
        cargoRead: read,
        note,
        transcript,
        etaPlan,
        status: "quoted",
        events: [{ type: "created", at: new Date().toISOString(), note: "Shipment created on device" }],
        createdAt: new Date().toISOString(),
      };
      await saveShipment(shipment);
      await flush();
      await onCreated(shipment);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <h2>New shipment</h2>
      <div className="grid">
        <label className="field">
          Lane
          <select value={form.lane} onChange={(e) => setForm({ ...form, lane: e.target.value })}>
            {Object.keys(LANES).map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Origin
          <input value={form.origin} onChange={set("origin")} />
        </label>
        <label className="field">
          Destination
          <input value={form.destination} onChange={set("destination")} />
        </label>
        <label className="field">
          Cargo
          <input value={form.cargo} onChange={set("cargo")} placeholder="e.g. 20 ft container, solar panels" />
        </label>
        <label className="field">
          Quantity
          <input type="number" min="1" value={form.qty} onChange={set("qty")} />
        </label>
        <label className="field">
          Weight (kg)
          <input type="number" min="0" value={form.weightKg} onChange={set("weightKg")} />
        </label>
      </div>

      <h3>Costs (KES)</h3>
      <div className="grid">
        <label className="field">
          Goods value (CIF base)
          <input type="number" min="0" value={form.goods} onChange={set("goods")} placeholder="1200000" />
        </label>
        <label className="field">
          International freight
          <input type="number" min="0" value={form.freight} onChange={set("freight")} placeholder="250000" />
        </label>
        <label className="field">
          Import duty band
          <select value={form.duty} onChange={set("duty")}>
            {DUTY_BANDS.map((b) => (
              <option key={b.v} value={b.v}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Clearing
          <input type="number" min="0" value={form.clearing} onChange={set("clearing")} />
        </label>
        <label className="field">
          Inland transport
          <input type="number" min="0" value={form.transport} onChange={set("transport")} />
        </label>
        <label className="field">
          Last mile
          <input type="number" min="0" value={form.lastMile} onChange={set("lastMile")} />
        </label>
      </div>

      <h3>Intake — photograph and note</h3>
      <div className="row">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={pickPhoto} style={{ maxWidth: 260 }} />
        <button className="ghost" onClick={readPhoto} disabled={!photoUrl}>
          Count cargo from photo
        </button>
        {photoUrl && <img className="thumb" src={photoUrl} alt="Cargo intake" />}
      </div>
      {read && (
        <div className="hint" style={{ marginTop: 8 }}>
          <strong>Cargo read:</strong> {read.totalCount ?? "—"} items
          {read.items?.length ? ` (${read.items.map((i) => `${i.count} × ${i.label}`).join(", ")})` : ""}
          {read.notes ? ` — ${read.notes}` : ""}
        </div>
      )}

      <div className="grid" style={{ marginTop: 10 }}>
        <label className="field" style={{ gridColumn: "1 / -1" }}>
          Desk note (driver or clerk)
          <textarea rows="3" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Collect 12 pallets of solar panels at ICDN, deliver Kampala warehouse by Friday." />
        </label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="ghost" onClick={structureNote} disabled={!note}>
          Read the note into fields
        </button>
        <button className="ghost" onClick={transcribe}>
          {recording ? "Stop and transcribe" : "Record voice note"}
        </button>
        {transcript && <span className="hint">{transcript}</span>}
      </div>

      {err && <div className="notice bad" style={{ marginTop: 10 }}>{err}</div>}
      {!model.live && (
        <div className="notice" style={{ marginTop: 10 }}>
          Model-assisted intake is off — no Meta key is configured on this device. You can still create the shipment and get a full landed cost and ETA.
        </div>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        <button className="primary" onClick={create} disabled={saving}>
          {saving ? "Computing…" : "Compute landed cost and quote"}
        </button>
        <span className="hint">Saved on this device first; it syncs when a link is available.</span>
      </div>
    </section>
  );
}

function QuoteView({ shipment, shipments, onPick, onChange, model }) {
  const [explanation, setExplanation] = useState("");
  const [err, setErr] = useState("");

  if (!shipment) return <section className="card"><h2>Quote</h2><p className="hint">Create a shipment first.</p></section>;
  if (!shipment.value) return <section className="card"><h2>Quote</h2><p className="hint">This record has no cost data yet — pick another shipment.</p></section>;

  const lc = useMemo(
    () =>
      landedCost({
        goods: shipment.value.goods,
        freight: shipment.value.freight,
        dutyRate: shipment.dutyRate,
        clearing: shipment.services.clearing,
        transport: shipment.services.transport,
        lastMile: shipment.services.lastMile,
        quantity: shipment.qty,
      }),
    [shipment]
  );
  const floor = floorPrice(lc);
  const margin = shipment.marginPct ?? 0.3;
  let q = null;
  let quoteError = "";
  try {
    q = quote(lc, { marginPct: margin });
  } catch (e) {
    quoteError = e.message;
  }

  async function setMargin(m) {
    await saveShipment({ ...shipment, marginPct: m });
    await flush();
    onChange();
  }

  async function explain() {
    setErr("");
    try {
      const out = await explainQuote(
        {
          landedCostExVat: lc.totals.netCostExVat,
          statutory: lc.totals.statutory,
          cif: lc.totals.cif,
          price: q.price,
          marginPct: margin,
          dutyRate: shipment.dutyRate,
        },
        `${shipment.cargo}, ${shipment.origin} to ${shipment.destination}`
      );
      setExplanation(out.text);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <>
      <section className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>{shipment.ref} · {shipment.cargo}</h2>
          <span className="pill ok">{shipment.status}</span>
          <select style={{ maxWidth: 260, marginLeft: "auto" }} value={shipment.id} onChange={(e) => onPick(e.target.value)}>
            {shipments.map((s) => (
              <option key={s.id} value={s.id}>{s.ref}</option>
            ))}
          </select>
        </div>
        <div className="kpi" style={{ marginTop: 12 }}>
          <div><span>Landed cost excl. VAT</span><strong><Money value={lc.totals.netCostExVat} ccy={lc.currency} /></strong></div>
          <div><span>Statutory</span><strong><Money value={lc.totals.statutory} ccy={lc.currency} /></strong></div>
          <div><span>Cost per unit</span><strong><Money value={lc.totals.perUnit} ccy={lc.currency} /></strong></div>
          <div><span>Floor price (15%)</span><strong><Money value={floor.floorPrice} ccy={lc.currency} /></strong></div>
        </div>
      </section>

      <section className="card">
        <h2>Itemised landed cost</h2>
        <table className="lines">
          <thead>
            <tr><th>Line</th><th className="num">Base</th><th className="num">Rate</th><th className="num">Amount</th></tr>
          </thead>
          <tbody>
            {lc.lines.filter((l) => l.amount !== 0).map((l) => (
              <tr key={l.code}>
                <td>{l.label}</td>
                <td className="num">{l.base ? money(l.base, "") : "—"}</td>
                <td className="num">{l.rate ? `${(l.rate * 100).toFixed(2)}%` : "—"}</td>
                <td className="num">{money(l.amount, "")}</td>
              </tr>
            ))}
            <tr className="total"><td colSpan="3">Landed cost incl. VAT</td><td className="num">{money(lc.totals.total, "")}</td></tr>
          </tbody>
        </table>
        <p className="hint" style={{ marginTop: 10 }}>
          Rates: IDF {(KE_RATES.levies.idf * 100).toFixed(1)}%, RDL {(KE_RATES.levies.rdl * 100).toFixed(1)}%, VAT {(KE_RATES.vat.standard * 100).toFixed(0)}%, EAC CET bands 0/10/25/35.
          Verified {KE_RATES.verifiedOn} against {KE_RATES.sources[0].split(":")[0]}. VAT base composition is a modelling choice — confirm against a live KRA assessment before issuing.
        </p>
      </section>

      <section className="card">
        <h2>Quote</h2>
        {quoteError && <div className="notice bad">{quoteError}</div>}
        {q && (
          <>
            <div className="kpi">
              <div><span>Margin</span><strong>{(margin * 100).toFixed(1)}%</strong></div>
              <div><span>Price excl. VAT</span><strong><Money value={q.price} ccy={lc.currency} /></strong></div>
              <div><span>Price incl. VAT</span><strong><Money value={q.priceIncVat} ccy={lc.currency} /></strong></div>
              <div><span>Gross profit</span><strong><Money value={q.grossProfit} ccy={lc.currency} /></strong></div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <label className="field" style={{ flex: 1, minWidth: 240 }}>
                Margin (floor 15%, policy band 30–40%)
                <input type="range" min="15" max="40" step="1" value={Math.round(margin * 100)} onChange={(e) => setMargin(Number(e.target.value) / 100)} />
              </label>
              <span className={`pill ${q.withinPolicyBand ? "ok" : "warn"}`}>{q.withinPolicyBand ? "Inside policy band" : "Outside policy band"}</span>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="ghost" onClick={explain} disabled={!model.live}>Explain this quote</button>
              {!model.live && <span className="hint">Needs a Meta key. The figures above do not.</span>}
            </div>
            {explanation && <p className="hint" style={{ marginTop: 8 }}>{explanation}</p>}
            {err && <div className="notice bad" style={{ marginTop: 8 }}>{err}</div>}
          </>
        )}
      </section>

      <section className="card">
        <h2>Documents</h2>
        <p className="hint">
          The quote document is generated from these figures — same numbers, printable, no re-typing.
        </p>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="ghost" onClick={() => printQuote(shipment, lc, q)} disabled={!q}>
            Open printable quote
          </button>
        </div>
      </section>
    </>
  );
}

function printQuote(shipment, lc, q) {
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(quoteHtml({ shipment, lc, q }));
  w.document.close();
  w.focus();
}

function TrackView({ shipment, shipments, onPick, onChange }) {
  const [kind, setKind] = useState("delay");
  const [delay, setDelay] = useState(6);
  const [podName, setPodName] = useState("");
  const [msg, setMsg] = useState("");

  if (!shipment) return <section className="card"><h2>Tracking</h2><p className="hint">Create a shipment first.</p></section>;

  const plan = shipment.etaPlan;

  async function addEvent() {
    setMsg("");
    try {
      let next;
      if (kind === "delivered") {
        next = applyEvent(plan, { type: "delivered", at: new Date().toISOString(), note: `POD signed by ${podName || "consignee"}` });
        next.pod = { signedBy: podName || "consignee", at: new Date().toISOString() };
      } else {
        next = applyEvent(plan, { type: kind, delayHours: Number(delay), note: kind === "border-queue" ? "Border queue at Malaba" : "Delay reported by driver" });
      }
      const status = kind === "delivered" ? "delivered" : "in transit";
      const events = [...(shipment.events ?? []), { type: kind, at: new Date().toISOString(), note: kind === "delivered" ? `POD signed by ${podName || "consignee"}` : `${delay}h — ${kind}` }];
      await saveShipment({ ...shipment, etaPlan: next, status, events });
      await flush();
      setMsg("Recorded on this device. It will sync when a link is available.");
      onChange();
    } catch (e) {
      setMsg(e.message);
    }
  }

  const hoursLeft = plan ? Math.max(0, (new Date(plan.eta) - Date.now()) / 3600000) : 0;

  return (
    <>
      <section className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>{shipment.ref} · {shipment.origin} → {shipment.destination}</h2>
          <span className={`pill ${shipment.status === "delivered" ? "ok" : "warn"}`}>{shipment.status}</span>
          <select style={{ maxWidth: 240, marginLeft: "auto" }} value={shipment.id} onChange={(e) => onPick(e.target.value)}>
            {shipments.map((s) => (
              <option key={s.id} value={s.id}>{s.ref}</option>
            ))}
          </select>
        </div>
        <div className="kpi" style={{ marginTop: 12 }}>
          <div><span>ETA</span><strong>{plan ? new Date(plan.eta).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—"}</strong></div>
          <div><span>Hours remaining</span><strong>{hoursLeft.toFixed(1)}</strong></div>
          <div><span>Confidence</span><strong>{plan ? `${Math.round(plan.confidence * 100)}%` : "—"}</strong></div>
          <div><span>Changes</span><strong>{plan?.changes?.length ?? 0}</strong></div>
        </div>
      </section>

      <section className="card">
        <h2>Why this ETA</h2>
        <table className="lines">
          <thead><tr><th>Leg</th><th className="num">km</th><th className="num">Speed</th><th className="num">Drive h</th><th>Source</th></tr></thead>
          <tbody>
            {plan?.basis?.legs?.map((l) => (
              <tr key={l.name}>
                <td>{l.name}{l.border ? " (border)" : ""}</td>
                <td className="num">{l.km}</td>
                <td className="num">{l.speedKph} kph</td>
                <td className="num">{l.driveHours}</td>
                <td className="hint">{l.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint" style={{ marginTop: 8 }}>
          Drive {plan?.basis?.driveHours} h · dwell {plan?.basis?.dwellHours} h · customs {plan?.basis?.customsHours} h · buffer {(plan?.basis?.bufferPct * 100).toFixed(0)}%
          ({plan?.basis?.bufferHours} h). Every figure above is an assumption you can challenge — that is the point of printing it.
        </p>
      </section>

      <section className="card">
        <h2>Record an event</h2>
        <div className="grid">
          <label className="field">
            Event
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="delay">Delay</option>
              <option value="border-queue">Border queue</option>
              <option value="delivered">Delivered (POD)</option>
            </select>
          </label>
          {kind === "delivered" ? (
            <label className="field">
              POD signed by
              <input value={podName} onChange={(e) => setPodName(e.target.value)} placeholder="Name of consignee" />
            </label>
          ) : (
            <label className="field">
              Hours
              <input type="number" min="1" value={delay} onChange={(e) => setDelay(e.target.value)} />
            </label>
          )}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" onClick={addEvent}>Save event</button>
          {msg && <span className="hint">{msg}</span>}
        </div>
      </section>

      <section className="card">
        <h2>History</h2>
        <ul className="timeline">
          {(plan?.changes ?? []).slice().reverse().map((c, i) => (
            <li key={i}>
              <strong>{c.type}</strong> — {c.note || "no note"} · {c.delayHours ? `+${c.delayHours} h` : ""}
              <div className="when">{new Date(c.at).toLocaleString("en-GB")} · was {new Date(c.previousEta).toLocaleString("en-GB")} → now {new Date(c.newEta).toLocaleString("en-GB")}</div>
            </li>
          ))}
          {(shipment.events ?? []).map((e, i) => (
            <li key={`e${i}`}>
              {e.type} <div className="when">{new Date(e.at).toLocaleString("en-GB")} · {e.note}</div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Settings({ backend, model, onChanged, queue, onSync, busy }) {
  const [be, setBe] = useState({ ...backend });
  const [md, setMd] = useState({ baseUrl: "", apiKey: "" });
  const [msg, setMsg] = useState("");

  useEffect(() => {
    getModelConfig().then((c) => setMd({ baseUrl: c.baseUrl ?? "", apiKey: c.apiKey ?? "" }));
  }, []);

  async function saveBackend() {
    await setConfig(be);
    setMsg(`Backend set to ${be.mode === "supabase" ? "Supabase" : "local demo server"}.`);
    onChanged();
  }
  async function saveModel() {
    await setModelConfig({ baseUrl: md.baseUrl.trim(), apiKey: md.apiKey.trim() });
    setMd({ ...md, apiKey: "" });
    setMsg("Model settings saved on this device. The key is not shown again.");
    onChanged();
  }
  async function doSync() {
    const res = await onSync();
    setMsg(`Sync: ${res.reason} · pushed ${res.pushed ?? 0}, pulled ${res.pulled ?? 0}`);
  }

  return (
    <>
      <section className="card">
        <h2>Sync</h2>
        <div className="row">
          <button className="primary" onClick={doSync} disabled={busy}>{busy || "Sync now"}</button>
          <span className="hint">{queue} write(s) waiting.</span>
        </div>
        <div className="grid" style={{ marginTop: 12 }}>
          <label className="field">
            Backend
            <select value={be.mode} onChange={(e) => setBe({ ...be, mode: e.target.value })}>
              <option value="loopback">Local demo server (on this device)</option>
              <option value="supabase">Supabase</option>
            </select>
          </label>
          {be.mode === "supabase" && (
            <>
              <label className="field">Project URL<input value={be.url ?? ""} onChange={(e) => setBe({ ...be, url: e.target.value })} placeholder="https://project.supabase.co" /></label>
              <label className="field">Anon key<input value={be.key ?? ""} onChange={(e) => setBe({ ...be, key: e.target.value })} placeholder="public anon key" /></label>
              <label className="field">Table<input value={be.table ?? "shipments"} onChange={(e) => setBe({ ...be, table: e.target.value })} /></label>
            </>
          )}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="ghost" onClick={saveBackend}>Save backend</button>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          The local demo server exists so the offline-and-reconnect behaviour can be shown without credentials. When a Supabase project is configured with a table that accepts these records, the same queue drains to it unchanged.
        </p>
      </section>

      <section className="card">
        <h2>Meta models</h2>
        <div className="grid">
          <label className="field">Endpoint base<input value={md.baseUrl} onChange={(e) => setMd({ ...md, baseUrl: e.target.value })} placeholder="https://api.meta.ai/v1" /></label>
          <label className="field">Key<input type="password" value={md.apiKey} onChange={(e) => setMd({ ...md, apiKey: e.target.value })} placeholder={model.live ? "configured" : "not configured"} /></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="ghost" onClick={saveModel}>Save model settings</button>
          <span className={`pill ${model.live ? "ok" : "warn"}`}>{model.live ? "live" : model.reason}</span>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Four jobs: read a cargo photo, transcribe a voice note, match a lane, explain a quote. None of them sets a price or a date. The key stays on this device.
        </p>
        {msg && <div className="notice" style={{ marginTop: 10 }}>{msg}</div>}
      </section>
    </>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { landedCost, quote, floorPrice, KE_RATES } from "../engine/landed.mjs";
import { planEta, applyEvent } from "../engine/eta.mjs";
import { STORES, all, put, saveShipment, saveOrder, savePhoto, getPhoto, newId, kvGet, kvSet } from "./lib/db.js";
import { flush, queueDepth, getConfig, setConfig } from "./lib/sync.js";
import { probe, readCargoPhoto, transcribeVoice, explainQuote, getModelConfig, setModelConfig } from "./lib/meta.js";
import { quoteHtml } from "./lib/quote-doc.mjs";
import { dutyTreatment, pvocFee, pvocApplicable, resolveHS, waiverAdjustment, EAC_MEMBERS, WAIVER_TYPES, FX } from "../engine/tariff.mjs";
import { buildDossier, dossierStatus, setDocStatus } from "../engine/docs.mjs";
import { country, integrationState, expressReadiness, COUNTRY_EXTRAS } from "../engine/countries.mjs";
import { createAccount, createUser, can, assertCan, scoped, documentHeader, creditDecision, ROLES } from "../engine/accounts.mjs";
import { createOrder, advance, nextStage, blockersFor, receiveGoods, dispatch as dispatchOrder, deliver as deliverOrder, slaState, STAGES as ORDER_STAGES, ORDER_TYPES } from "../engine/orders.mjs";
import { config as loconavConfig, probe as loconavProbe, parseWebhook, trackingState, LOCONAV } from "../engine/loconav.mjs";

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
  const [user, setUser] = useState(null);
  const [accounts, setAccounts] = useState([]);

  async function refresh() {
    setShipments(((await all(STORES.shipments)) ?? []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
    setQueue(await queueDepth());
    const cfg = await getConfig();
    setBackend(cfg);
  }

  useEffect(() => {
    refresh();
    kvGet("session").then(setUser);
    kvGet("accounts", []).then(setAccounts);
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
          ["compliance", "Compliance"],
          ["orders", "Orders"],
          ["accounts", "Accounts"],
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
        {tab === "compliance" && <ComplianceView shipment={selected} shipments={shipments} onPick={setSelectedId} onChange={refresh} />}
        {tab === "orders" && <OrdersView user={user} accounts={accounts} />}
        {tab === "accounts" && <AccountsView user={user} accounts={accounts} setAccounts={setAccounts} setUser={setUser} />}
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
    hs: "1006.30",
    originCountry: "CN",
    eacCoO: false,
    waiver: "none",
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
      const dt = dutyTreatment({ hs: form.hs, originCountry: form.originCountry, hasEacCertificateOfOrigin: form.eacCoO });
      if (!dt.resolved) {
        setSaving(false);
        return setErr(dt.reason);
      }
      const eacOrigin = Boolean(EAC_MEMBERS[String(form.originCountry).toUpperCase()]);
      const pvReq = pvocApplicable({ item: dt.item, originCountry: form.originCountry, hasEacCertificateOfOrigin: form.eacCoO });
      const pv = pvReq.required ? pvocFee({ fobUsd: num(form.goods) / FX.USD_KES }) : null;
      const waiver = waiverAdjustment({ type: form.waiver });
      const dossier = buildDossier(
        { hs: form.hs, originCountry: form.originCountry, destinationCountry: "KE" },
        { pvocRequired: pvReq.required, eacOrigin: eacOrigin && form.eacCoO }
      );
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
        dutyRate: waiver.valid ? 0 : dt.dutyRate,
        hs: form.hs,
        originCountry: form.originCountry,
        eacCoO: form.eacCoO,
        dutyTreatment: dt,
        pvoc: pv,
        waiver,
        dossier,
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
          HS code
          <input value={form.hs} onChange={set("hs")} placeholder="1006.30" />
        </label>
        <label className="field">
          Country of origin
          <select value={form.originCountry} onChange={set("originCountry")}>
            {["CN", "IN", "AE", "JP", "US", "ZA", "TR", "GB", ...Object.keys(EAC_MEMBERS)].map((c) => (
              <option key={c} value={c}>{c}{EAC_MEMBERS[c] ? ` — ${EAC_MEMBERS[c]}` : ""}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Waiver / exemption
          <select value={form.waiver} onChange={set("waiver")}>
            {Object.entries(WAIVER_TYPES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ justifyContent: "flex-end" }}>
          <span>EAC certificate of origin held</span>
          <input type="checkbox" checked={form.eacCoO} onChange={(e) => setForm({ ...form, eacCoO: e.target.checked })} style={{ width: 22, height: 22 }} />
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
        other: shipment.pvoc?.kes ?? 0,
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

function ComplianceView({ shipment, shipments, onPick, onChange }) {
  const [msg, setMsg] = useState("");
  if (!shipment) return <section className="card"><h2>Compliance</h2><p className="hint">Create a shipment first.</p></section>;

  const hsInfo = resolveHS(shipment.hs);
  const dossier = shipment.dossier ?? [];
  const status = dossierStatus(dossier);
  const dt = shipment.dutyTreatment ?? dutyTreatment({ hs: shipment.hs, originCountry: shipment.originCountry, hasEacCertificateOfOrigin: shipment.eacCoO });
  const pvocAttached = dossier.some((d) => d.code === "pvoc_certificate" && d.status === "verified");
  const express = expressReadiness({ dossier, dutyTreatment: dt, pvoc: { required: Boolean(shipment.pvoc), certificateAttached: pvocAttached } });
  const sys = integrationState("KE");

  async function mark(code, next) {
    setMsg("");
    try {
      const updated = setDocStatus(dossier, code, next);
      await saveShipment({ ...shipment, dossier: updated });
      await flush();
      onChange();
    } catch (e) {
      setMsg(e.message);
    }
  }

  return (
    <>
      <section className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>Compliance · {shipment.ref}</h2>
          <span className={`pill ${express.lane === "green" ? "ok" : express.lane === "yellow" ? "warn" : "bad"}`}>{express.lane} lane · {express.score}/100</span>
          <select style={{ maxWidth: 240, marginLeft: "auto" }} value={shipment.id} onChange={(e) => onPick(e.target.value)}>
            {shipments.map((s) => (<option key={s.id} value={s.id}>{s.ref}</option>))}
          </select>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>{express.meaning}</p>
        <ul className="hint" style={{ marginTop: 6 }}>
          {express.reasons.map((r, i) => (<li key={i}>{r}</li>))}
        </ul>
      </section>

      <section className="card">
        <h2>Classification and duty</h2>
        <div className="kpi">
          <div><span>HS code</span><strong>{shipment.hs ?? "—"}</strong></div>
          <div><span>Description</span><strong style={{ fontSize: 14 }}>{hsInfo?.label ?? "unresolved"}</strong></div>
          <div><span>CET band</span><strong>{hsInfo?.band === null || hsInfo?.band === undefined ? "—" : `${(hsInfo.band * 100).toFixed(0)}%`}</strong></div>
          <div><span>Rate applied</span><strong>{(shipment.dutyRate * 100).toFixed(0)}%</strong></div>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Origin {shipment.originCountry} · {dt.reason}
          {hsInfo?.source ? ` · ${hsInfo.source}` : ""}
        </p>
        {dt.preferential && <div className="notice" style={{ marginTop: 8 }}>{dt.preferential}</div>}
        {shipment.waiver && shipment.waiver.type !== "none" && (
          <div className={`notice ${shipment.waiver.valid ? "" : "bad"}`} style={{ marginTop: 8 }}>
            Waiver: {WAIVER_TYPES[shipment.waiver.type].label} · {shipment.waiver.note}
            {shipment.waiver.requires.length ? ` · Evidence: ${shipment.waiver.requires.join(", ")}` : ""}
          </div>
        )}
      </section>

      {shipment.pvoc && (
        <section className="card">
          <h2>Conformity (PVoC)</h2>
          <div className="kpi">
            <div><span>Route</span><strong>{shipment.pvoc.route}</strong></div>
            <div><span>On FOB (USD)</span><strong>${shipment.pvoc.fobUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}</strong></div>
            <div><span>Fee</span><strong>${shipment.pvoc.usd.toLocaleString("en-US")}</strong></div>
            <div><span>Fee (KES)</span><strong>{money(shipment.pvoc.kes, "")}</strong></div>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            {(shipment.pvoc.pct * 100).toFixed(2)}% of FOB, floor USD 265, cap USD 2,700{shipment.pvoc.capped ? ` — ${shipment.pvoc.capped} applied` : ""}.
            Rate at {shipment.pvoc.fx.toFixed(2)} KES/USD ({FX.asOf}). Source: {shipment.pvoc.source}.
          </p>
        </section>
      )}

      <section className="card">
        <h2>Document file · {status.verified}/{status.total} verified</h2>
        <p className="hint">{status.readyToLodge ? "Ready to lodge." : `Next: ${status.nextAction}`}</p>
        <table className="lines">
          <thead><tr><th>Document</th><th>Issuer</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {dossier.map((d) => (
              <tr key={d.code}>
                <td>{d.label}{d.mandatory ? "" : " (if required)"}</td>
                <td className="hint">{d.issuer}</td>
                <td><span className={`pill ${d.status === "verified" ? "ok" : d.status === "attached" ? "warn" : "bad"}`}>{d.status}</span></td>
                <td>
                  {d.status === "missing" && <button className="ghost" onClick={() => mark(d.code, "attached")}>Attach</button>}
                  {d.status === "attached" && <button className="ghost" onClick={() => mark(d.code, "verified")}>Verify</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {msg && <div className="notice bad" style={{ marginTop: 8 }}>{msg}</div>}
      </section>

      <section className="card">
        <h2>Clearance systems</h2>
        <p className="hint">
          Kenya · customs {sys.customs} · tax {country("KE").tax} · single window {sys.singleWindow}.
          The desk prepares and pre-validates; lodging is done by a licensed agent. {sys.canFile ? "" : "No direct filing is claimed."}
        </p>
        <p className="hint" style={{ marginTop: 6 }}>
          Regional partners in the file: {COUNTRY_EXTRAS.KE.length ? "KE standards permit required" : "no extras"} · Uganda, Tanzania, Rwanda, Burundi, South Sudan and DR Congo each carry their own systems and are marked "to confirm" until we verify access with the revenue authority.
        </p>
      </section>
    </>
  );
}

function AccountsView({ user, accounts, setAccounts, setUser }) {
  const [form, setForm] = useState({ name: "", country: "KE", terms: "prepayment", credit: "" });
  const [invite, setInvite] = useState({ name: "", email: "", role: "client_admin" });
  const [msg, setMsg] = useState("");

  async function addAccount(e) {
    e.preventDefault();
    setMsg("");
    try {
      const acc = createAccount({ name: form.name, country: form.country, terms: form.terms, creditLimitKes: Number(form.credit || 0) });
      const next = [...accounts, { ...acc, users: [] }];
      setAccounts(next);
      await kvSet("accounts", next);
      setForm({ name: "", country: "KE", terms: "prepayment", credit: "" });
      setMsg(`${acc.name} opened an account. ${acc.terms === "prepayment" ? "Funds required before dispatch." : `Credit limit ${money(acc.creditLimitKes)}.`}`);
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function addUser(accountId) {
    setMsg("");
    try {
      const u = createUser({ accountId, name: invite.name, email: invite.email, role: invite.role });
      const next = accounts.map((a) => (a.id === accountId ? { ...a, users: [...(a.users ?? []), u] } : a));
      setAccounts(next);
      await kvSet("accounts", next);
      setInvite({ name: "", email: "", role: "client_admin" });
      setMsg(`Invitation created for ${u.email}.`);
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function signIn(u) {
    await kvSet("session", u);
    setUser(u);
    setMsg(`Signed in as ${u.name || u.email} (${ROLES[u.role].label}).`);
  }

  async function signOut() {
    await kvSet("session", null);
    setUser(null);
  }

  return (
    <>
      <section className="card">
        <h2>Open an account</h2>
        <p className="hint">
          Accounts trade with {documentHeader("quotation").name}; the platform ({(documentHeader("tracking").name)}) matches freight and tracks the last mile.
        </p>
        <form onSubmit={addAccount}>
          <div className="grid" style={{ marginTop: 10 }}>
            <label className="field">Company name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ndumbuki Enterprises" /></label>
            <label className="field">Country
              <select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}>
                {Object.keys(EAC_MEMBERS).map((c) => (<option key={c}>{c}</option>))}
              </select>
            </label>
            <label className="field">Terms
              <select value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })}>
                <option value="prepayment">Prepayment</option>
                <option value="net15">Net 15</option>
                <option value="net30">Net 30</option>
              </select>
            </label>
            <label className="field">Credit limit (KES)<input type="number" min="0" value={form.credit} onChange={(e) => setForm({ ...form, credit: e.target.value })} placeholder="0" /></label>
          </div>
          <div className="row" style={{ marginTop: 10 }}><button className="primary" type="submit">Open account</button></div>
        </form>
        {msg && <div className="notice" style={{ marginTop: 10 }}>{msg}</div>}
      </section>

      <section className="card">
        <h2>Accounts and users</h2>
        {accounts.length === 0 && <p className="hint">No accounts yet.</p>}
        {accounts.map((a) => (
          <div key={a.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10 }}>
            <div className="row">
              <strong>{a.name}</strong>
              <span className="pill ok">{a.terms}</span>
              <span className="hint">{a.country} · credit {money(a.creditLimitKes)}</span>
            </div>
            <ul className="hint" style={{ marginTop: 6 }}>
              {(a.users ?? []).map((u) => (
                <li key={u.id}>
                  {u.name || u.email} · {ROLES[u.role].label} · {u.status}{" "}
                  <button className="ghost" onClick={() => signIn(u)} style={{ padding: "2px 8px", fontSize: 12 }}>Sign in as</button>
                </li>
              ))}
            </ul>
            <div className="row" style={{ marginTop: 6 }}>
              <input placeholder="Name" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} style={{ maxWidth: 160 }} />
              <input placeholder="email@company.co.ke" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} style={{ maxWidth: 220 }} />
              <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })} style={{ maxWidth: 190 }}>
                {Object.entries(ROLES).map(([k, v]) => (<option key={k} value={k}>{v.label}</option>))}
              </select>
              <button className="ghost" onClick={() => addUser(a.id)}>Invite user</button>
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Session</h2>
        {user ? (
          <div className="row">
            <span className="pill ok">{ROLES[user.role].label}</span>
            <span className="hint">{user.name || user.email} · account {accounts.find((a) => a.id === user.accountId)?.name ?? user.accountId}</span>
            <button className="ghost" onClick={signOut}>Sign out</button>
          </div>
        ) : (
          <p className="hint">Signed out. Pick a user above to sign in. Sessions are local to this device until the backend is connected.</p>
        )}
      </section>
    </>
  );
}

function OrdersView({ user, accounts }) {
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState({ type: "import", description: "", qty: 1, unitValue: "", promisedAt: "" });
  const [stageData, setStageData] = useState({});
  const [msg, setMsg] = useState("");
  const [lonToken, setLonToken] = useState("");
  const [lonRegion, setLonRegion] = useState("global");
  const [lonState, setLonState] = useState({ configured: false, detail: "not checked" });
  const [hook, setHook] = useState("");
  const [fix, setFix] = useState(null);

  const load = async () => {
    const allOrders = (await all(STORES.orders)) ?? [];
    setOrders(allOrders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  };
  useEffect(() => { load(); loconavProbe(loconavConfig({ region: lonRegion })).then(setLonState); }, []);

  if (!user) return <section className="card"><h2>Orders</h2><p className="hint">Sign in on the Accounts tab to place or manage orders.</p></section>;

  const mine = scoped(orders, user);
  const order = selected ? mine.find((o) => o.id === selected) : mine[0] ?? null;
  const account = accounts.find((a) => a.id === user.accountId);

  async function placeOrder(e) {
    e.preventDefault();
    setMsg("");
    try {
      const lines = [{ description: draft.description, qty: Number(draft.qty), unitValue: Number(draft.unitValue) }];
      const o = createOrder({ accountId: user.accountId, type: draft.type, lines, promisedAt: draft.promisedAt || null });
      const decision = creditDecision({ account, orderValueKes: o.valueKes, outstandingKes: 0 });
      if (!decision.approved) return setMsg(`Order held: ${decision.reason}`);
      await saveOrder(o);
      await flush();
      await load();
      setSelected(o.id);
      setDraft({ type: "import", description: "", qty: 1, unitValue: "", promisedAt: "" });
      setMsg(`Order placed. ${decision.reason}`);
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function step(o, target) {
    setMsg("");
    try {
      let next = o;
      if (target === "received") {
        next = receiveGoods(o, { grnRef: stageData.grnRef, receipts: o.lines.map((l) => ({ description: l.description, qty: Number(stageData.receivedQty ?? l.qty) })) });
        next = advance(next, { ...stageData, stage: "received", note: `GRN ${stageData.grnRef}` });
      } else if (target === "dispatched") {
        const { order: dispatched, job } = dispatchOrder(o, { vehicleId: stageData.vehicleId, driverName: stageData.driverName, trackingRef: stageData.trackingRef });
        next = dispatched;
        setMsg(`Last-mile job created: ${job.id} · vehicle ${job.vehicleId}`);
      } else if (target === "delivered") {
        next = deliverOrder(o, { signedBy: stageData.signedBy });
      } else {
        next = advance(o, { ...stageData, stage: target });
      }
      await saveOrder(next);
      await flush();
      await load();
      setStageData({});
    } catch (err) {
      setMsg(err.message);
    }
  }

  const target = order ? nextStage(order) : null;
  const needs = order && target ? (blockersFor(order, target).missing ?? []) : [];
  const sla = order ? slaState(order) : null;

  async function saveToken() {
    await kvSet("loconav", { region: lonRegion, token: lonToken });
    const st = await loconavProbe(loconavConfig({ region: lonRegion, token: lonToken }));
    setLonState(st);
  }

  return (
    <>
      <section className="card">
        <h2>Place an order</h2>
        <form onSubmit={placeOrder}>
          <div className="grid">
            <label className="field">Type
              <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                {Object.entries(ORDER_TYPES).map(([k, v]) => (<option key={k} value={k}>{v.label}</option>))}
              </select>
            </label>
            <label className="field">Item<input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Solar panels 450W" /></label>
            <label className="field">Quantity<input type="number" min="1" value={draft.qty} onChange={(e) => setDraft({ ...draft, qty: e.target.value })} /></label>
            <label className="field">Unit value (KES)<input type="number" min="0" value={draft.unitValue} onChange={(e) => setDraft({ ...draft, unitValue: e.target.value })} /></label>
            <label className="field">Promised date<input type="date" value={draft.promisedAt} onChange={(e) => setDraft({ ...draft, promisedAt: e.target.value })} /></label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" type="submit" disabled={!can(user.role, "order.create")}>Place order</button>
            {!can(user.role, "order.create") && <span className="hint">This role cannot place orders.</span>}
          </div>
        </form>
        {msg && <div className="notice" style={{ marginTop: 10 }}>{msg}</div>}
      </section>

      <section className="card">
        <h2>Orders · {mine.length}</h2>
        {mine.length === 0 && <p className="hint">No orders yet.</p>}
        <table className="lines">
          <thead><tr><th>Reference</th><th>Type</th><th className="num">Value</th><th>Stage</th><th>Promise</th></tr></thead>
          <tbody>
            {mine.map((o) => (
              <tr key={o.id} onClick={() => setSelected(o.id)} style={{ cursor: "pointer" }}>
                <td>{o.id.slice(-6)}</td>
                <td>{ORDER_TYPES[o.type].label.split(" — ")[0]}</td>
                <td className="num">{money(o.valueKes, "")}</td>
                <td>{o.stage}</td>
                <td className="hint">{slaState(o).status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {order && (
        <section className="card">
          <h2>Order {order.id.slice(-6)} · {order.stage}</h2>
          <div className="kpi">
            <div><span>Value</span><strong>{money(order.valueKes)}</strong></div>
            <div><span>Promise</span><strong>{sla.promisedAt ? new Date(sla.promisedAt).toLocaleDateString("en-GB") : "none"}</strong></div>
            <div><span>SLA</span><strong className={sla.status.includes("late") ? "bad" : ""}>{sla.status}</strong></div>
            <div><span>Type</span><strong style={{ fontSize: 13 }}>{ORDER_TYPES[order.type].label}</strong></div>
          </div>

          <h3>Pipeline</h3>
          <ul className="timeline">
            {ORDER_STAGES.filter((s) => ORDER_TYPES[order.type].usesWarehouse || !s.warehouseOnly).map((s) => (
              <li key={s.key} style={{ borderLeftColor: order.stage === s.key ? "var(--gold)" : undefined }}>
                <strong>{s.label}</strong> {order.history?.filter((h) => h.stage === s.key).slice(-1).map((h) => <span className="when" key={h.at}> · {new Date(h.at).toLocaleString("en-GB")} {h.note}</span>)}
              </li>
            ))}
          </ul>

          {target && (
            <>
              <h3>Next step — {ORDER_STAGES.find((s) => s.key === target).label}</h3>
              <div className="grid">
                {needs.map((k) => (
                  <label className="field" key={k}>{k}
                    <input value={stageData[k] ?? ""} onChange={(e) => setStageData({ ...stageData, [k]: k === "purchaseValue" ? Number(e.target.value) : e.target.value })} />
                  </label>
                ))}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="primary" onClick={() => step(order, target)} disabled={!can(user.role, "order.advance")}>Advance to {target}</button>
                {needs.length > 0 && <span className="hint">Required: {needs.join(", ")}</span>}
              </div>
            </>
          )}
          {!target && <p className="hint">This order is delivered. The file is closed.</p>}
        </section>
      )}

      <section className="card">
        <h2>Last-mile tracking (LocoNav)</h2>
        <div className="grid">
          <label className="field">Region
            <select value={lonRegion} onChange={(e) => setLonRegion(e.target.value)}>
              {Object.keys(LOCONAV.hosts).map((r) => (<option key={r}>{r}</option>))}
            </select>
          </label>
          <label className="field">User token<input type="password" value={lonToken} onChange={(e) => setLonToken(e.target.value)} placeholder={lonState.configured ? "configured" : "issued by the LocoNav SPOC"} /></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="ghost" onClick={saveToken}>Save and probe</button>
          <span className={`pill ${lonState.configured && lonState.reachable ? "ok" : "warn"}`}>{lonState.configured ? (lonState.reachable ? "reachable" : "not reachable") : "not configured"}</span>
          <span className="hint">{lonState.detail}</span>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Position comes from the vehicle, never from the app. Until a token is in place the desk shows no location rather than a guess. Video telematics and live stream are listed in the adapter and are marked "confirm" with the SPOC.
        </p>
        <div className="grid" style={{ marginTop: 10 }}>
          <label className="field" style={{ gridColumn: "1 / -1" }}>Paste a GPS or alert webhook to test the mapping
            <textarea rows="3" value={hook} onChange={(e) => setHook(e.target.value)} placeholder='{"vehicleId":"KDG 123A","lat":-1.2921,"lng":36.8219,"speed":54,"timestamp":1793000000}' />
          </label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="ghost" onClick={() => setFix(parseWebhook(JSON.parse(hook || "{}")))}>Parse payload</button>
          {fix && <span className="hint">{JSON.stringify({ valid: fix.valid, vehicleId: fix.vehicleId, at: fix.at, ...trackingState({ lastFix: fix }) })}</span>}
        </div>
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

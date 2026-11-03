import React, { useEffect, useMemo, useRef, useState } from "react";
import { landedCost, quote, floorPrice, KE_RATES } from "../engine/landed.mjs";
import { planEta, applyEvent } from "../engine/eta.mjs";
import { STORES, all, put, saveShipment, saveOrder, saveQueued, savePhoto, getPhoto, newId, kvGet, kvSet, seedDemoJobs } from "./lib/db.js";
import { flush, queueDepth, getConfig, setConfig } from "./lib/sync.js";
import { probe, readCargoPhoto, transcribeVoice, explainQuote, getModelConfig, setModelConfig, readDocument, isReadableDocument } from "./lib/meta.js";
import { quoteHtml } from "./lib/quote-doc.mjs";
import { dutyTreatment, pvocFee, pvocApplicable, resolveHS, waiverAdjustment, EAC_MEMBERS, WAIVER_TYPES, FX } from "../engine/tariff.mjs";
import { buildDossier, dossierStatus, setDocStatus } from "../engine/docs.mjs";
import { country, integrationState, expressReadiness, COUNTRY_EXTRAS } from "../engine/countries.mjs";
import { createAccount, createUser, can, assertCan, scoped, documentHeader, creditDecision, ROLES } from "../engine/accounts.mjs";
import { createOrder, advance, nextStage, blockersFor, receiveGoods, dispatch as dispatchOrder, deliver as deliverOrder, slaState, STAGES as ORDER_STAGES, ORDER_TYPES } from "../engine/orders.mjs";
import { config as loconavConfig, probe as loconavProbe, parseWebhook, trackingState, LOCONAV } from "../engine/loconav.mjs";
import { LANES, exportLaneRows } from "../engine/lanes.mjs";
import { parseSpec, compareOffers, dropshipDecision, rfqDraft, landedPerUnit } from "../engine/sourcing.mjs";
import { buildInvoice, recordPayment, ageing, creditExposure, nextInvoiceNumber } from "../engine/invoicing.mjs";
import { receiveLot, stockPosition, allocate as allocateStock, pickList, availabilityStatement, binName } from "../engine/inventory.mjs";
import { invoiceHtml, deliveryNoteHtml, packingListHtml } from "./lib/doc-templates.mjs";
import { CHANNELS, EVENT_KEYS, requiredFields, render as renderMessage, enqueueNotification, approveNotification, sendNotification, isWithinQuietHours, quietHoursReason } from "../engine/notifications.mjs";
import { addSupplier, verifySupplier, scoreSupplier, compareSuppliers, buildPurchaseOrder, PAYMENT_TERMS } from "../engine/suppliers.mjs";
import { purchaseOrderHtml } from "./lib/supplier-docs.mjs";
import { startCount, applyCount, writeOff, shrinkageReport, WRITE_OFF_REASONS } from "../engine/inventory-ops.mjs";
import { list as listPlugins, status as pluginStatus, configure as configurePlugin, dryRun, supports as pluginSupports, get as getPlugin } from "../engine/plugins.mjs";
import NetworkView from "./NetworkView.jsx";
import ExportView from "./ExportView.jsx";
import Deadlines from "./Deadlines.jsx";
import { POLICY, assessQuote } from "../engine/pricing-policy.mjs";
import DashboardHub from "./dashboards/hub.jsx";
import Landing from "./Landing.jsx";
import Auth from "./Auth.jsx";
import AmandaBar from "./AmandaBar.jsx";

const money = (n, ccy = "KES") =>
  `${ccy} ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v) => (v === "" || v === null ? 0 : Number(v));

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

function Empty({ icon, title, body, cta = "Create a shipment", href = "#/desk/new" }) {
  return (
    <section className="card empty">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[icon] || ICONS.box}</svg>
      <h2>{title}</h2>
      <p>{body}</p>
      <a className="primary" href={href}>{cta}</a>
    </section>
  );
}

function Desk({ onSignOut }) {
  const [tab, setTab] = useState(() => tabFromHash());
  const [stockTick, setStockTick] = useState(0);
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
    // A first visit should not be an empty desk: three sample jobs, written once, never over a real one.
    await seedDemoJobs().catch(() => {});
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

  useEffect(() => {
    const h = "#/desk/" + tab;
    if (window.location.hash !== h) window.location.hash = h;
  }, [tab]);

  useEffect(() => {
    const onHash = () => {
      const next = tabFromHash();
      setTab((prev) => (prev === next ? prev : next));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
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
    <div className="desk">
      <aside className="side">
        <a className="brand" href="#/desk/new" onClick={(e) => { e.preventDefault(); setTab("new"); }} aria-label="Altovex CargoLinx home">
          <span className="mark">AX</span>
          <span className="brand-txt"><strong>Altovex CargoLinx</strong><small>Freight desk</small></span>
        </a>

        <nav className="sidenav" aria-label="Desk modules">
          {NAV.map((group) => (
            <div className="navgroup" key={group.title}>
              <div className="navlabel">{group.title}</div>
              {group.items.map(([k, label, icon]) => (
                <button
                  key={k}
                  className={"navitem" + (tab === k ? " active" : "")}
                  onClick={() => { if (k === "hub") { window.location.hash = "#/hub"; return; } setTab(k); }}
                  aria-current={tab === k ? "page" : undefined}
                >
                  <svg className="ico" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[icon]}</svg>
                  <span className="lbl">{label}</span>
                  {k === "network" && queue > 0 ? <span className="count">{queue}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidefoot">
          <div className="userchip">
            <span className="avatar">{((user && (user.name || user.label)) || "Demo").slice(0, 1).toUpperCase()}</span>
            <span className="who">
              <strong>{(user && (user.name || user.label)) || "Demo operator"}</strong>
              <small>{(user && (user.label || user.role)) || "Local demo session"}</small>
            </span>
          </div>
          <div className="demo-note">
            <span className="demo-dot" aria-hidden="true" />
            Demo workspace — sample policy settings (25% target, 15% floor), not the operator's
          </div>
          <button className="ghost small" onClick={onSignOut}>Sign out</button>
        </div>
      </aside>

      <div className="desk-main">
        <header className="bar">
          <div className="crumbs">
            <b>Altovex</b><span className="sep">/</span><span>CargoLinx</span><span className="sep">/</span>
            <span>{PAGE[tab].title}</span>
          </div>
          <div className="spacer" />
          <div className="badge-row">
            <Badges online={online} queue={queue} backend={backend.mode === "supabase" ? "Supabase" : "Local demo server"} model={model} />
          </div>
        </header>

        <main className="page">
          <div className="page-head">
            <div className="pt">
              <h1>{PAGE[tab].title}</h1>
              <p>{PAGE[tab].sub}</p>
            </div>
            <div className="page-actions">
              {tab !== "new" && <button className="ghost" onClick={() => setTab("new")}>New shipment</button>}
              <button className="primary" onClick={syncNow} disabled={!!busy}>{busy || "Sync now"}</button>
            </div>
          </div>
        {tab === "new" && <NewShipment onCreated={async (s) => { await refresh(); setSelectedId(s.id); setTab("quote"); }} model={model} />}
        {tab === "quote" && <QuoteView shipment={selected} shipments={shipments} onPick={setSelectedId} onChange={refresh} model={model} user={user} />}
        {tab === "track" && <TrackView shipment={selected} shipments={shipments} onPick={setSelectedId} onChange={refresh} />}
        {tab === "compliance" && <ComplianceView shipment={selected} shipments={shipments} onPick={setSelectedId} onChange={refresh} />}
        {tab === "deadlines" && <Deadlines />}
        {tab === "export" && <ExportView />}
        {tab === "source" && <SourcingView />}
        {tab === "orders" && <OrdersView user={user} accounts={accounts} />}
        {tab === "money" && <MoneyView user={user} accounts={accounts} />}
        {tab === "warehouse" && <><WarehouseView user={user} tick={stockTick} onChanged={() => setStockTick((t) => t + 1)} /><WarehouseOps user={user} tick={stockTick} onChanged={() => setStockTick((t) => t + 1)} /></>}
        {tab === "suppliers" && <SuppliersView user={user} />}
        {tab === "messages" && <MessagesView user={user} />}
        {tab === "network" && <NetworkView />}
        {tab === "plugins" && <PluginsView />}
        {tab === "accounts" && <AccountsView user={user} accounts={accounts} setAccounts={setAccounts} setUser={setUser} />}
        {tab === "settings" && <Settings backend={backend} model={model} onChanged={async () => { await refresh(); probe().then(setModel); }} queue={queue} onSync={syncNow} busy={busy} />}
        </main>

        <footer>
          Figures are computed by the local engine from dated statutory rates; model output explains, never prices.
          {model.live ? "" : " Model-assisted steps are disabled until a Meta key is configured."}
        </footer>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- shell ---- */

const NAV = [
  { title: "Operate", items: [
    ["new", "New shipment", "plus"],
    ["quote", "Quotes & pricing", "file"],
    ["track", "Tracking & POD", "pin"],
    ["compliance", "Compliance", "shield"],
    ["deadlines", "Deadlines", "clock"],
  ] },
  { title: "Trade", items: [
    ["export", "Export desk", "globe"],
    ["source", "Sourcing", "globe"],
    ["suppliers", "Suppliers", "box"],
    ["orders", "Orders", "list"],
    ["money", "Money", "coins"],
  ] },
  { title: "Workspace", items: [
    ["warehouse", "Warehouse", "warehouse"],
    ["messages", "Messages", "chat"],
    ["network", "Network", "share"],
    ["hub", "Dashboards", "grid"],
    ["plugins", "Plugins", "puzzle"],
    ["accounts", "Accounts", "users"],
    ["settings", "Setup", "gear"],
  ] },
];

const PAGE = {
  new: { title: "New shipment", sub: "Capture the cargo once; the quote, documents and tracking all read from it." },
  export: { title: "Export desk", sub: "The same lanes the other way round, priced to the destination port — with the destination duty named as missing rather than guessed." },
  quote: { title: "Quotes & pricing", sub: "Landed-cost ladder and customer quote, computed locally from dated statutory rates." },
  track: { title: "Tracking & proof of delivery", sub: "Status events, photos and signatures held against the shipment." },
  deadlines: { title: "Deadlines", sub: "Every assignment on a clock: countdown to the promise, milestone calendar and the T-7 / T-3 / T-1 / T-0 client report." },
  compliance: { title: "Compliance", sub: "HS classification, EAC origin, PVoC and waivers checked before the border." },
  source: { title: "Sourcing", sub: "Supplier offers compared on landed cost per unit, not on sticker price." },
  suppliers: { title: "Suppliers", sub: "Records, verification and scoring for the parties you buy from." },
  orders: { title: "Orders", sub: "From quotation to delivery, with the stage and its blockers made explicit." },
  money: { title: "Money", sub: "Invoices, payments, ageing and credit exposure in one ledger." },
  warehouse: { title: "Warehouse", sub: "Lots, bin locations, stock counts and write-offs." },
  messages: { title: "Messages", sub: "Notification drafts per event, in your words, sent on approval." },
  network: { title: "Network", sub: "Partners, lanes and what has been handed over to whom." },
  hub: { title: "Dashboards", sub: "Eighteen stakeholder desks, each scoped to the role that works it." },
  plugins: { title: "Plugins", sub: "Optional integrations, each probed before it is trusted." },
  accounts: { title: "Accounts", sub: "People, roles and what each one is allowed to do." },
  settings: { title: "Setup", sub: "Backend, storage and model configuration for this device." },
};

const ICONS = {
  clock: <><circle cx="12" cy="12" r="8.6" /><path d="M12 7.4V12l3.4 2" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  file: <><path d="M14 3v5h5" /><path d="M19 8.5V21H5V3h9l5 5.5Z" /><path d="M8.5 13h7M8.5 16.5h4.5" /></>,
  pin: <><path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" /></>,
  shield: <><path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z" /><path d="M9 12l2 2 4-4" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3.5 9h17M3.5 15h17" /><path d="M12 3c2.6 2.6 4 5.7 4 9s-1.4 6.4-4 9c-2.6-2.6-4-5.7-4-9s1.4-6.4 4-9Z" /></>,
  box: <><path d="M3 8l9-5 9 5v8l-9 5-9-5V8Z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>,
  coins: <><ellipse cx="12" cy="6.5" rx="7" ry="3" /><path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /><path d="M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></>,
  warehouse: <><path d="M3 21V9l9-6 9 6v12" /><path d="M7 21v-7h10v7" /><path d="M7 17h10" /></>,
  chat: <><path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" /><path d="M8.5 11h7M8.5 14.5h4" /></>,
  share: <><circle cx="18" cy="5" r="2.6" /><circle cx="6" cy="12" r="2.6" /><circle cx="18" cy="19" r="2.6" /><path d="M8.4 10.8l7.2-4.2M8.4 13.2l7.2 4.2" /></>,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.4" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.4" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.4" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.4" /></>,
  puzzle: <><path d="M9 4.5a2 2 0 0 1 4 0V6h2.5a1.5 1.5 0 0 1 1.5 1.5V10h1.5a2 2 0 0 1 0 4H17v2.5a1.5 1.5 0 0 1-1.5 1.5H13v1.5a2 2 0 0 1-4 0V18H6.5A1.5 1.5 0 0 1 5 16.5V14H3.5a2 2 0 0 1 0-4H5V7.5A1.5 1.5 0 0 1 6.5 6H9V4.5Z" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5.2a3.2 3.2 0 0 1 0 6.1M17.5 20a5.6 5.6 0 0 0-2-4.3" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
};

const TAB_KEYS = NAV.flatMap((g) => g.items.map(([k]) => k));

function tabFromHash() {
  const m = /^#\/desk\/([a-z]+)/.exec(window.location.hash || "");
  return m && TAB_KEYS.includes(m[1]) ? m[1] : "new";
}

function routeFromHash() {
  const h = window.location.hash || "";
  if (h.startsWith("#/signin")) return "signin";
  if (/^#\/hub(\/|$)/.test(h)) return "hub";
  if (h.startsWith("#/desk")) return "desk";
  return "landing";
}

export default function App() {
  const [route, setRoute] = useState(routeFromHash);
  const [entered, setEntered] = useState(!!(routeFromHash() === "desk"));

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.title = route === "desk" ? "Altovex CargoLinx · Desk" : route === "signin" ? "Sign in · Altovex CargoLinx" : route === "hub" ? "Altovex CargoLinx · Dashboards" : "Altovex CargoLinx · Offline freight desk";
    document.body.classList.toggle("site", route !== "desk");
  }, [route]);

  function go(hash) {
    if (window.location.hash === hash) setRoute(routeFromHash());
    else window.location.hash = hash;
  }

  async function signOut() {
    await kvSet("session", null);
    go("#/signin");
  }

  if (route === "desk") {
    return (
      <>
        <Desk onSignOut={signOut} />
        <AmandaBar />
      </>
    );
  }
  if (route === "hub") {
    return (
      <>
        <DashboardHub />
        <AmandaBar />
      </>
    );
  }
  if (route === "signin") {
    return (
      <>
        <Auth onEnter={() => go("#/desk/new")} onHome={() => go("#/")} />
        <AmandaBar />
      </>
    );
  }
  return (
    <>
      <Landing onEnter={() => go("#/desk/new")} onSignIn={() => go("#/signin")} />
      <AmandaBar />
    </>
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
  const [docName, setDocName] = useState("");
  const [docBusy, setDocBusy] = useState(false);
  const [docServed, setDocServed] = useState("");
  const fileRef = useRef(null);
  const docRef = useRef(null);

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
      // The concept has to be the thing in the picture. A lane name matches nothing on a pallet,
      // so the cargo field leads and a plain "pallet" is the honest default when it is empty.
      const concept = String(form.cargo || "").trim() || "pallet";
      const out = await readCargoPhoto(photoUrl, concept);
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
      // The model may answer "12 pallets"; the quantity field is a number.
      const qtyNum = Number((String(out.quantity ?? "").match(/\d+(?:[.,]\d+)?/) || [])[0]);
      setForm((f) => ({
        ...f,
        cargo: out.cargo ?? f.cargo,
        qty: Number.isFinite(qtyNum) ? qtyNum : f.qty,
        weightKg: out.weightKg ?? f.weightKg,
        origin: out.origin ?? f.origin,
        destination: out.destination ?? f.destination,
      }));
    } catch (e) {
      setErr(e.message);
    }
  }

  // A supplier quotation (PDF, Word, Excel) goes to the bridge, which converts
  // it to text locally and returns shipment fields. The supplier's figures come
  // back as evidence in the note; the desk's own values stay the authority.
  async function readDocFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr("");
    setDocBusy(true);
    try {
      if (!isReadableDocument(file.name)) {
        throw new Error(`${file.name} is not a readable document — send a PDF, Word, Excel or PowerPoint file.`);
      }
      const out = await readDocument(file);
      const f = out.fields ?? {};
      const qtyNum = Number((String(f.quantity ?? "").match(/\d+(?:[.,]\d+)?/) || [])[0]);
      const wNum = Number((String(f.weightKg ?? "").match(/\d+(?:[.,]\d+)?/) || [])[0]);
      setForm((prev) => ({
        ...prev,
        cargo: f.cargo ?? prev.cargo,
        qty: Number.isFinite(qtyNum) ? qtyNum : prev.qty,
        weightKg: Number.isFinite(wNum) ? wNum : prev.weightKg,
        origin: f.origin ?? prev.origin,
        destination: f.destination ?? prev.destination,
        hs: f.hs ?? prev.hs,
        originCountry: f.origin && f.origin !== prev.origin ? prev.originCountry : prev.originCountry,
      }));
      let evidence = `Read from ${file.name}`;
      if (f.value != null && String(f.value).trim() !== "") evidence += `: supplier states ${f.value}${f.currency ? " " + f.currency : ""}`;
      if (f.comments) evidence += ` — ${f.comments}`;
      setNote((prev) => (prev ? prev + "\n" : "") + evidence);
      setDocName(file.name);
      setDocServed(out.servedBy);
    } catch (err2) {
      setErr(err2.message);
    } finally {
      setDocBusy(false);
      if (docRef.current) docRef.current.value = "";
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
        marginPct: POLICY.targetMargin,
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

      <h3>Intake — photograph, document and note</h3>
      <div className="row">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" aria-label="Photograph of the cargo" onChange={pickPhoto} style={{ maxWidth: 260 }} />
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

      <div className="row" style={{ marginTop: 8 }}>
        <input ref={docRef} type="file" accept=".pdf,.csv,.tsv,.txt,.md,.json,.html,.htm" aria-label="Supplier quotation, rate card or packing list" onChange={readDocFile} style={{ maxWidth: 260 }} />
        <span className="hint">{docBusy ? "Reading document…" : "Attach a quotation, a rate card or a packing list — the desk lifts its text on this machine and reads the fields out of it. A scan has no text to read; photograph it instead."}</span>
      </div>
      {docName && (
        <div className="hint" style={{ marginTop: 8 }}>
          <strong>Document read:</strong> {docName}
          {docServed ? ` — served by ${docServed}` : ""}
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

function QuoteView({ shipment, shipments, onPick, onChange, model, user }) {
  const [explanation, setExplanation] = useState("");
  const [servedBy, setServedBy] = useState("");
  const [err, setErr] = useState("");

  // Hooks run unconditionally and in a fixed order: the shipment arrives asynchronously from the
  // local store, so an early return placed above useMemo changes the hook count between renders
  // and takes the whole desk down (React #310) when someone deep-links straight to this tab.
  const lc = useMemo(() => {
    if (!shipment?.value) return null;
    return landedCost({
      goods: shipment.value.goods,
      freight: shipment.value.freight,
      dutyRate: shipment.dutyRate,
      clearing: shipment.services.clearing,
      transport: shipment.services.transport,
      lastMile: shipment.services.lastMile,
      other: shipment.pvoc?.kes ?? 0,
      quantity: shipment.qty,
    });
  }, [shipment]);

  if (!shipment) return (
    <Empty icon="file" title="No shipment selected"
      body="The quote is built from a shipment's line values. Create one, or open an existing shipment from the list, and the landed-cost ladder appears here." />
  );
  if (!lc) return <section className="card"><h2>Quote</h2><p className="hint">This record has no cost data yet — pick another shipment.</p></section>;

  const floor = floorPrice(lc, POLICY.minMargin);
  const margin = shipment.marginPct ?? POLICY.targetMargin;
  let q = null;
  let quoteError = "";
  try {
    q = quote(lc, { marginPct: margin, minMarginPct: POLICY.minMargin, targetMinPct: POLICY.targetMargin });
  } catch (e) {
    quoteError = e.message;
  }
  const policyCheck = q
    ? assessQuote({ costExVat: lc.totals.netCostExVat, price: q.price })
    : { concessionPrice: 0, marginAfterConcessionPct: 0 };

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
          "landed cost before VAT": lc.totals.netCostExVat,
          "statutory total (duty, IDF, RDL, VAT)": lc.totals.statutory,
          "customs value (CIF)": lc.totals.cif,
          "import duty": (lc.lines ?? []).find((l) => l.code === "DUTY")?.amount ?? null,
          "VAT on import": (lc.lines ?? []).find((l) => l.code === "VAT")?.amount ?? null,
          "clearing, transport and last mile": (lc.lines ?? [])
            .filter((l) => ["CLEARING", "TRANSPORT", "LASTMILE", "PORT", "OTHER"].includes(l.code))
            .reduce((s, l) => s + (Number(l.amount) || 0), 0),
          "quoted price before VAT": q.price,
          "margin per cent": Math.round(margin * 1000) / 10,
        },
        `${shipment.cargo}, ${shipment.origin} to ${shipment.destination}`
      );
      setExplanation(out.text);
      setServedBy(out.servedBy || "");
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
          {can(user?.role, "pricing.policy.view") && (
            <>
              <div><span>Floor price ({POLICY.minMargin * 100}%)</span><strong><Money value={floor.floorPrice} ccy={lc.currency} /></strong></div>
              <div><span>After {POLICY.negotiationRoom * 100}% concession</span><strong><Money value={policyCheck.concessionPrice} ccy={lc.currency} /></strong><div className="hint">margin {policyCheck.marginAfterConcessionPct}% · floor {POLICY.minMargin * 100}%</div></div>
            </>
          )}
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
              {/* What the buyer pays is the buyer's business. What the desk earns on the line is
                  not: margin and gross profit sit behind the same permission as the floor, so a
                  client sign-in sees a firm price and no window into the desk's buying policy. */}
              {can(user?.role, "pricing.policy.view") && (
                <div><span>Margin</span><strong>{(margin * 100).toFixed(1)}%</strong></div>
              )}
              <div><span>Price excl. VAT</span><strong><Money value={q.price} ccy={lc.currency} /></strong></div>
              <div><span>Price incl. VAT</span><strong><Money value={q.priceIncVat} ccy={lc.currency} /></strong></div>
              {can(user?.role, "pricing.policy.view") && (
                <div><span>Gross profit</span><strong><Money value={q.grossProfit} ccy={lc.currency} /></strong></div>
              )}
            </div>
            {can(user?.role, "pricing.policy.view") ? (
              <div className="row" style={{ marginTop: 12 }}>
                <label className="field" style={{ flex: 1, minWidth: 240 }}>
                  Margin (floor 15%, policy band 30–40%)
                  <input type="range" min="15" max="40" step="1" value={Math.round(margin * 100)} onChange={(e) => setMargin(Number(e.target.value) / 100)} />
                </label>
                <span className={`pill ${q.withinPolicyBand ? "ok" : "warn"}`}>{q.withinPolicyBand ? "Inside policy band" : "Outside policy band"}</span>
              </div>
            ) : (
              <p className="hint" style={{ marginTop: 12 }}>
                This price is the quote issued to you. The desk's margin is set on its side — ask your
                account manager for a revised figure if the number does not suit.
              </p>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="ghost" onClick={explain} disabled={!model.live}>Explain this quote</button>
              {!model.live && <span className="hint">Needs a Meta key. The figures above do not.</span>}
            </div>
            {explanation && (
              <p className="hint" style={{ marginTop: 8 }}>
                {explanation}
                {servedBy ? <span className="served"> — served by {servedBy}</span> : null}
              </p>
            )}
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
  const html = quoteHtml({ shipment, lc, q });
  // A popup window is blocked in many browsers and in every embedded webview,
  // which left this button doing nothing at all. Render the document into a
  // hidden frame and print from there, with a file download as the fallback.
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);

  const contentDocument = frame.contentWindow && frame.contentWindow.document;
  if (!contentDocument) {
    frame.remove();
    downloadQuote(html, shipment);
    return;
  }

  contentDocument.open();
  contentDocument.write(html);
  contentDocument.close();

  setTimeout(() => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 60000);
    } catch {
      frame.remove();
      downloadQuote(html, shipment);
    }
  }, 300);
}

function downloadQuote(html, shipment) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `CargoLinx-quote-${shipment.ref || "quote"}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function TrackView({ shipment, shipments, onPick, onChange }) {
  const [kind, setKind] = useState("delay");
  const [delay, setDelay] = useState(6);
  const [podName, setPodName] = useState("");
  const [msg, setMsg] = useState("");

  if (!shipment) return (
    <Empty icon="pin" title="Nothing to track yet"
      body="Status events, delivery photos and signatures are held against a shipment. Create one to start the event log." />
  );

  const plan = shipment.etaPlan;

  async function addEvent() {
    setMsg("");
    try {
      const hasBorder = (plan?.basis?.legs ?? []).some((l) => l.border);
      if (kind === "border-queue" && !hasBorder) {
        setMsg("This lane has no border post — a border-queue event would be a false record. Use Delay instead.");
        return;
      }
      if (kind === "delivered" && !podName.trim()) {
        setMsg("A POD needs the name of the person who signed for the cargo.");
        return;
      }
      const deliveredAlready = shipment.status === "delivered";
      if (deliveredAlready && kind === "delivered") {
        setMsg("This shipment is already delivered and signed for. A second POD would overwrite the first signature.");
        return;
      }
      const borderLeg = (plan?.basis?.legs ?? []).find((l) => l.border);
      const borderPost = borderLeg ? borderLeg.name.split("-").pop().trim() : "the border";
      const note = kind === "delivered"
        ? `POD signed by ${podName.trim()}`
        : kind === "border-queue"
          ? `Border queue at ${borderPost}`
          : `Delay reported by driver${deliveredAlready ? " (after delivery — recorded as a claim)" : ""}`;
      let next;
      if (kind === "delivered") {
        next = applyEvent(plan, { type: "delivered", at: new Date().toISOString(), note });
        next.pod = { signedBy: podName.trim(), at: new Date().toISOString() };
      } else {
        next = applyEvent(plan, { type: kind, delayHours: Number(delay), note });
      }
      // Delivered is terminal: a later delay is a claim against a closed delivery, not a reopening of the trip.
      const status = deliveredAlready || kind === "delivered" ? "delivered" : "in transit";
      const events = [...(shipment.events ?? []), { type: kind, at: new Date().toISOString(), note: kind === "delivered" ? note : `${delay}h — ${kind}` }];
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
  if (!shipment) return (
    <Empty icon="shield" title="No shipment to check"
      body="Classification, EAC origin, PVoC and waivers are checked per consignment. Create a shipment to run the checks." />
  );

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

function SourcingView() {
  const [text, setText] = useState("I need 500 pcs solar panels under 120 usd to Kenya, HS 8541.43");
  const [offersRaw, setOffersRaw] = useState('[{"supplier":"Shenzhen A","tiers":[{"minQty":1000,"unitPrice":14}],"leadTimeDays":35,"shipsTo":["KE"],"rating":4.2},{"supplier":"Ningbo B","tiers":[{"minQty":100,"unitPrice":18.5},{"minQty":500,"unitPrice":17}],"leadTimeDays":18,"shipsTo":["KE"],"rating":4.8,"certifications":["CE"]}]');
  const [decision, setDecision] = useState(null);
  const [err, setErr] = useState("");

  const spec = parseSpec(text);
  let offers = [];
  try {
    offers = JSON.parse(offersRaw || "[]");
  } catch {
    offers = [];
  }
  const ranked = offers.length ? compareOffers(offers, { qty: spec.qty ?? 1, budget: spec.budget, destination: spec.destination ?? "KE" }) : [];

  function runDecision() {
    setErr("");
    try {
      const d = dropshipDecision({ demandPerMonth: Number(spec.qty || 100) / 2, moq: 1000, unitPriceBulk: 15, unitPriceDropship: 22, freightBulk: 800, freightDropship: 6, dutyRate: 0.25 });
      setDecision(d);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <>
      <section className="card">
        <h2>Sourcing brief</h2>
        <label className="field" style={{ marginBottom: 10 }}>
          What the client asked for
          <textarea rows="2" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="kpi">
          <div><span>Product</span><strong style={{ fontSize: 14 }}>{spec.product ?? "—"}</strong></div>
          <div><span>Quantity</span><strong>{spec.qty ? `${spec.qty} ${spec.qtyUnit}` : "not stated"}</strong></div>
          <div><span>Budget</span><strong>{spec.budget ? `${spec.currency} ${spec.budget}` : "none"}</strong></div>
          <div><span>Destination</span><strong>{spec.destination ?? "—"}</strong></div>
          <div><span>HS hint</span><strong>{spec.hsHint ?? "—"}</strong></div>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          {spec.complete ? "Brief is complete enough to send to suppliers." : "A quantity is missing — the brief is not complete and no RFQ will be issued until it is."}
        </p>
      </section>

      <section className="card">
        <h2>Offers compared</h2>
        <label className="field" style={{ marginBottom: 10 }}>
          Offers returned by a supplier plugin or pasted by the buyer (JSON)
          <textarea rows="4" value={offersRaw} onChange={(e) => setOffersRaw(e.target.value)} />
        </label>
        {ranked.length === 0 && <p className="hint">No offers to compare yet.</p>}
        <table className="lines">
          <thead><tr><th>Supplier</th><th className="num">Unit</th><th className="num">Lead days</th><th className="num">Score</th><th>Verdict</th></tr></thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={r.supplier}>
                <td>{r.supplier}</td>
                <td className="num">{r.unitPrice ?? "—"}</td>
                <td className="num">{r.leadTimeDays ?? "—"}</td>
                <td className="num">{r.score}</td>
                <td><span className={`pill ${r.verdict === "shortlist" ? "ok" : r.verdict === "consider" ? "warn" : "bad"}`}>{r.verdict}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {ranked[0]?.reasons?.length ? <p className="hint" style={{ marginTop: 8 }}>Why {ranked[0].supplier}: {ranked[0].reasons.join("; ")}</p> : null}
      </section>

      <section className="card">
        <h2>Dropship or hold stock</h2>
        <div className="row">
          <button className="ghost" onClick={runDecision}>Run the arithmetic</button>
          <span className="hint">Uses monthly demand derived from the brief, a MOQ of 1,000, and bulk vs dropship unit prices.</span>
        </div>
        {decision && (
          <div style={{ marginTop: 10 }}>
            <div className="kpi">
              <div><span>Recommendation</span><strong>{decision.recommendation}</strong></div>
              <div><span>Bulk per unit</span><strong>{decision.bulkPerUnit}</strong></div>
              <div><span>Dropship per unit</span><strong>{decision.dropshipPerUnit}</strong></div>
              <div><span>Cash tied up</span><strong>{money(decision.cashTiedKes, "")}</strong></div>
            </div>
            <p className="hint" style={{ marginTop: 8 }}>{decision.why} · MOQ covers {decision.monthsOfCover} months of demand.</p>
          </div>
        )}
        {err && <div className="notice bad" style={{ marginTop: 8 }}>{err}</div>}
      </section>

      <section className="card">
        <h2>RFQ draft</h2>
        <p className="hint">Written from the brief. Copy it to the supplier as it stands, or adjust the quantities first.</p>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#f3f7fb", border: "1px solid var(--line)", padding: 12, borderRadius: 8, marginTop: 8 }}>
{rfqDraft(spec)}
        </pre>
      </section>
    </>
  );
}

function PluginsView() {
  const [plugins, setPlugins] = useState(listPlugins());
  const [fields, setFields] = useState({});
  const [msg, setMsg] = useState("");

  function refresh() { setPlugins(listPlugins()); }

  function save(id) {
    const manifest = getPlugin(id);
    const config = {};
    for (const r of manifest.requires) config[r.key] = (fields[id]?.[r.key] ?? "").trim();
    const st = configurePlugin(id, config, { enabled: true });
    refresh();
    setMsg(`${manifest.name}: ${st.state}`);
  }

  return (
    <>
      {plugins.map((p) => {
        const st = pluginStatus(p.id);
        return (
          <section className="card" key={p.id}>
            <div className="row">
              <h2 style={{ margin: 0 }}>{p.name}</h2>
              <span className={`pill ${st.state === "ready" ? "ok" : st.state === "not-configured" ? "warn" : "bad"}`}>{st.state}</span>
            </div>
            <p className="hint" style={{ marginTop: 6 }}>{p.model}</p>
            <p className="hint">Capabilities: {p.capabilities.join(", ")}</p>
            {p.requires.length > 0 && (
              <div className="grid" style={{ marginTop: 8 }}>
                {p.requires.map((r) => (
                  <label className="field" key={r.key}>
                    {r.label}
                    <input
                      type="password"
                      placeholder={r.how}
                      value={fields[p.id]?.[r.key] ?? ""}
                      onChange={(e) => setFields({ ...fields, [p.id]: { ...(fields[p.id] ?? {}), [r.key]: e.target.value } })}
                    />
                  </label>
                ))}
              </div>
            )}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="ghost" onClick={() => save(p.id)}>Enable and save</button>
              <button
                className="ghost"
                onClick={() => {
                  try {
                    const d = dryRun(p.id, p.capabilities[0], { sample: true });
                    setMsg(`${p.name} dry run → ${d.request.method} ${d.request.host} (signed ${d.request.signed}), credentials present: ${d.credentialsPresent}`);
                  } catch (e) {
                    setMsg(e.message);
                  }
                }}
              >
                Show the request it would send
              </button>
            </div>
            {p.notes?.length ? (
              <ul className="hint" style={{ marginTop: 8 }}>
                {p.notes.map((n, i) => (<li key={i}>{n}</li>))}
              </ul>
            ) : null}
            <p className="hint" style={{ marginTop: 6 }}>Documentation: {p.docs}</p>
          </section>
        );
      })}
      {msg && <div className="notice">{msg}</div>}
      <section className="card">
        <h2>How these fit the desk</h2>
        <p className="hint">
          Sourcing plugins bring offers in. The sourcing module compares them on your terms — quantity, budget, lead time, certificates and whether they ship here — and the order pipeline takes over from the purchase onwards. Dropship orders skip the warehouse; stock orders land in Nairobi.
          A plugin without credentials shows the request it would send and nothing else. No catalogue, no price and no supplier is ever invented.
        </p>
      </section>
    </>
  );
}

function MoneyView({ user, accounts }) {
  const [orders, setOrders] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [open, setOpen] = useState(null);
  const [payment, setPayment] = useState({ amount: "", method: "mpesa", reference: "" });
  const [msg, setMsg] = useState("");

  const load = async () => {
    setOrders(((await all(STORES.orders)) ?? []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
    setInvoices((await all(STORES.invoices)) ?? []);
  };
  useEffect(() => { load(); }, []);

  const billable = orders.filter((o) => ["dispatched", "delivered"].includes(o.stage) && (!user || can(user.role, "account.view") || o.accountId === user.accountId));

  async function issue(order) {
    setMsg("");
    try {
      const existing = invoices.map((i) => i.number);
      const number = nextInvoiceNumber({ series: existing });
      const inv = buildInvoice({ order, kind: "tax", number });
      await saveQueued(STORES.invoices, "invoice", inv, "number");
      await flush();
      await load();
      setOpen(number);
      setMsg(`Invoice ${number} issued for ${money(inv.total, inv.currency)}.${inv.unposted.length ? ` Not yet posted: ${inv.unposted.join("; ")}.` : ""}`);
    } catch (e) {
      setMsg(e.message);
    }
  }

  async function pay(inv) {
    setMsg("");
    try {
      const updated = recordPayment(inv, { amount: Number(payment.amount), method: payment.method, reference: payment.reference || null });
      await saveQueued(STORES.invoices, "invoice", updated, "number");
      await flush();
      await load();
      setPayment({ amount: "", method: "mpesa", reference: "" });
      setMsg(`Payment recorded. Balance ${money(updated.balance, updated.currency)}.`);
    } catch (e) {
      setMsg(e.message);
    }
  }

  const current = invoices.find((i) => i.number === open) ?? invoices[0] ?? null;
  const pos = ageing(invoices);
  const exposure = user ? creditExposure(invoices, user.accountId) : 0;

  function print(inv) {
    const order = orders.find((o) => o.id === inv.orderId);
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(invoiceHtml({ invoice: inv, order, account: accounts.find((a) => a.id === inv.accountId) }));
    w.document.close();
    w.focus();
  }

  return (
    <>
      <section className="card">
        <h2>Issue an invoice</h2>
        <p className="hint">An invoice is built from the order's posted line values — never from the quotation that opened it.</p>
        {billable.length === 0 && <p className="hint">No dispatched or delivered orders to invoice yet.</p>}
        <div className="row" style={{ marginTop: 8 }}>
          {billable.slice(0, 4).map((o) => (
            <button key={o.id} className="ghost" onClick={() => issue(o)}>Invoice order {o.id.slice(-6)} · {money(o.valueKes, "")}</button>
          ))}
        </div>
        {msg && <div className="notice" style={{ marginTop: 10 }}>{msg}</div>}
      </section>

      <section className="card">
        <h2>Ledger</h2>
        <table className="lines">
          <thead><tr><th>Number</th><th>Order</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Balance</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.number}>
                <td>{i.number}</td>
                <td>{(i.orderId || "").slice(-6)}</td>
                <td className="num">{money(i.total, "")}</td>
                <td className="num">{money(i.paid, "")}</td>
                <td className="num">{money(i.balance, "")}</td>
                <td><span className={`pill ${i.status === "paid" ? "ok" : i.status === "part paid" ? "warn" : "bad"}`}>{i.status}</span></td>
                <td><button className="ghost" onClick={() => setOpen(i.number)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {invoices.length === 0 && <p className="hint">No invoices yet.</p>}
      </section>

      {current && (
        <section className="card">
          <div className="row">
            <h2 style={{ margin: 0 }}>{current.number} · {current.status}</h2>
            <span className="pill">{current.kind}</span>
          </div>
          <div className="kpi" style={{ marginTop: 10 }}>
            <div><span>Subtotal</span><strong>{money(current.subtotal, current.currency)}</strong></div>
            <div><span>VAT</span><strong>{money(current.vat, current.currency)}</strong></div>
            <div><span>Total</span><strong>{money(current.total, current.currency)}</strong></div>
            <div><span>Balance</span><strong>{money(current.balance, current.currency)}</strong></div>
          </div>
          <div className="grid" style={{ marginTop: 10 }}>
            <label className="field">Amount<input type="number" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} /></label>
            <label className="field">Method
              <select value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value })}>
                {["mpesa", "bank", "cash", "card", "offset"].map((m) => (<option key={m}>{m}</option>))}
              </select>
            </label>
            <label className="field">Reference<input value={payment.reference} onChange={(e) => setPayment({ ...payment, reference: e.target.value })} placeholder="M-PESA code" /></label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" onClick={() => pay(current)} disabled={current.status === "paid"}>Record payment</button>
            <button className="ghost" onClick={() => print(current)}>Print invoice</button>
          </div>
          {current.unposted?.length ? <div className="notice" style={{ marginTop: 8 }}>Not yet posted: {current.unposted.join("; ")}</div> : null}
        </section>
      )}

      <section className="card">
        <h2>Ageing · outstanding {money(pos.outstanding, "KES")}</h2>
        <div className="kpi">
          <div><span>Current</span><strong>{money(pos.buckets.current, "")}</strong></div>
          <div><span>1–30</span><strong>{money(pos.buckets["1-30"], "")}</strong></div>
          <div><span>31–60</span><strong>{money(pos.buckets["31-60"], "")}</strong></div>
          <div><span>60+</span><strong>{money(pos.buckets["60+"], "")}</strong></div>
        </div>
        {user && <p className="hint" style={{ marginTop: 8 }}>Credit exposure on this account: {money(exposure, "KES")} — this is the figure the credit gate uses, not the order value.</p>}
      </section>
    </>
  );
}

function WarehouseView({ user, onChanged, tick = 0 }) {
  const [lots, setLots] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({ sku: "", description: "", qty: "", lot: "", bin: "NBO-01-01-01", unitCost: "", expiresAt: "" });
  const [alloc, setAlloc] = useState({ orderId: "", sku: "", qty: "" });
  const [result, setResult] = useState(null);
  const [msg, setMsg] = useState("");

  const load = async () => {
    setLots((await all(STORES.lots)) ?? []);
    setOrders(((await all(STORES.orders)) ?? []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  };
  useEffect(() => { load(); }, [tick]);

  async function receive(e) {
    e.preventDefault();
    setMsg("");
    try {
      const lot = receiveLot({
        sku: form.sku,
        description: form.description || form.sku,
        qty: Number(form.qty),
        bin: form.bin,
        lot: form.lot || null,
        unitCost: Number(form.unitCost || 0),
        expiresAt: form.expiresAt || null,
      });
      await saveQueued(STORES.lots, "lot", lot);
      await flush();
      await load();
      setForm({ ...form, qty: "", lot: "" });
      setMsg(`Received ${lot.qty} of ${lot.sku} into ${lot.bin}.`);
      onChanged?.();
    } catch (err) {
      setMsg(err.message);
    }
  }

  function doAllocate() {
    setMsg("");
    try {
      const r = allocateStock(lots, { sku: alloc.sku, qty: Number(alloc.qty), orderId: alloc.orderId });
      setResult({ ...r, pick: pickList(r.allocations) });
      setMsg(r.complete ? `Allocated ${alloc.qty} to order ${String(alloc.orderId).slice(-6)}.` : `Short by ${r.shortfall} — allocated what exists.`);
    } catch (err) {
      setResult(null);
      setMsg(err.message);
    }
  }

  async function commitAllocation() {
    if (!result) return;
    for (const l of result.lots) await saveQueued(STORES.lots, "lot", l);
    const order = orders.find((o) => o.id === alloc.orderId);
    if (order) {
      const updated = { ...order, allocations: [...(order.allocations ?? []), ...result.allocations], pickedQty: (order.pickedQty ?? 0) + result.allocations.reduce((a, x) => a + x.qty, 0) };
      await saveOrder(updated);
    }
    await flush();
    await load();
    setMsg("Allocation committed to stock and to the order.");
    onChanged?.();
  }

  const skus = [...new Set(lots.map((l) => l.sku))];
  const positions = skus.map((sku) => stockPosition(lots, { sku }));

  function printNote(kind) {
    const order = orders.find((o) => o.id === alloc.orderId) ?? orders[0];
    if (!order) return setMsg("Pick an order first.");
    const w = window.open("", "_blank");
    if (!w) return;
    const html = kind === "delivery"
      ? deliveryNoteHtml({ order, account: { name: order.accountId }, noteNumber: `DN-${Date.now().toString().slice(-6)}`, items: result?.pick ?? [] })
      : packingListHtml({ order, account: { name: order.accountId }, listNumber: `PL-${Date.now().toString().slice(-6)}`, lots: result?.allocations ?? [] });
    w.document.write(html);
    w.document.close();
    w.focus();
  }

  return (
    <>
      <section className="card">
        <h2>Receive into a bin</h2>
        <form onSubmit={receive}>
          <div className="grid">
            <label className="field">SKU<input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="SP450" /></label>
            <label className="field">Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Solar panel 450W" /></label>
            <label className="field">Quantity<input type="number" min="1" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></label>
            <label className="field">Lot<input value={form.lot} onChange={(e) => setForm({ ...form, lot: e.target.value })} placeholder="L-2026-11" /></label>
            <label className="field">Bin<input value={form.bin} onChange={(e) => setForm({ ...form, bin: e.target.value })} /></label>
            <label className="field">Unit cost<input type="number" min="0" value={form.unitCost} onChange={(e) => setForm({ ...form, unitCost: e.target.value })} /></label>
            <label className="field">Expiry<input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></label>
          </div>
          <div className="row" style={{ marginTop: 10 }}><button className="primary" type="submit">Receive</button></div>
        </form>
        {msg && <div className="notice" style={{ marginTop: 8 }}>{msg}</div>}
      </section>

      <section className="card">
        <h2>Stock position</h2>
        {positions.length === 0 && <p className="hint">Nothing received yet.</p>}
        <table className="lines">
          <thead><tr><th>SKU</th><th className="num">On hand</th><th className="num">Allocated</th><th className="num">Expired</th><th className="num">Available</th><th className="num">Value</th><th>Statement</th></tr></thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.sku}>
                <td>{p.sku}</td>
                <td className="num">{p.onHand}</td>
                <td className="num">{p.allocated}</td>
                <td className="num">{p.expired}</td>
                <td className="num">{p.available}</td>
                <td className="num">{money(p.value, "")}</td>
                <td className="hint">{availabilityStatement(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Allocate to an order</h2>
        <div className="grid">
          <label className="field">Order
            <select value={alloc.orderId} onChange={(e) => setAlloc({ ...alloc, orderId: e.target.value })}>
              <option value="">—</option>
              {orders.map((o) => (<option key={o.id} value={o.id}>{o.id.slice(-6)} · {o.stage}</option>))}
            </select>
          </label>
          <label className="field">SKU
            <select value={alloc.sku} onChange={(e) => setAlloc({ ...alloc, sku: e.target.value })}>
              <option value="">—</option>
              {skus.map((s) => (<option key={s}>{s}</option>))}
            </select>
          </label>
          <label className="field">Quantity<input type="number" min="1" value={alloc.qty} onChange={(e) => setAlloc({ ...alloc, qty: e.target.value })} /></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" onClick={doAllocate} disabled={!alloc.orderId || !alloc.sku}>Allocate</button>
          {result && <button className="ghost" onClick={commitAllocation}>Commit allocation</button>}
          <button className="ghost" onClick={() => printNote("delivery")}>Delivery note</button>
          <button className="ghost" onClick={() => printNote("packing")}>Packing list</button>
        </div>
        {result?.pick?.length ? (
          <table className="lines" style={{ marginTop: 10 }}>
            <thead><tr><th>#</th><th>Bin</th><th>Lot</th><th>SKU</th><th className="num">Qty</th></tr></thead>
            <tbody>
              {result.pick.map((p) => (<tr key={p.seq}><td>{p.seq}</td><td>{p.bin}</td><td>{p.lot}</td><td>{p.sku}</td><td className="num">{p.qty}</td></tr>))}
            </tbody>
          </table>
        ) : null}
        {result?.skipped?.length ? <p className="hint" style={{ marginTop: 6 }}>Skipped: {result.skipped.map((s) => `${s.lot} (${s.why})`).join(", ")}</p> : null}
      </section>
    </>
  );
}


/* ------------------------------------------------------------------ messages */
const QUIET = { startHour: 21, endHour: 7, timezoneOffsetMinutes: 180 };
const asQueue = (v) => (Array.isArray(v) ? v : (v?.queue ?? []));

function MessagesView({ user }) {
  const [orders, setOrders] = useState([]);
  const [queue, setQueue] = useState([]);
  const [eventKey, setEventKey] = useState("dispatched");
  const [channel, setChannel] = useState("whatsapp");
  const [to, setTo] = useState(user?.email ?? "");
  const [orderId, setOrderId] = useState("");
  const [vals, setVals] = useState({});
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      setOrders(((await all(STORES.orders)) ?? []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
      setQueue(asQueue(await kvGet("notifQueue")));
    })();
  }, []);

  const fields = requiredFields(eventKey);
  const order = orders.find((o) => o.id === orderId) ?? null;

  useEffect(() => {
    const guess = {
      orderRef: order ? order.id.slice(-6) : "",
      accountName: order ? (order.accountName ?? "") : "",
      lineCount: order ? String(order.lines?.length ?? 1) : "",
      amount: order ? money(order.valueKes, "") : "",
      destination: order?.destination ?? "",
      location: order?.destination ?? "",
      driverName: order?.driverName ?? "",
      vehicleId: order?.vehicleId ?? "",
      trackingRef: order?.trackingRef ?? (order ? order.id.slice(-6) : ""),
      promisedAt: order?.promisedAt ?? "",
    };
    const next = {};
    for (const f of fields) next[f] = guess[f] ?? "";
    setVals(next);
  }, [eventKey, orderId, orders.length]);

  let preview = null;
  let err = null;
  try {
    preview = renderMessage(eventKey, vals, channel);
  } catch (e) {
    err = e.message;
  }

  const nowInQuiet = isWithinQuietHours(new Date(), QUIET);

  async function persist(next, note) {
    const rows = asQueue(next);
    setQueue(rows);
    await kvSet("notifQueue", rows);
    setMsg(note);
  }

  async function queueIt() {
    try {
      const res = enqueueNotification(queue, { eventKey, payload: vals, channel, to, at: new Date().toISOString() });
      await persist(res, "Queued. Nothing leaves until a named approver signs it.");
    } catch (e) {
      setMsg(e.message);
    }
  }

  async function approve(id) {
    try {
      const res = approveNotification(queue, id, { by: user?.name ?? "Amanda", at: new Date().toISOString() });
      await persist(res, "Approved. It is now eligible for a send run — not sent.");
    } catch (e) {
      setMsg(e.message);
    }
  }

  async function send(id) {
    try {
      const res = sendNotification(queue, id, { at: new Date().toISOString(), quietHours: QUIET });
      await persist(res, `Marked sent${res.receipt?.body ? "" : ""}. Recipient recorded as ${res.receipt?.to ?? "—"}.`);
    } catch (e) {
      setMsg(e.message);
    }
  }

  return (
    <>
      <section className="card">
        <h2>Compose a customer message</h2>
        <p className="hint">Fields are taken from the order. Anything the template needs and the order cannot supply stays blank and the message will not render — a blank reference is worse than no message.</p>
        <div className="grid">
          <label className="field">Order
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">—</option>
              {orders.map((o) => (<option key={o.id} value={o.id}>{o.id.slice(-6)} · {o.stage}</option>))}
            </select>
          </label>
          <label className="field">Event
            <select value={eventKey} onChange={(e) => setEventKey(e.target.value)}>
              {EVENT_KEYS.map((k) => (<option key={k}>{k}</option>))}
            </select>
          </label>
          <label className="field">Channel
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              {Object.keys(CHANNELS).map((k) => (<option key={k}>{k}</option>))}
            </select>
          </label>
          <label className="field">To<input value={to} onChange={(e) => setTo(e.target.value)} placeholder="client contact" /></label>
        </div>
        <div className="grid" style={{ marginTop: 8 }}>
          {fields.map((f) => (
            <label className="field" key={f}>{f}
              <input value={vals[f] ?? ""} onChange={(e) => setVals({ ...vals, [f]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="notice" style={{ marginTop: 10 }}>
          {err ? <span>Cannot render: {err}</span> : (
            <>
              {preview.subject ? <div><strong>{preview.subject}</strong></div> : null}
              <div>{preview.body}</div>
              <div className="hint" style={{ marginTop: 4 }}>{preview.length} of {CHANNELS[channel].maxLength} characters on {CHANNELS[channel].label}.</div>
            </>
          )}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" onClick={queueIt} disabled={!!err || !to}>Queue for approval</button>
          <span className="hint">{nowInQuiet ? "Quiet hours now — sends will be refused until 07:00." : "Outside quiet hours."}</span>
        </div>
        {msg && <div className="notice" style={{ marginTop: 8 }}>{msg}</div>}
      </section>

      <section className="card">
        <h2>Approval queue</h2>
        {queue.length === 0 && <p className="hint">Nothing queued.</p>}
        <table className="lines">
          <thead><tr><th>Event</th><th>To</th><th>Channel</th><th>Status</th><th>Approved by</th><th></th></tr></thead>
          <tbody>
            {queue.slice().reverse().map((q) => (
              <tr key={q.id}>
                <td>{q.eventKey}</td>
                <td>{q.to.replace(/^(\+?\d{3})\d+(\d{4})$/, "$1****$2")}</td>
                <td>{q.channel}</td>
                <td><span className={`pill ${q.status === "sent" ? "ok" : q.status === "approved" ? "warn" : ""}`}>{q.status}</span></td>
                <td>{(q.approvals ?? []).map((a) => a.by).join(", ") || "—"}</td>
                <td>
                  {q.status === "pending" && <button className="ghost" onClick={() => approve(q.id)}>Approve</button>}
                  {q.status === "approved" && <button className="ghost" onClick={() => send(q.id)}>Send</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

/* ----------------------------------------------------------------- suppliers */
function SuppliersView({ user }) {
  const [list, setList] = useState([]);
  const [form, setForm] = useState({ name: "", country: "KE", email: "", products: "", leadTimeDays: "30", paymentTerms: "net30" });
  const [verify, setVerify] = useState({ id: "", reference: "" });
  const [po, setPo] = useState({ supplierId: "", description: "", qty: "1", unitPrice: "" });
  const [product, setProduct] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => { (async () => setList((await kvGet("suppliersAll")) ?? []))(); }, []);

  const save = async (next, note) => { setList(next); await kvSet("suppliersAll", next); setMsg(note); };

  async function add(e) {
    e.preventDefault();
    try {
      const sup = addSupplier({
        name: form.name, country: form.country, contact: { email: form.email },
        products: form.products.split(",").map((x) => x.trim()).filter(Boolean),
        certifications: [], leadTimeDays: Number(form.leadTimeDays), paymentTerms: form.paymentTerms,
      });
      await save([...list, sup], `${sup.name} added, unverified. A supplier starts unverified and stays that way until someone names a reference.`);
      setForm({ ...form, name: "", email: "", products: "" });
    } catch (err) { setMsg(err.message); }
  }

  async function doVerify() {
    try {
      const sup = list.find((x) => x.id === verify.id || x.name === verify.id);
      if (!sup) return setMsg("Pick a supplier.");
      const v = verifySupplier(sup, { by: user?.name ?? "Amanda", reference: verify.reference });
      await save(list.map((x) => (x.id === v.id ? v : x)), `${v.name} verified against ${verify.reference}.`);
      setVerify({ ...verify, reference: "" });
    } catch (err) { setMsg(err.message); }
  }

  function raisePo() {
    try {
      const sup = list.find((x) => x.id === po.supplierId);
      const order = { id: `ADHOC-${Date.now().toString().slice(-5)}` };
      const doc = buildPurchaseOrder({ order, supplier: sup, lines: [{ description: po.description, qty: Number(po.qty), unitPrice: Number(po.unitPrice) }], number: `PO-${new Date().toISOString().slice(2, 7).replace("-", "")}-${String(list.length).padStart(3, "0")}` });
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.write(purchaseOrderHtml({ po: doc, supplier: sup, order, today: new Date().toDateString() }));
      w.document.close();
      w.focus();
      setMsg(`${doc.number} issued to ${sup.name} for ${money(doc.total, "KES")}. A purchase order carries no VAT line — that is the supplier's document to raise.`);
    } catch (err) { setMsg(err.message); }
  }

  const ranked = product ? compareSuppliers(list, { product }) : [];

  return (
    <>
      <section className="card">
        <h2>Add a supplier</h2>
        <form onSubmit={add}>
          <div className="grid">
            <label className="field">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Kunpeng Industrial Ltd" /></label>
            <label className="field">Country<input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} maxLength={2} /></label>
            <label className="field">Email<input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="field">Products (comma separated)<input value={form.products} onChange={(e) => setForm({ ...form, products: e.target.value })} placeholder="display chiller, cold room" /></label>
            <label className="field">Lead time (days)<input type="number" value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })} /></label>
            <label className="field">Payment terms
              <select value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}>
                {PAYMENT_TERMS.map((t) => (<option key={t}>{t}</option>))}
              </select>
            </label>
          </div>
          <div className="row" style={{ marginTop: 10 }}><button className="primary" type="submit">Add supplier</button></div>
        </form>
        {msg && <div className="notice" style={{ marginTop: 8 }}>{msg}</div>}
      </section>

      <section className="card">
        <h2>Register</h2>
        {list.length === 0 && <p className="hint">No suppliers yet.</p>}
        <table className="lines">
          <thead><tr><th>Name</th><th>Country</th><th>Terms</th><th className="num">Lead</th><th className="num">Score</th><th>Status</th></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td><td>{s.country}</td><td>{s.paymentTerms}</td>
                <td className="num">{s.leadTimeDays}</td>
                <td className="num">{scoreSupplier(s).score}</td>
                <td><span className={`pill ${s.status === "verified" ? "ok" : "warn"}`}>{s.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Verify a supplier</h2>
        <p className="hint">Verification needs a reference — a registration, a certificate, a trade licence number. A verification with no reference is refused.</p>
        <div className="grid">
          <label className="field">Supplier
            <select value={verify.id} onChange={(e) => setVerify({ ...verify, id: e.target.value })}>
              <option value="">—</option>
              {list.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
          </label>
          <label className="field">Reference<input value={verify.reference} onChange={(e) => setVerify({ ...verify, reference: e.target.value })} placeholder="KRA PIN / certificate no." /></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}><button className="primary" onClick={doVerify} disabled={!verify.id}>Verify</button></div>
      </section>

      <section className="card">
        <h2>Raise a purchase order</h2>
        <div className="grid">
          <label className="field">Supplier
            <select value={po.supplierId} onChange={(e) => setPo({ ...po, supplierId: e.target.value })}>
              <option value="">—</option>
              {list.map((s) => (<option key={s.id} value={s.id}>{s.name} ({s.status})</option>))}
            </select>
          </label>
          <label className="field">Description<input value={po.description} onChange={(e) => setPo({ ...po, description: e.target.value })} /></label>
          <label className="field">Quantity<input type="number" value={po.qty} onChange={(e) => setPo({ ...po, qty: e.target.value })} /></label>
          <label className="field">Unit price<input type="number" value={po.unitPrice} onChange={(e) => setPo({ ...po, unitPrice: e.target.value })} /></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}><button className="primary" onClick={raisePo} disabled={!po.supplierId}>Issue purchase order</button></div>
      </section>

      <section className="card">
        <h2>Who can supply this product</h2>
        <div className="grid">
          <label className="field">Product<input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="display chiller" /></label>
        </div>
        {ranked.length > 0 && (
          <table className="lines" style={{ marginTop: 10 }}>
            <thead><tr><th>Supplier</th><th className="num">Score</th><th className="num">Lead</th><th>Status</th></tr></thead>
            <tbody>{ranked.map((r) => (<tr key={r.id ?? r.name}><td>{r.name}</td><td className="num">{r.score}</td><td className="num">{r.leadTimeDays}</td><td>{r.status}</td></tr>))}</tbody>
          </table>
        )}
        {product && ranked.length === 0 && <p className="hint">No registered supplier lists that product.</p>}
      </section>
    </>
  );
}

/* ------------------------------------------------------- counting and shrinkage */
function WarehouseOps({ user, tick = 0, onChanged }) {
  const [lots, setLots] = useState([]);
  const [count, setCount] = useState({ lotId: "", countedQty: "", countedBy: "" });
  const [wo, setWo] = useState({ lotId: "", qty: "", reason: "damaged" });
  const [msg, setMsg] = useState("");

  const load = async () => setLots((await all(STORES.lots)) ?? []);
  useEffect(() => { load(); }, [tick]);

  const pick = (id) => lots.find((l) => l.id === id) ?? lots.find((l) => (l.lot ?? l.id) === id);

  async function doCount() {
    setMsg("");
    try {
      const lot = pick(count.lotId);
      if (!lot) return setMsg("Pick a lot.");
      const c = startCount({ sku: lot.sku, bin: lot.bin, lot: lot.lot ?? lot.id, expectedQty: lot.remaining, countedQty: Number(count.countedQty), countedBy: count.countedBy || user?.name || "counter", at: new Date().toISOString() });
      const res = applyCount(lot, c);
      await saveQueued(STORES.lots, "lot", res.lot);
      await flush();
      await load();
      setMsg(c.status === "match" ? "Counted — matches the record, no adjustment." : `Counted ${c.status} by ${Math.abs(c.variance)}. Stock now ${res.lot.remaining}.`);
      onChanged?.();
      setCount({ ...count, countedQty: "" });
    } catch (e) { setMsg(e.message); }
  }

  async function doWriteOff() {
    setMsg("");
    try {
      const lot = pick(wo.lotId);
      if (!lot) return setMsg("Pick a lot.");
      const res = writeOff(lot, { qty: Number(wo.qty), reason: wo.reason, by: user?.name ?? "Amanda", at: new Date().toISOString() });
      await saveQueued(STORES.lots, "lot", res.lot);
      await flush();
      await load();
      setMsg(`${res.entry.qty} written off as ${res.entry.reason}. Remaining ${res.lot.remaining}.`);
      onChanged?.();
      setWo({ ...wo, qty: "" });
    } catch (e) { setMsg(e.message); }
  }

  const report = shrinkageReport(lots, { from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(), to: new Date().toISOString() });

  return (
    <>
      <section className="card">
        <h2>Count a lot</h2>
        <div className="grid">
          <label className="field">Lot
            <select value={count.lotId} onChange={(e) => setCount({ ...count, lotId: e.target.value })}>
              <option value="">—</option>
              {lots.map((l) => (<option key={l.id} value={l.id}>{l.sku} · {l.lot ?? l.id} · {l.bin} · {l.remaining} on record</option>))}
            </select>
          </label>
          <label className="field">Counted quantity<input type="number" value={count.countedQty} onChange={(e) => setCount({ ...count, countedQty: e.target.value })} /></label>
          <label className="field">Counted by<input value={count.countedBy} onChange={(e) => setCount({ ...count, countedBy: e.target.value })} /></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}><button className="primary" onClick={doCount} disabled={!count.lotId}>Record count</button></div>
      </section>

      <section className="card">
        <h2>Write off stock</h2>
        <div className="grid">
          <label className="field">Lot
            <select value={wo.lotId} onChange={(e) => setWo({ ...wo, lotId: e.target.value })}>
              <option value="">—</option>
              {lots.map((l) => (<option key={l.id} value={l.id}>{l.sku} · {l.lot ?? l.id} · {l.remaining}</option>))}
            </select>
          </label>
          <label className="field">Quantity<input type="number" value={wo.qty} onChange={(e) => setWo({ ...wo, qty: e.target.value })} /></label>
          <label className="field">Reason
            <select value={wo.reason} onChange={(e) => setWo({ ...wo, reason: e.target.value })}>
              {WRITE_OFF_REASONS.map((r) => (<option key={r}>{r}</option>))}
            </select>
          </label>
        </div>
        <div className="row" style={{ marginTop: 10 }}><button className="primary" onClick={doWriteOff} disabled={!wo.lotId}>Write off</button></div>
        {msg && <div className="notice" style={{ marginTop: 8 }}>{msg}</div>}
      </section>

      <section className="card">
        <h2>Shrinkage this month · {money(report.valueLost, "KES")} lost</h2>
        <div className="kpi">
          {Object.entries(report.byReason).map(([reason, v]) => (<div key={reason}><span>{reason}</span><strong>{v.qty} · {money(v.value, "")}</strong></div>))}
        </div>
        {report.largest ? <p className="hint" style={{ marginTop: 8 }}>Largest loss: {report.largest.qty} of {report.largest.sku} ({report.largest.reason}) at {report.largest.bin}.</p> : <p className="hint" style={{ marginTop: 8 }}>No losses recorded this month.</p>}
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
  async function useBridge() {
    const host = window.location.hostname || "127.0.0.1";
    const url = `http://${host}:8787/v1`;
    const next = { baseUrl: url, apiKey: "local-bridge" };
    setMd(next);
    await setModelConfig(next);
    setMsg(`Connected to the local model bridge at ${url}. The provider key stays on the machine running the bridge; this browser holds none.`);
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
          <button className="ghost" onClick={useBridge}>Use local bridge</button>
          <span className={`pill ${model.live ? "ok" : "warn"}`}>{model.live ? "live" : model.reason}</span>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Four jobs: read a cargo photo, transcribe a voice note, match a lane, explain a quote. None of them sets a price or a date. The key stays on this device. The local bridge runs on your machine, holds the provider key there, and reports in every answer which upstream model actually served it.
        </p>
        {msg && <div className="notice" style={{ marginTop: 10 }}>{msg}</div>}
      </section>
    </>
  );
}

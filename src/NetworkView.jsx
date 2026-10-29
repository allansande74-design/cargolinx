import React, { useEffect, useMemo, useState } from "react";
import { kvGet, kvSet, all, STORES, saveOrder } from "./lib/db.js";

import { AFRICA_26, BLOCS, membershipOf, coverage } from "../engine/network.mjs";
import { gate, coverageWithDatasets, DATASETS } from "../engine/datasets.mjs";
import { PORTS, SEA_LANES, INLAND_LEGS, FACTORY_GATES, planInternational, replan } from "../engine/corridors.mjs";
import { VEHICLE_CLASSES, matchVehicle, splitShipment, costEstimate, capacityCheck, CORRIDORS as FLEET_CORRIDORS } from "../engine/fleet.mjs";
import * as partners from "../engine/partners.mjs";
import * as tracking from "../engine/tracking.mjs";
import * as dispatch from "../engine/dispatch.mjs";

const kes = (n) => (typeof n === "number" ? `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}` : "—");
const hrs = (n) => (typeof n === "number" ? `${n.toLocaleString("en-KE", { maximumFractionDigits: 1 })} h` : "—");
const day = (iso) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) + "Z" : "—");

const ORIGINS = Object.keys(FACTORY_GATES ?? {}).map((k) => FACTORY_GATES[k].city ?? k);
const DESTINATIONS = [...new Set((INLAND_LEGS ?? []).map((l) => l.to))];
const LANES = Object.keys(partners.CORRIDORS ?? {});

export default function NetworkView() {
  const [msg, setMsg] = useState("");
  const [gateCode, setGateCode] = useState("KE");
  const cover = useMemo(() => coverageWithDatasets({ datasets: DATASETS }), []);
  const verdict = useMemo(() => gate(gateCode, { datasets: DATASETS }), [gateCode]);

  // ---- corridor ----
  const [route, setRoute] = useState({ originCity: ORIGINS[0] ?? "Guangzhou", destinationCity: "Nairobi", at: new Date().toISOString().slice(0, 16) });
  const [plan, setPlan] = useState(null);
  const [planError, setPlanError] = useState("");

  function doPlan() {
    setPlanError("");
    try {
      const p = planInternational({ originCity: route.originCity, destinationCity: route.destinationCity, departAt: `${route.at}:00Z` });
      setPlan(p);
      setMsg("");
    } catch (err) {
      setPlan(null);
      setPlanError(err.message);
    }
  }

  function doReplan(hours) {
    if (!plan) return;
    try {
      const next = replan(plan, { at: new Date().toISOString(), delayHours: hours, reason: `carrier advised ${hours} h delay` });
      setPlan(next);
      setMsg(`Replanned: ${hours} h added downstream. ${next.changes?.length ?? 0} legs moved.`);
    } catch (err) {
      setMsg(err.message);
    }
  }

  // ---- fleet ----
  const [cargo, setCargo] = useState({ weightKg: "900", volumeM3: "", corridor: "nairobi_last_mile", distanceKm: "400" });
  const [match, setMatch] = useState(null);
  const [matchError, setMatchError] = useState("");

  function doMatch() {
    setMatchError("");
    setMatch(null);
    try {
      const roadclass = partners.roadClass(cargo.corridor);
      const m = matchVehicle({
        weightKg: Number(cargo.weightKg),
        volumeM3: cargo.volumeM3 === "" ? null : Number(cargo.volumeM3),
        corridor: roadclass,
      });
      const cost = (() => {
        try { return costEstimate(m.vehicle.code, { distanceKm: Number(cargo.distanceKm) }); } catch (e) { return { refused: e.message }; }
      })();
      setMatch({ ...m, roadclass, cost });
    } catch (err) {
      setMatchError(err.message);
    }
  }

  // ---- tracking ----
  const [track, setTrack] = useState(null);
  const [clock, setClock] = useState(0);
  const [trackNote, setTrackNote] = useState("");

  const baseTime = track?.legs?.[0]?.departAt ?? (plan ? plan.legs[0].departAt : null);

  function openTracking() {
    if (!plan) return setTrackNote("Plan a corridor first — tracking needs the legs and their schedule.");
    try {
      const t = tracking.openTrack({ shipmentId: `SHP-${String(Date.now()).slice(-6)}`, legs: plan.legs, at: baseTime });
      setTrack(t);
      setClock(0);
      setTrackNote("Tracking open. Apply milestones as the carrier reports them.");
    } catch (err) {
      setTrackNote(err.message);
    }
  }

  function step(minutes) {
    if (!track) return;
    setClock((c) => c + minutes);
  }

  function applyMilestone(milestone) {
    if (!track) return;
    const at = new Date(new Date(baseTime).getTime() + clock * 60000).toISOString();
    try {
      const res = tracking.applyTrackingEvent(track, { milestone, at, leg: 0, source: "carrier feed", id: `${milestone}-${clock}` });
      setTrack(res.track);
      setTrackNote(
        res.status === "applied"
          ? `${milestone} applied at ${day(at)}${res.released?.length ? `, releasing ${res.released.map((r) => r.milestone).join(", ")} from the hold queue` : ""}.`
          : res.status === "held"
            ? `${milestone} held: waiting for ${res.waitingFor?.join(", ")}. It will release itself when the gap fills — nothing is lost.`
            : `Refused: ${res.refusal?.reason ?? res.refusal?.code}.`,
      );
    } catch (err) {
      setTrackNote(err.message);
    }
  }

  function raiseException(kind, severity) {
    if (!track) return;
    const at = new Date(new Date(baseTime).getTime() + clock * 60000).toISOString();
    const next = tracking.exceptionOn(track, { at, kind, detail: `Recorded from the network screen (${kind})`, severity });
    setTrack(next);
    setTrackNote(`Exception recorded: ${kind} (${severity}). Stall escalation on this leg is paused until it is resolved.`);
  }

  const stalls = track ? tracking.detectStalls(track, { at: new Date(new Date(baseTime).getTime() + (clock + 60) * 60000).toISOString() }) : [];
  const health = track ? tracking.health(track, { at: new Date(new Date(baseTime).getTime() + (clock + 60) * 60000).toISOString() }) : null;

  // ---- partners ----
  const [fleetBook, setFleetBook] = useState([]);
  const [pForm, setPForm] = useState({ ownerName: "", country: "KE", contact: "+254", plate: "", classCode: "heavy_truck", capacityKg: "28000", corridor: "northern" });
  const [activeId, setActiveId] = useState("");
  const [docForm, setDocForm] = useState({ type: "insurance", reference: "", expiresAt: "" });
  const [approval, setApproval] = useState({ by: "Allan", reference: "" });
  const [elig, setElig] = useState({ at: new Date().toISOString().slice(0, 10), corridor: "northern", weightKg: "20000" });
  const [eligResult, setEligResult] = useState(null);
  const [book, setBook] = useState({ from: "", to: "", orderId: "" });

  useEffect(() => { (async () => setFleetBook((await kvGet("networkPartners")) ?? []))(); }, []);
  const saveBook = async (next, note) => { setFleetBook(next); await kvSet("networkPartners", next); setMsg(note); };

  const active = fleetBook.find((p) => p.id === activeId) ?? null;

  async function register(e) {
    e.preventDefault();
    try {
      const p = partners.registerPartner({
        ownerName: pForm.ownerName,
        country: pForm.country,
        contact: pForm.contact,
        fleet: [{ plate: pForm.plate, classCode: pForm.classCode, capacityKg: Number(pForm.capacityKg), corridors: [pForm.corridor] }],
      });
      await saveBook([...fleetBook, p], `${p.ownerName} registered as pending. A transport owner cannot be born trusted.`);
      setActiveId(p.id);
      setPForm({ ...pForm, ownerName: "", plate: "" });
    } catch (err) { setMsg(err.message); }
  }

  async function verifyDoc(e) {
    e.preventDefault();
    if (!active) return setMsg("Select a partner first.");
    try {
      const plate = active.fleet[0].plate;
      const next = partners.verifyDocument(active, { plate, type: docForm.type, reference: docForm.reference, expiresAt: docForm.expiresAt, verifiedBy: "Amanda" });
      await saveBook(fleetBook.map((p) => (p.id === next.id ? next : p)), `${docForm.type} verified for ${plate} against ${docForm.reference}, expiring ${docForm.expiresAt}.`);
      setDocForm({ ...docForm, reference: "", expiresAt: "" });
    } catch (err) { setMsg(err.message); }
  }

  async function approve() {
    if (!active) return setMsg("Select a partner first.");
    try {
      const next = partners.approvePartner(active, { by: approval.by, reference: approval.reference });
      await saveBook(fleetBook.map((p) => (p.id === next.id ? next : p)), `${next.ownerName} approved against ${approval.reference}.`);
      setApproval({ ...approval, reference: "" });
    } catch (err) { setMsg(err.message); }
  }

  function checkEligibility() {
    if (!active) return setMsg("Select a partner first.");
    try {
      setEligResult(partners.eligibility(active, { plate: active.fleet[0].plate, at: `${elig.at}T00:00:00Z`, corridor: elig.corridor, weightKg: Number(elig.weightKg) }));
    } catch (err) { setMsg(err.message); }
  }

  async function reserve() {
    if (!active) return setMsg("Select a partner first.");
    try {
      const next = partners.bookWindow(active, { plate: active.fleet[0].plate, from: `${book.from}T00:00:00Z`, to: `${book.to}T00:00:00Z`, orderId: book.orderId, now: new Date().toISOString() });
      await saveBook(fleetBook.map((p) => (p.id === next.id ? next : p)), `Window booked for ${book.orderId}.`);
    } catch (err) { setMsg(err.message); }
  }

  // ---- dispatch: order -> vehicle -> booked window -> track ----
  const [dOrders, setDOrders] = useState([]);
  const [dPick, setDPick] = useState("");
  const [dForm, setDForm] = useState({
    weightKg: "900",
    lane: "nairobi_last_mile",
    driverName: "",
    distanceKm: "400",
    at: new Date().toISOString().slice(0, 10),
  });
  const [dResult, setDResult] = useState(null);
  const [dError, setDError] = useState("");

  useEffect(() => {
    (async () => {
      const stored = ((await all(STORES.orders)) ?? []).filter((o) => dispatch.readyFrom(o.type).includes(o.stage));
      setDOrders(stored);
      if (stored[0]) setDPick(stored[0].id);
    })();
  }, []);

  function useDemoOrder() {
    const demo = {
      id: `ord_demo${Date.now().toString(36).slice(-4)}`,
      accountId: "acc_seed01",
      type: "import",
      stage: "packed",
      lines: [{ description: "SP450 solar floodlight", qty: 20, unitPriceKes: 4500 }],
      destination: { city: "Nairobi", address: "Industrial Area, Nairobi" },
      promisedAt: "2026-11-06T09:00:00.000Z",
      pickedQty: 20,
      packedQty: 20,
    };
    setDOrders([demo, ...dOrders.filter((o) => o.id !== demo.id)]);
    setDPick(demo.id);
    setDError("");
    setDResult(null);
  }

  async function runDispatch() {
    setDResult(null);
    setDError("");
    const order = dOrders.find((o) => o.id === dPick);
    if (!order) return setDError("Choose an order that is packed or on arrival first.");
    try {
      const result = dispatch.dispatchOrder(order, {
        partners: fleetBook,
        weightKg: Number(dForm.weightKg),
        lane: dForm.lane,
        driverName: dForm.driverName,
        distanceKm: dForm.distanceKm === "" ? null : Number(dForm.distanceKm),
        at: `${dForm.at}T08:00:00Z`,
      });
      setDResult(result);
      if (result.ok) {
        await saveBook(
          fleetBook.map((p) => (p.id === result.partner.id ? result.partner : p)),
          `${result.order.id} dispatched on ${result.vehicle.plate} with ${result.partner.ownerName}.`,
        );
        await saveOrder(result.order);
        setActiveId(result.partner.id);
        setTrack(result.track);
        setClock(0);
        setTrackNote(`Tracking is open on ${result.order.trackingRef}, carried by ${result.vehicle.plate}. Report milestones as the carrier calls them; anything out of order is held and releases itself.`);
      }
    } catch (err) {
      setDError(err.message);
    }
  }

  return (
    <>
      <section className="card">
        <h2>Network coverage</h2>
        <p>{cover.statement}</p>
        <p className="muted">
          {cover.total} countries · {cover.byBloc.EAC} EAC · {cover.byBloc.COMESA} COMESA · {cover.byBloc.SADC} SADC. Coverage is not the same as
          quotability: a country on this map can carry a shipment, but only a country with a verified dataset can produce a duty figure.
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {AFRICA_26.map((c) => (
            <button key={c.code} type="button" className={c.code === gateCode ? "primary" : ""} onClick={() => setGateCode(c.code)} title={c.citations?.[0] ?? ""}>
              {c.code} {c.datasetStatus === "verified" ? "✓" : "·"}
            </button>
          ))}
        </div>
        <div className={verdict.ok ? "notice" : "warning"} style={{ marginTop: 10 }}>
          {verdict.ok ? `Quotable. ${verdict.statement}` : `Refused. ${verdict.reason}`}
        </div>
        {!verdict.ok && (
          <p className="muted" style={{ marginTop: 6 }}>
            What unlocks it: one dataset per country — tariff at HS heading level, import VAT, the specific levies, the preferential agreement text,
            the customs system and whether agent access exists, the insurance minimum — each recorded with its source and effective date.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Corridor plan</h2>
        <div className="grid">
          <label className="field">Origin
            <select value={route.originCity} onChange={(e) => setRoute({ ...route, originCity: e.target.value })}>
              {ORIGINS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
          <label className="field">Destination
            <select value={route.destinationCity} onChange={(e) => setRoute({ ...route, destinationCity: e.target.value })}>
              {DESTINATIONS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
          <label className="field">Departure (UTC)
            <input type="datetime-local" value={route.at} onChange={(e) => setRoute({ ...route, at: e.target.value })} />
          </label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" type="button" onClick={doPlan}>Plan the move</button>
          {plan && <button type="button" onClick={() => doReplan(24)}>+24 h delay</button>}
          {plan && <button type="button" onClick={() => doReplan(72)}>+72 h delay</button>}
        </div>
        {planError && <div className="warning" style={{ marginTop: 8 }}>{planError}</div>}
        {plan && (
          <>
            <p style={{ marginTop: 10 }}>
              Arrives <strong>{day(plan.arriveAt)}</strong> · {hrs(plan.totalHours)} door to door · confidence <strong>{plan.confidence}</strong>
            </p>
            <ol>
              {plan.legs.map((l, i) => (
                <li key={i}>
                  {l.mode} · {l.from} → {l.to} · {hrs(l.hours)} · departs {day(l.departAt)} · {l.confidence}
                </li>
              ))}
            </ol>
            {plan.customsStops?.length > 0 && <p className="muted">{plan.customsStops.length} customs stops: {plan.customsStops.map((s) => `${s.at} (${hrs(s.hours)})`).join(", ")}.</p>}
            {plan.assumptions?.length > 0 && <p className="muted">Assumptions: {plan.assumptions.join(" ")}</p>}
          </>
        )}
      </section>

      <section className="card">
        <h2>Vehicle match</h2>
        <div className="grid">
          <label className="field">Weight (kg)<input value={cargo.weightKg} onChange={(e) => setCargo({ ...cargo, weightKg: e.target.value })} /></label>
          <label className="field">Volume (m³, optional)<input value={cargo.volumeM3} onChange={(e) => setCargo({ ...cargo, volumeM3: e.target.value })} /></label>
          <label className="field">Corridor
            <select value={cargo.corridor} onChange={(e) => setCargo({ ...cargo, corridor: e.target.value })}>
              {LANES.map((c) => <option key={c} value={c}>{partners.CORRIDORS[c].label}</option>)}
            </select>
          </label>
          <label className="field">Distance for costing (km)<input value={cargo.distanceKm} onChange={(e) => setCargo({ ...cargo, distanceKm: e.target.value })} /></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}><button className="primary" type="button" onClick={doMatch}>Match a vehicle</button></div>
        {matchError && <div className="warning" style={{ marginTop: 8 }}>{matchError}</div>}
        {match && (
          <div style={{ marginTop: 10 }}>
            <p><strong>{match.vehicle.label}</strong> · {match.vehicle.payloadKg.toLocaleString()} kg / {match.vehicle.volumeM3} m³ · road class {match.roadclass} · weight used {match.utilisationKgPct}%{match.utilisationM3Pct !== null ? ` · volume used ${match.utilisationM3Pct}%` : ""}</p>
            <p className="muted">{match.vehicle.axleOrWheelBaseNote}</p>
            <p>{match.cost.refused ? `Costing refused: ${match.cost.refused}` : `Freight estimate ${kes(match.cost.freightKes ?? match.cost.totalKes)} for ${cargo.distanceKm} km${match.cost.rateSource ? ` (${match.cost.rateSource})` : ""}.`}</p>
            {match.alternatives?.length > 0 && <p className="muted">Alternatives, larger only: {match.alternatives.map((a) => a.code ?? a.label).join(", ")}.</p>}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Tracking and recovery</h2>
        <div className="row">
          <button type="button" onClick={openTracking} disabled={!plan}>Open tracking on this plan</button>
          <button type="button" onClick={() => step(180)} disabled={!track}>+3 h</button>
          <button type="button" onClick={() => step(1440)} disabled={!track}>+1 day</button>
          <button type="button" onClick={() => step(2880)} disabled={!track}>+2 days</button>
        </div>
        {track && (
          <>
            <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 6 }}>
              {tracking.MILESTONES.filter((m) => m !== "EXCEPTION").map((m) => (
                <button key={m} type="button" onClick={() => applyMilestone(m)}>{m.replaceAll("_", " ")}</button>
              ))}
            </div>
            <div className="row" style={{ marginTop: 6, flexWrap: "wrap", gap: 6 }}>
              <button type="button" onClick={() => raiseException("customs_hold", "major")}>Customs hold</button>
              <button type="button" onClick={() => raiseException("breakdown", "critical")}>Breakdown</button>
              <button type="button" onClick={() => { const next = tracking.resolveException(track, { id: track.exceptions.find((x) => !x.resolvedAt)?.id, at: new Date(new Date(baseTime).getTime() + clock * 60000).toISOString(), resolution: "Released by customs after document review" }); setTrack(next); setTrackNote("Exception resolved; escalation resumes."); }}>Resolve exception</button>
            </div>
            <p style={{ marginTop: 10 }}>
              Health <strong>{health?.state}</strong> · open exceptions {health?.openExceptions ?? 0} · late legs {health?.lateLegs ?? 0} · held events {(track.pending ?? []).length} · history {track.history?.length ?? 0}
            </p>
            {stalls.length > 0 && (
              <ul>
                {stalls.map((s, i) => <li key={i}>Leg {s.leg} is {s.hoursLate} h late — {s.severity} (expected {day(s.expectedArriveAt)})</li>)}
              </ul>
            )}
            {(track.exceptions ?? []).length > 0 && <p className="muted">Exceptions: {track.exceptions.map((x) => `${x.kind}/${x.severity}${x.resolvedAt ? " resolved" : " open"}`).join(", ")}.</p>}
          </>
        )}
        {trackNote && <div className="notice" style={{ marginTop: 8 }}>{trackNote}</div>}
      </section>

      <section className="card">
        <h2>Transport partners</h2>
        <form onSubmit={register}>
          <div className="grid">
            <label className="field">Owner<input value={pForm.ownerName} onChange={(e) => setPForm({ ...pForm, ownerName: e.target.value })} placeholder="Otieno Haulage" /></label>
            <label className="field">Country<input value={pForm.country} maxLength={2} onChange={(e) => setPForm({ ...pForm, country: e.target.value.toUpperCase() })} /></label>
            <label className="field">Contact<input value={pForm.contact} onChange={(e) => setPForm({ ...pForm, contact: e.target.value })} /></label>
            <label className="field">Plate<input value={pForm.plate} onChange={(e) => setPForm({ ...pForm, plate: e.target.value })} placeholder="KDA 123A" /></label>
            <label className="field">Class
              <select value={pForm.classCode} onChange={(e) => setPForm({ ...pForm, classCode: e.target.value })}>
                {VEHICLE_CLASSES.map((v) => <option key={v.code} value={v.code}>{v.label}{v.status === "future" ? " (future)" : ""}</option>)}
              </select>
            </label>
            <label className="field">Capacity (kg)<input value={pForm.capacityKg} onChange={(e) => setPForm({ ...pForm, capacityKg: e.target.value })} /></label>
            <label className="field">Corridor
              <select value={pForm.corridor} onChange={(e) => setPForm({ ...pForm, corridor: e.target.value })}>
                {LANES.map((c) => <option key={c} value={c}>{partners.CORRIDORS[c].label}</option>)}
              </select>
            </label>
          </div>
          <div className="row" style={{ marginTop: 10 }}><button className="primary" type="submit">Register owner</button></div>
        </form>

        {fleetBook.length > 0 && (
          <>
            <label className="field" style={{ marginTop: 12 }}>Working partner
              <select value={activeId} onChange={(e) => { setActiveId(e.target.value); setEligResult(null); }}>
                <option value="">— pick one —</option>
                {fleetBook.map((p) => <option key={p.id} value={p.id}>{p.ownerName} · {p.fleet?.[0]?.plate} · {p.status}</option>)}
              </select>
            </label>

            {active && (
              <>
                <form onSubmit={verifyDoc} style={{ marginTop: 10 }}>
                  <div className="grid">
                    <label className="field">Document
                      <select value={docForm.type} onChange={(e) => setDocForm({ ...docForm, type: e.target.value })}>
                        {Object.keys(partners.REQUIRED_DOCUMENTS).map((t) => <option key={t} value={t}>{partners.REQUIRED_DOCUMENTS[t].label}</option>)}
                      </select>
                    </label>
                    <label className="field">Reference<input value={docForm.reference} onChange={(e) => setDocForm({ ...docForm, reference: e.target.value })} placeholder="Certificate number" /></label>
                    <label className="field">Expires<input type="date" value={docForm.expiresAt} onChange={(e) => setDocForm({ ...docForm, expiresAt: e.target.value })} /></label>
                  </div>
                  <div className="row" style={{ marginTop: 8 }}><button type="submit">Verify document</button></div>
                </form>

                <div className="row" style={{ marginTop: 8 }}>
                  <input placeholder="Approval reference (e.g. KRA PIN)" value={approval.reference} onChange={(e) => setApproval({ ...approval, reference: e.target.value })} />
                  <button type="button" onClick={approve}>Approve partner</button>
                </div>

                <div className="grid" style={{ marginTop: 10 }}>
                  <label className="field">Eligibility date<input type="date" value={elig.at} onChange={(e) => setElig({ ...elig, at: e.target.value })} /></label>
                  <label className="field">Corridor
                    <select value={elig.corridor} onChange={(e) => setElig({ ...elig, corridor: e.target.value })}>
                      {LANES.map((c) => <option key={c} value={c}>{partners.CORRIDORS[c].label}</option>)}
                    </select>
                  </label>
                  <label className="field">Cargo weight (kg)<input value={elig.weightKg} onChange={(e) => setElig({ ...elig, weightKg: e.target.value })} /></label>
                </div>
                <div className="row" style={{ marginTop: 8 }}><button type="button" onClick={checkEligibility}>Check eligibility</button></div>
                {eligResult && (
                  <div className={eligResult.eligible ? "notice" : "warning"} style={{ marginTop: 8 }}>
                    {eligResult.eligible
                      ? "Eligible to be dispatched on that lane."
                      : `${eligResult.blockers.length} blocker${eligResult.blockers.length === 1 ? "" : "s"}:`}
                    {!eligResult.eligible && <ul>{eligResult.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>}
                  </div>
                )}

                <div className="grid" style={{ marginTop: 10 }}>
                  <label className="field">Book from<input type="date" value={book.from} onChange={(e) => setBook({ ...book, from: e.target.value })} /></label>
                  <label className="field">Book to<input type="date" value={book.to} onChange={(e) => setBook({ ...book, to: e.target.value })} /></label>
                  <label className="field">Order<input value={book.orderId} onChange={(e) => setBook({ ...book, orderId: e.target.value })} placeholder="ord_…" /></label>
                </div>
                <div className="row" style={{ marginTop: 8 }}><button type="button" onClick={reserve}>Book window</button></div>

                <p className="muted" style={{ marginTop: 8 }}>
                  {active.fleet?.[0]?.plate}: {Object.entries(active.fleet?.[0]?.documents ?? {}).filter(([, d]) => d?.status === "verified").length} documents verified.
                </p>
                {(() => {
                  const plate = active.fleet?.[0]?.plate;
                  const mine = (active.bookings ?? []).filter((b) => b.plate === plate);
                  return mine.length === 0
                    ? <p className="muted">No windows booked on {plate}.</p>
                    : (
                      <ul>
                        {mine.map((b) => (
                          <li key={`${b.orderId}-${b.from}`}>{b.orderId}: {day(b.from)} → {day(b.to)}</li>
                        ))}
                      </ul>
                    );
                })()}
              </>
            )}
          </>
        )}
        {msg && <div className="notice" style={{ marginTop: 8 }}>{msg}</div>}
      </section>

      <section className="card">
        <h2>Dispatch</h2>
        <p className="muted">
          One thread from an order that is ready to move: the load is matched to a vehicle class, the smallest eligible
          registered vehicle is booked for the window, the order is marked dispatched and the track opens on the same legs.
          A partner is only offered if it is approved, its papers are valid on that date and its vehicle is registered for
          that lane.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <label>
            Order
            <select value={dPick} onChange={(e) => { setDPick(e.target.value); setDResult(null); }}>
              <option value="">— choose —</option>
              {dOrders.map((o) => (
                <option key={o.id} value={o.id}>{o.id} · {o.stage} · {o.type}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={useDemoOrder}>Add a demonstration order</button>
        </div>
        {dOrders.length === 0 && (
          <p className="hint">No order is packed or on arrival in this browser. Place and pack an order on the Orders tab, or add a demonstration order to exercise the flow.</p>
        )}
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <label>
            Weight (kg)
            <input value={dForm.weightKg} onChange={(e) => setDForm({ ...dForm, weightKg: e.target.value })} inputMode="numeric" />
          </label>
          <label>
            Lane
            <select value={dForm.lane} onChange={(e) => setDForm({ ...dForm, lane: e.target.value })}>
              {Object.keys(partners.CORRIDORS).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            Driver
            <input value={dForm.driverName} onChange={(e) => setDForm({ ...dForm, driverName: e.target.value })} placeholder="Full name" />
          </label>
          <label>
            Distance (km)
            <input value={dForm.distanceKm} onChange={(e) => setDForm({ ...dForm, distanceKm: e.target.value })} inputMode="numeric" />
          </label>
          <label>
            Dispatch date
            <input type="date" value={dForm.at} onChange={(e) => setDForm({ ...dForm, at: e.target.value })} />
          </label>
          <button type="button" className="primary" onClick={runDispatch}>Dispatch</button>
        </div>

        {dError && <div className="warning" style={{ marginTop: 10 }}>{dError}</div>}

        {dResult && !dResult.ok && (
          <div className="warning" style={{ marginTop: 10 }}>
            <strong>Refused.</strong> {dResult.refusals?.[0]?.message}
            {dResult.refusals?.[0]?.candidates?.length > 0 && (
              <ul>
                {dResult.refusals[0].candidates.map((c) => <li key={c}>{c}</li>)}
              </ul>
            )}
          </div>
        )}

        {dResult && dResult.ok && (
          <div className="notice" style={{ marginTop: 10 }}>
            <p><strong>{dispatch.dispatchSummary(dResult)}</strong></p>
            <ul>
              <li>Order {dResult.order.id} is now at {dResult.order.stage}; job {dResult.job.id} carries reference {dResult.job.trackingRef}.</li>
              <li>Vehicle {dResult.vehicle.plate} — {dResult.vehicle.classCode}, {dResult.vehicle.capacityKg?.toLocaleString?.("en-KE") ?? dResult.vehicle.capacityKg} kg registration, owner {dResult.partner.ownerName}.</li>
              {dResult.booking && <li>Booked {day(dResult.booking.from)} → {day(dResult.booking.to)} for {dResult.booking.orderId}.</li>}
              {dResult.track?.legs?.length > 0 && (
                <li>
                  Track {dResult.track.shipmentId}: {dResult.track.legs.length} leg{dResult.track.legs.length > 1 ? "s" : ""}, first leg{" "}
                  {hrs((Date.parse(dResult.track.legs[0].arriveAt) - Date.parse(dResult.track.legs[0].departAt)) / 3600000)} ({day(dResult.track.legs[0].departAt)} → {day(dResult.track.legs[0].arriveAt)}).
                </li>
              )}
              <li>{dResult.estimate ? `Planning estimate ${kes(dResult.estimate.freightKes)} — ${dResult.estimate.basis?.join(", ")}. ${dResult.estimateNote}` : dResult.estimateNote}</li>
              {dResult.refusedAlternatives?.length > 0 && (
                <li>{dResult.refusedAlternatives.length} other vehicle{dResult.refusedAlternatives.length > 1 ? "s" : ""} refused: {dResult.refusedAlternatives.map((r) => `${r.plate} (${r.blockers[0] ?? "not eligible"})`).join("; ")}.</li>
              )}
            </ul>
            <p className="muted">The tracking panel above accepts this reference — report departure, gate-in and load events against it.</p>
          </div>
        )}
      </section>
    </>
  );
}

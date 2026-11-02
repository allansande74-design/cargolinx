import React, { useEffect, useMemo, useState } from "react";
import {
  createAssignment, snapshot, completeMilestone, markReportSent, recordDelay,
  formatEat, nowEat,
} from "../engine/deadlines.mjs";

const STORE = "cargolinx.deadlines.v1";

const COLOURS = {
  "on-track": { bar: "#1f7a4d", chip: "#e6f4ec", text: "#14532d", label: "On track" },
  "due-soon": { bar: "#b45309", chip: "#fef3c7", text: "#78350f", label: "Due soon" },
  "at-risk": { bar: "#b91c1c", chip: "#fee2e2", text: "#7f1d1d", label: "At risk" },
  overdue: { bar: "#7f1d1d", chip: "#fecaca", text: "#450a0a", label: "Overdue" },
};

function load() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return JSON.parse(raw);
  } catch { /* fall through to seed */ }
  return seed();
}

function seed() {
  const now = Date.now();
  const iso = (msAhead) => new Date(now + msAhead * 86400000).toISOString();
  return [
    {
      id: "HACK-001",
      title: "Meta Global AI Developer Hackathon — CargoLinx submission",
      client: "Meta",
      deadline: "2026-11-04T09:00:00Z",
      startedAt: iso(-9),
      milestones: [
        { name: "Demo filmed and voiced", at: "2026-11-03T15:00:00Z", owner: "Amanda", doneAt: null, order: 0 },
        { name: "Submission pack assembled", at: "2026-11-04T06:00:00Z", owner: "Amanda", doneAt: null, order: 1 },
        { name: "Submitted on the portal", at: "2026-11-04T09:00:00Z", owner: "Mr. Allan", doneAt: null, order: 2 },
      ],
      reports: [
        { label: "T-7", daysBefore: 7, sentAt: null },
        { label: "T-3", daysBefore: 3, sentAt: null },
        { label: "T-1", daysBefore: 1, sentAt: null },
        { label: "T-0", daysBefore: 0, sentAt: null },
      ],
      delays: [],
    },
    {
      id: "MIL-001",
      title: "Milicons sports equipment — re-issue proformas and close suppliers",
      client: "Milicons Ltd",
      deadline: "2026-11-09T14:00:00Z",
      startedAt: iso(-2),
      milestones: [
        { name: "Qiangmeng buying price answered", at: "2026-11-05T12:00:00Z", owner: "Amanda", doneAt: null, order: 0 },
        { name: "Fresh supplier quotes in", at: "2026-11-06T15:00:00Z", owner: "Amanda", doneAt: null, order: 1 },
        { name: "Corrected proformas approved", at: "2026-11-08T12:00:00Z", owner: "Mr. Allan", doneAt: null, order: 2 },
        { name: "Proformas with the client", at: "2026-11-09T14:00:00Z", owner: "Amanda", doneAt: null, order: 3 },
      ],
      reports: [
        { label: "T-7", daysBefore: 7, sentAt: null },
        { label: "T-3", daysBefore: 3, sentAt: null },
        { label: "T-1", daysBefore: 1, sentAt: null },
        { label: "T-0", daysBefore: 0, sentAt: null },
      ],
      delays: [],
    },
  ];
}

const s = {
  wrap: { padding: "18px 20px 40px" },
  clockRow: { display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 14 },
  clock: { fontSize: 34, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.5px" },
  clockSub: { fontSize: 12.5, opacity: 0.72 },
  card: { border: "1px solid rgba(0,0,0,.12)", borderRadius: 12, padding: "14px 16px", marginBottom: 12, background: "#fff" },
  head: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" },
  title: { fontSize: 15.5, fontWeight: 650, margin: 0 },
  client: { fontSize: 12.5, opacity: 0.7, marginTop: 2 },
  chip: { fontSize: 11.5, fontWeight: 650, padding: "3px 9px", borderRadius: 999 },
  cd: { fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", margin: "10px 0 2px" },
  track: { height: 7, borderRadius: 999, background: "rgba(0,0,0,.08)", overflow: "hidden", margin: "8px 0 12px" },
  meta: { fontSize: 12.5, opacity: 0.82, display: "grid", gap: 4 },
  msRow: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "3px 0" },
  btn: { fontSize: 12, padding: "3px 9px", borderRadius: 7, border: "1px solid rgba(0,0,0,.2)", background: "#fff", cursor: "pointer" },
  form: { display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, alignItems: "end" },
  inp: { fontSize: 13, padding: "7px 9px", borderRadius: 8, border: "1px solid rgba(0,0,0,.2)", width: "100%", boxSizing: "border-box" },
  lbl: { fontSize: 11.5, opacity: 0.7, display: "block", marginBottom: 3 },
};

export default function Deadlines() {
  const [items, setItems] = useState(load);
  const [tick, setTick] = useState(Date.now());
  const [draft, setDraft] = useState({ title: "", client: "", deadline: "", milestone: "" });

  useEffect(() => { localStorage.setItem(STORE, JSON.stringify(items)); }, [items]);
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const rows = useMemo(
    () => items.map((a) => snapshot(a, tick)).sort((x, y) => x.leftMs - y.leftMs),
    [items, tick],
  );

  function update(id, fn) {
    setItems((prev) => prev.map((a) => (a.id === id ? fn(a) : a)));
  }

  function add() {
    const id = `ASG-${String(items.length + 1).padStart(3, "0")}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const deadline = draft.deadline ? new Date(draft.deadline).toISOString() : new Date(Date.now() + 7 * 86400000).toISOString();
    const milestones = draft.milestone
      ? [{ name: draft.milestone, at: deadline, owner: "Amanda" }]
      : [];
    setItems((prev) => [...prev, createAssignment({ id, title: draft.title || "Untitled assignment", client: draft.client || null, deadline, milestones })]);
    setDraft({ title: "", client: "", deadline: "", milestone: "" });
  }

  const anyAtRisk = rows.some((r) => r.state === "at-risk" || r.state === "overdue");

  return (
    <div style={s.wrap}>
      <div style={s.clockRow}>
        <div style={s.clock}>{nowEat(tick)}</div>
        <div style={s.clockSub}>
          East Africa Time · every assignment carries a clock, a calendar and a client reporting cadence
          (T-7 / T-3 / T-1 / T-0) · {rows.length} live assignment{rows.length === 1 ? "" : "s"}
          {anyAtRisk ? " · one or more need attention now" : " · all inside their windows"}
        </div>
      </div>

      {rows.map((r) => {
        const c = COLOURS[r.state] || COLOURS["on-track"];
        return (
          <div key={r.id} style={s.card}>
            <div style={s.head}>
              <div>
                <p style={s.title}>{r.title}</p>
                <div style={s.client}>{r.client || "Internal"} · {r.id}</div>
              </div>
              <span style={{ ...s.chip, background: c.chip, color: c.text }}>{c.label}</span>
            </div>

            <div style={{ ...s.cd, color: c.bar }}>{r.countdown}</div>
            <div style={s.clockSub}>Deadline {r.deadlineEat}</div>
            <div style={s.track}>
              <div style={{ width: `${r.progressPct}%`, height: "100%", background: c.bar }} />
            </div>

            <div style={s.meta}>
              {r.nextMilestone ? (
                <div>Next: <strong>{r.nextMilestone.name}</strong> — {r.nextMilestone.atEat}{r.nextMilestone.owner ? ` · ${r.nextMilestone.owner}` : ""}</div>
              ) : (
                <div>All milestones closed.</div>
              )}
              {r.overdueMilestones > 0 && (
                <div style={{ color: "#b91c1c" }}>{r.overdueMilestones} milestone(s) past due and open</div>
              )}
              <div>Reports due now: {r.reportsDue.length ? r.reportsDue.map((x) => x.label).join(", ") : "none"}</div>
            </div>

            <Milestones item={items.find((x) => x.id === r.id)} onDone={(name) => update(r.id, (a) => completeMilestone(a, name))} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {(items.find((x) => x.id === r.id)?.reports ?? []).map((rep) => (
                <button
                  key={rep.label}
                  style={{ ...s.btn, opacity: rep.sentAt ? 0.5 : 1 }}
                  onClick={() => update(r.id, (a) => markReportSent(a, rep.label))}
                  title={rep.sentAt ? `sent ${formatEat(rep.sentAt)}` : "mark this client report as sent"}
                >
                  {rep.label} {rep.sentAt ? "✓" : ""}
                </button>
              ))}
              <button
                style={s.btn}
                onClick={() => {
                  const reason = window.prompt("External factor (named):", "KRA system outage");
                  if (!reason) return;
                  const evidence = window.prompt("Evidence reference (ticket, notice, advisory):", "");
                  if (!evidence) return;
                  update(r.id, (a) => recordDelay(a, { reason, evidence }));
                }}
              >
                Record an excusable delay
              </button>
            </div>
          </div>
        );
      })}

      <div style={{ ...s.card, marginTop: 18 }}>
        <p style={{ ...s.title, marginBottom: 10 }}>Put a new assignment on the clock</p>
        <div style={s.form}>
          <label><span style={s.lbl}>Assignment</span>
            <input style={s.inp} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Supply 2 technical benches to Milicons" />
          </label>
          <label><span style={s.lbl}>Client</span>
            <input style={s.inp} value={draft.client} onChange={(e) => setDraft({ ...draft, client: e.target.value })} placeholder="Milicons Ltd" />
          </label>
          <label><span style={s.lbl}>Deadline (EAT)</span>
            <input type="datetime-local" style={s.inp} value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} />
          </label>
          <button style={{ ...s.btn, padding: "9px 14px" }} onClick={add}>Add to the clock</button>
        </div>
      </div>
    </div>
  );
}

function Milestones({ item, onDone }) {
  if (!item) return null;
  return (
    <div style={{ marginTop: 10 }}>
      {(item.milestones ?? []).map((m) => (
        <div key={m.name} style={s.msRow}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: m.doneAt ? "#1f7a4d" : Date.now() > Date.parse(m.at) ? "#b91c1c" : "#9ca3af" }} />
          <span style={{ textDecoration: m.doneAt ? "line-through" : "none", opacity: m.doneAt ? 0.6 : 1 }}>
            {m.name} — {formatEat(m.at)}{m.owner ? ` · ${m.owner}` : ""}
          </span>
          {!m.doneAt && <button style={s.btn} onClick={() => onDone(m.name)}>done</button>}
        </div>
      ))}
    </div>
  );
}

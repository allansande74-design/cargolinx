/**
 * Desk intelligence: what the models are, and one honest demonstration of them working together.
 *
 * The fan-out asks three Spark generations the same question at the same moment, then hands the three
 * answers, blind, to Muse Wonder to judge. Nothing here prices anything: the engine owns every figure,
 * which is why a judge can change the wording of a quote and never its number.
 *
 * Muse Image draws the load on the same screen, because a picture of a pallet beats a paragraph about one.
 */
import React, { useEffect, useMemo, useState } from "react";
import { LANES } from "../engine/lanes.mjs";
import { BUSINESS_AGENTS, planWorkflow, validateAgentRegistry } from "./lib/multi-agent.mjs";
import {
  DRAFTS, JUDGE, classifyModels, draftPrompt, judgePrompt, winnerFrom, fanOutSummary,
} from "./lib/intel.mjs";

const laneNames = Object.keys(LANES);
const kmOf = (name) => (LANES[name] ?? []).reduce((n, leg) => n + (Number(leg.km) || 0), 0);

async function askOne(model, prompt) {
  const started = performance.now();
  const res = await fetch("/api/meta/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 800,
      reasoning_effort: "minimal",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { model, text: "", ms: 0, error: `HTTP ${res.status} ${body.slice(0, 120)}` };
  }
  const payload = await res.json();
  const text = (payload?.choices?.[0]?.message?.content ?? "").trim();
  return { model, text, ms: Math.round(performance.now() - started), tokens: payload?.usage?.total_tokens ?? null };
}

/**
 * Muse Wonder reasons before it writes, and on three real drafts that reasoning alone ran past a 1,200
 * token ceiling and came back with finish_reason "length" and no words. Measured on the live endpoint:
 * the same drafts answered in 142 characters at 600 tokens with reasoning_effort "minimal". So the
 * judge is asked to reason lightly — it still chooses, it just leaves room to say which one.
 */
async function judge(drafts) {
  const ask = async (body) => {
    const res = await fetch("/api/meta/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: JUDGE, messages: [{ role: "user", content: judgePrompt(drafts) }], ...body }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error?.message ?? `the judge answered HTTP ${res.status}`);
    return (payload?.choices?.[0]?.message?.content ?? "").trim();
  };
  const first = await ask({ max_tokens: 700, reasoning_effort: "minimal" });
  if (first) return first;
  const second = await ask({ max_tokens: 1200 });
  if (!second) throw new Error("the judge used its whole allowance thinking and returned no words");
  return second;
}

export default function IntelView() {
  const [models, setModels] = useState([]);
  const [lane, setLane] = useState("Nairobi - Kampala");
  const [running, setRunning] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [verdict, setVerdict] = useState("");
  const [error, setError] = useState("");
  const [picture, setPicture] = useState(null);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/meta/models")
      .then((r) => (r.headers.get("content-type") ?? "").includes("json") ? r.json() : { data: [] })
      .then((body) => { if (live) setModels((body?.data ?? []).map((m) => m.id)); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const roster = useMemo(() => classifyModels(models), [models]);
  const km = kmOf(lane);
  const winner = useMemo(() => winnerFrom(verdict, drafts.length || 3), [verdict, drafts]);
  const summary = useMemo(() => fanOutSummary(drafts, winner), [drafts, winner]);
  const plan = useMemo(() => planWorkflow("web_store_sale"), []);
  const registry = useMemo(() => validateAgentRegistry(), []);

  async function runFanOut() {
    setRunning(true); setError(""); setDrafts([]); setVerdict("");
    try {
      const prompt = draftPrompt({ laneName: lane, km, tonnes: 27 });
      const results = await Promise.all(DRAFTS.map((m) => askOne(m, prompt).catch((e) => ({
        model: m, text: "", ms: 0, error: e.message,
      }))));
      setDrafts(results);
      const said = await judge(results);
      setVerdict(said || "(the judge returned no words)");
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  async function drawLoad() {
    setDrawing(true); setError("");
    try {
      const res = await fetch("/api/meta/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "muse-image-1.0",
          input: `Flat vector illustration, navy and gold, of a covered truck being loaded with cartons on a pallet. `
            + `Clean, minimal, no text.`,
          max_output_tokens: 400,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error?.message ?? `HTTP ${res.status}`);
      const call = (payload?.output ?? []).find((o) => o?.type === "image_generation_call" && o?.result);
      if (!call) throw new Error("the image model answered without a picture");
      const head = atob(call.result).slice(0, 4);
      const mime = head.startsWith("RIFF") ? "image/webp" : "image/png";
      setPicture(`data:${mime};base64,${call.result}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setDrawing(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2>The nine models on this account, and what each one is doing</h2>
        <p className="muted">
          Read live from the account, not from a list typed here. Two of the nine are contributor models:
          they are reachable, and this desk will not use them for any client or company data, so they are
          excluded on purpose and shown as excluded rather than quietly dropped.
        </p>
        <table className="lines">
          <thead>
            <tr><th>Model</th><th>Status</th><th>Job on the desk</th></tr>
          </thead>
          <tbody>
            {roster.length === 0 && (
              <tr><td colSpan={3} className="muted">The account list did not load; the desk still quotes.</td></tr>
            )}
            {roster.map((m) => (
              <tr key={m.id}>
                <td><code>{m.id}</code></td>
                <td>{m.excluded ? <span className="pill warn">excluded by policy</span>
                  : m.working ? <span className="pill ok">working</span> : <span className="pill">available</span>}</td>
                <td className="muted">{m.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Three drafts at once, one judge, and an answer you can act on</h2>
        <p className="muted">
          The same question goes to three Spark generations in parallel — not one after another. Muse Wonder
          reads all three blind, picks one and says why. The times below are measured in this browser.
        </p>
        <div className="row">
          <label>
            Lane
            <select value={lane} onChange={(e) => setLane(e.target.value)}>
              {laneNames.map((n) => <option key={n} value={n}>{n} — {kmOf(n)} km</option>)}
            </select>
          </label>
          <button type="button" className="primary" onClick={runFanOut} disabled={running}>
            {running ? "Three models working…" : "Run the fan-out"}
          </button>
        </div>
        {error && <p className="warn">{error}</p>}
        {drafts.length > 0 && (
          <>
            <div className="drafts">
              {drafts.map((d, i) => (
                <div key={d.model} className={"draft" + (winner === i ? " winner" : "")}>
                  <div className="draft-head">
                    <strong>{i + 1}. {d.model}</strong>
                    <span className="muted">{d.ms ? `${d.ms} ms` : "no reply"}{d.tokens ? ` · ${d.tokens} tokens` : ""}</span>
                  </div>
                  <p>{d.text || d.error || "(no words returned)"}</p>
                  {winner === i && <span className="pill ok">judge's pick</span>}
                </div>
              ))}
            </div>
            <p className="muted">
              Asked {summary.asked}, answered {summary.answered}
              {summary.fastestMs ? ` · fastest ${summary.fastestMs} ms, slowest ${summary.slowestMs} ms` : ""}
              {summary.tokens ? ` · ${summary.tokens} tokens in total` : ""}
              {summary.winner ? ` · picked ${summary.winner}` : " · no pick parsed"}
            </p>
            {verdict && (
              <blockquote>
                <strong>{JUDGE} says:</strong> {verdict}
              </blockquote>
            )}
            <p className="muted">
              The judge changes words, never numbers: every figure in a quote comes from the local engine,
              so a plausible sentence cannot move a price.
            </p>
          </>
        )}
      </section>

      <section className="card">
        <h2>Muse Image draws the load</h2>
        <p className="muted">
          One picture, asked for on the same account. It illustrates; it never prices and never counts —
          counting a photograph is SAM's job on the shipment screen, where the count is held against a real
          shipment rather than a description.
        </p>
        <div className="row">
          <button type="button" onClick={drawLoad} disabled={drawing}>
            {drawing ? "Drawing…" : "Draw a loaded truck"}
          </button>
          <span className="muted">About a cent of model credit, charged to the free allowance.</span>
        </div>
        {picture && <img src={picture} alt="An illustration of a covered truck being loaded with cartons" style={{ width: "100%", maxWidth: 560, borderRadius: 12, marginTop: 12 }} />}
      </section>

      <section className="card">
        <h2>The agents behind the desk</h2>
        <p className="muted">
          One orchestrator, five specialists and a local fallback. The models advise; the engines decide
          stock, money, credit and stage. This is the registry the sale workflow actually runs on, checked
          before it is trusted.
        </p>
        <p>
          Registry check: <span className={"pill " + (registry.ok ? "ok" : "warn")}>
            {registry.ok ? `valid — ${registry.agentCount} agents` : `blocked — ${registry.blockers.join(", ")}`}
          </span>
        </p>
        <table className="lines">
          <thead><tr><th>#</th><th>Agent</th><th>Model</th><th>Job</th></tr></thead>
          <tbody>
            {BUSINESS_AGENTS.filter((a) => a.kind !== "fallback").map((a) => (
              <tr key={a.id}>
                <td>{plan.steps.find((s) => s.agentId === a.id)?.order ?? "—"}</td>
                <td><code>{a.id}</code></td>
                <td className="muted">{a.model}</td>
                <td className="muted">{a.job}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted">
          Parallel where it can be: the three drafts above run at the same time. Sequential where it must be:
          stock before order, order before invoice, invoice before payment. A step is never marked done
          without the evidence it names.
        </p>
      </section>
    </>
  );
}

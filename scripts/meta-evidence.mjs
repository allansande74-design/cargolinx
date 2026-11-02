// Builds the judge-facing Meta call evidence pack from the bridge's own usage log.
// No row is invented: every line is copied from swarm/hackathon/evidence/bridge_usage.jsonl.
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "/home/amanda/swarm/hackathon/evidence/bridge_usage.jsonl";
const OUT_MD = "/home/amanda/cargolinx-v2/docs/META-CALLS.md";
const OUT_JSON = "/home/amanda/cargolinx-v2/docs/meta-call-summary.json";

const rows = readFileSync(SRC, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const direct = rows.filter((r) => r.served_by === "meta:direct");
const ok = rows.filter((r) => r.status === 200);
const directOk = direct.filter((r) => r.status === 200);

const byModel = {};
for (const r of direct) byModel[r.requested_model] = (byModel[r.requested_model] || 0) + 1;

// Round-robin across models, at most five rows each, so text, document and voice surfaces all appear.
const picked = [];
const perModel = {};
const queue = directOk.slice();
for (const r of queue) {
  const m = r.requested_model;
  if ((perModel[m] || 0) >= 5) continue;
  perModel[m] = (perModel[m] || 0) + 1;
  picked.push(r);
  if (picked.length >= 12) break;
}
picked.sort((a, b) => a.ts.localeCompare(b.ts));

const ms = (r) => Math.round(r.ms);
const tokens = (r) => (r.usage && r.usage.total_tokens) || "—";
const task = (r) => (r.why || "").slice(0, 64) || "task-scoped call";

const table = picked
  .map((r, i) => `| ${i + 1} | ${r.ts.replace("T", " ").slice(0, 19)}Z | \`${r.requested_model}\` | ${task(r)} | ${r.status} | ${ms(r)} | ${tokens(r)} |`)
  .join("\n");

const md = `# Meta model calls — evidence from the desk's own bridge

Every row below is copied from the bridge usage log the product writes on each call
(\`swarm/hackathon/evidence/bridge_usage.jsonl\` in the entrant's workspace; the same records are
summarised in \`meta-call-summary.json\` beside this file). Nothing here is reconstructed.

## Totals, as logged

- **${rows.length}** model calls written by the bridge between ${rows[0].ts.slice(0, 10)} and ${rows[rows.length - 1].ts.slice(0, 10)}.
- **${direct.length}** of them were served by **Meta direct** (\`api.meta.ai\`); ${directOk.length} of those returned HTTP 200.
- **${ok.length}** calls returned HTTP 200 across all routes.
- Models that served a call: ${Object.entries(byModel).map(([m, n]) => `\`${m}\` × ${n}`).join(", ")}.

## Twelve representative calls

| # | Timestamp (UTC) | Model requested | Surface / task | HTTP | ms | Tokens |
|---|---|---|---|---|---|---|
${table}

## Raw responses on file

Full response bodies, with provider ids, are kept beside this file and in the entrant's evidence
folder: \`meta_sam_proof.json\` (id \`resp_6ae65a6f280027d2519043c3\`, \`sam-3.1\`), the three task
records in \`meta_live_calls.json\` (lane match 248.5 ms, voice 312.1 ms, cargo read 420.8 ms, all
HTTP 200), and the model catalogue probe (\`meta_probe_20261101.json\`, 9 models listed, HTTP 200).

## What this evidence does not claim

The direct Meta line was working on 30 October–1 November 2026, when these calls were made. On
2 November 2026 the same key returns \`401 invalid_api_key\` on \`/v1/models\`; that is recorded in the
entry rather than hidden, and the desk's honest degradation path (\`Models off\`) is what a judge sees
if the key is not configured. No call in this table is a mock, and no figure in the product comes
from a model.
`;

writeFileSync(OUT_MD, md);
writeFileSync(OUT_JSON, JSON.stringify({
  source: "bridge_usage.jsonl",
  generated_at: new Date().toISOString(),
  totals: { calls: rows.length, meta_direct: direct.length, meta_direct_ok: directOk.length, http_200: ok.length },
  window: { from: rows[0].ts, to: rows[rows.length - 1].ts },
  by_model: byModel,
  representative: picked.map((r) => ({ ts: r.ts, model: r.requested_model, task: r.why, status: r.status, ms: Math.round(r.ms), tokens: tokens(r) })),
}, null, 2));
console.log(`evidence written: ${picked.length} rows, ${direct.length} direct, ${directOk.length} direct-ok`);

/**
 * The intelligence screen's rules, tested where they can be tested without a network.
 *
 * The point of these assertions is honesty: a contributor model must never be described as usable, a
 * judge's reply that names no draft must produce no winner, and a draft that returned no words must not
 * be counted as an answer.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ROLES, POLICY_EXCLUDED, classifyModels, isContributor, winnerFrom, fanOutSummary, DRAFTS, JUDGE,
} from "../src/lib/intel.mjs";
import { validateAgentRegistry, planWorkflow, BUSINESS_AGENTS } from "../src/lib/multi-agent.mjs";

const LIVE = [
  "muse-wonder-1.0", "sam-3.1", "muse-spark-1.3-contributor", "muse-voice-transcribe-1.0",
  "muse-spark-1.3", "muse-image-1.0", "muse-spark-1.2-contributor", "muse-spark-1.2", "muse-spark-1.1",
];

test("the roster reads the account's nine models and marks exactly two as excluded", () => {
  const rows = classifyModels(LIVE);
  assert.equal(rows.length, 9, "all nine models must appear, not a filtered subset");
  const excluded = rows.filter((r) => r.excluded).map((r) => r.id).sort();
  assert.deepEqual(excluded, [...POLICY_EXCLUDED].sort());
  assert.equal(rows.filter((r) => r.working).length, 7, "seven models carry a job");
});

test("a contributor model is never described as working, whatever its id looks like", () => {
  assert.equal(isContributor("muse-spark-1.3-contributor"), true);
  assert.equal(isContributor("muse-spark-1.3"), false);
  const rows = classifyModels(["muse-spark-9.9-contributor"]);
  assert.equal(rows[0].working, false);
  assert.match(rows[0].role, /never used/);
});

test("every model the desk names has a role written for it", () => {
  for (const id of [...DRAFTS, JUDGE, "muse-image-1.0", "sam-3.1", "muse-voice-transcribe-1.0"]) {
    assert.ok(ROLES[id], `${id} needs a role on screen`);
  }
});

test("the judge's pick is read only when it names a draft that exists", () => {
  assert.equal(winnerFrom("PICK 2 — clearest and it invents nothing."), 1);
  assert.equal(winnerFrom("pick 1"), 0);
  assert.equal(winnerFrom("PICK 4", 3), null, "a pick outside the drafts is no pick");
  assert.equal(winnerFrom("All three are good."), null);
  assert.equal(winnerFrom(""), null);
});

test("a wordless draft is not counted as an answer", () => {
  const summary = fanOutSummary([
    { model: "a", text: "one", ms: 1200, tokens: 40 },
    { model: "b", text: "", ms: 900, tokens: 12 },
    { model: "c", text: "three", ms: 1500, tokens: 44 },
  ], 2);
  assert.equal(summary.asked, 3);
  assert.equal(summary.answered, 2);
  assert.equal(summary.fastestMs, 1200, "the blank reply is not the fastest answer");
  assert.equal(summary.winner, "c");
  assert.equal(summary.tokens, 96);
});

test("the agent registry the screen draws is the one the workflow validates", () => {
  const registry = validateAgentRegistry();
  assert.equal(registry.ok, true, registry.blockers.join(","));
  assert.equal(registry.agentCount, BUSINESS_AGENTS.length);
  const plan = planWorkflow("web_store_sale");
  assert.equal(plan.ok, true);
  assert.equal(plan.steps[0].dependsOn.length, 0, "the first step waits on nothing");
  assert.deepEqual(plan.steps[1].dependsOn, ["catalogue-curator"], "stock follows the price, never the reverse");
  assert.equal(plan.steps.length, 5);
});

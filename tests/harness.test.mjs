import test from "node:test";
import assert from "node:assert/strict";

import { register, unregister, listHarness, harnessStatus, CATEGORIES } from "../engine/harness.mjs";
import { list } from "../engine/plugins.mjs";

const good = (over = {}) => ({
  id: "stack_test_ds",
  name: "DeepSeek stack",
  category: "tech-stack",
  version: "1.0.0",
  capabilities: ["brief.structure"],
  entry: "engine/harness.mjs",
  ...over,
});

test("register valid tech-stack plugin ok", () => {
  const r = register(good());
  assert.equal(r.id, "stack_test_ds");
  assert.equal(r.category, "tech-stack");
  unregister("stack_test_ds");
});

test("register invalid (bad category) throws", () => {
  assert.throws(() => register(good({ id: "x1", category: "nope" })), /invalid harness manifest/);
});

test("register invalid (empty capabilities) throws", () => {
  assert.throws(() => register(good({ id: "x2", capabilities: [] })), /invalid harness manifest/);
});

test("listHarness includes 3 built-ins", () => {
  const all = listHarness();
  assert.ok(all.length >= 3);
  for (const id of ["alibaba_dropship", "aliexpress_ds", "accio_sourcing"]) {
    assert.ok(all.some((p) => p.id === id), `missing builtin ${id}`);
  }
});

test("harnessStatus unknown id", () => {
  const s = harnessStatus("no_such_plugin_xyz");
  assert.equal(s.state, "unknown");
});

test("unregister removes", () => {
  register(good({ id: "tmp_remove_me" }));
  assert.equal(harnessStatus("tmp_remove_me").state, "registered");
  assert.equal(unregister("tmp_remove_me"), true);
  assert.equal(harnessStatus("tmp_remove_me").state, "unknown");
});

test("core plugins.mjs untouched (list() still returns 3)", () => {
  register(good({ id: "probe_extra" }));
  assert.equal(list().length, 3);
  unregister("probe_extra");
  assert.deepEqual([...CATEGORIES].sort(), ["bot", "iot", "plugin", "skill", "tech-stack", "tool"]);
});

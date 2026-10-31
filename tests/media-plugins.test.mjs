import test from "node:test";
import assert from "node:assert/strict";
import { register, listHarness, harnessStatus } from "../engine/harness.mjs";
import { mediaStatus } from "../engine/media-plugins.mjs";

const IDS = ["print-studio", "video-calls", "image-gen", "audio-studio"];

test("register 4 media plugins ok", () => {
  for (const id of IDS) {
    const rec = register({ id, name: id, category: "tool", version: "0.1-planned", capabilities: ["stub.cap"], entry: "PLANNED" });
    assert.equal(rec.id, id);
  }
});

test("listHarness contains all 4 media plugins", () => {
  const ids = new Set(listHarness().map((m) => m.id));
  for (const id of IDS) assert.ok(ids.has(id), `missing ${id}`);
});

test("harnessStatus reports registered for all 4", () => {
  for (const id of IDS) assert.equal(harnessStatus(id).state, "registered");
});

test("mediaStatus lists 4 planned entries without network", () => {
  const s = mediaStatus();
  assert.equal(s.length, 4);
  for (const row of s) assert.equal(row.entry, "PLANNED");
});

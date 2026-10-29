import test from "node:test";
import assert from "node:assert/strict";
import { enqueue, collapseForPush, acknowledge, mergeRecord, mergeList, applyRemote, nextKey } from "../src/lib/sync-core.mjs";

const order = (id, updatedAt, note) => ({ id, updatedAt, note, ref: `CLX-${id}` });

test("a queued write is kept with its idempotency key", () => {
  const q = enqueue([], { entity: "shipment", entityId: "s1", payload: { a: 1 }, at: "2026-10-29T06:00:00Z" });
  assert.equal(q.length, 1);
  assert.ok(q[0].idempotencyKey.startsWith("shipment:s1:"));
  assert.equal(q[0].attempts, 0);
});

test("the same key twice does not duplicate the write", () => {
  const key = nextKey("shipment", "s1", "2026-10-29T06:00:00Z");
  let q = enqueue([], { entity: "shipment", entityId: "s1", idempotencyKey: key });
  q = enqueue(q, { entity: "shipment", entityId: "s1", idempotencyKey: key });
  assert.equal(q.length, 1);
});

test("replaying an outbox after a dropped link sends each entity once", () => {
  let q = [];
  q = enqueue(q, { entity: "shipment", entityId: "s1", payload: { step: 1 }, at: "2026-10-29T06:00:00Z" });
  q = enqueue(q, { entity: "shipment", entityId: "s1", payload: { step: 2 }, at: "2026-10-29T06:05:00Z" });
  q = enqueue(q, { entity: "shipment", entityId: "s2", payload: { step: 1 }, at: "2026-10-29T06:06:00Z" });
  const { send, superseded } = collapseForPush(q);
  assert.deepEqual(send.map((e) => e.entityId), ["s1", "s2"]);
  assert.equal(send[0].payload.step, 2);
  assert.equal(superseded.length, 1);
});

test("acknowledgement clears only the keys the server confirmed", () => {
  let q = enqueue([], { entity: "shipment", entityId: "s1", at: "2026-10-29T06:00:00Z" });
  q = enqueue(q, { entity: "shipment", entityId: "s2", at: "2026-10-29T06:00:01Z" });
  const after = acknowledge(q, [q[0].idempotencyKey]);
  assert.equal(after.length, 1);
  assert.equal(after[0].entityId, "s2");
});

test("the later write wins and the loser is recorded", () => {
  const local = order("s1", "2026-10-29T08:00:00Z", "delivered on device");
  const remote = order("s1", "2026-10-29T09:00:00Z", "eta moved on server");
  const { winner, conflict } = mergeRecord(local, remote);
  assert.equal(winner.note, "eta moved on server");
  assert.equal(conflict.winner, "remote");
  assert.equal(conflict.localUpdatedAt, local.updatedAt);
});

test("a device that was offline for a day does not overwrite newer server state", () => {
  const local = order("s1", "2026-10-28T07:00:00Z", "stale");
  const remote = order("s1", "2026-10-29T09:00:00Z", "fresh");
  const { winner } = mergeRecord(local, remote);
  assert.equal(winner.note, "fresh");
});

test("a genuinely newer local write is not lost to an older server copy", () => {
  const local = order("s1", "2026-10-29T10:00:00Z", "pod signed");
  const remote = order("s1", "2026-10-29T09:00:00Z", "en route");
  const { winner } = mergeRecord(local, remote);
  assert.equal(winner.note, "pod signed");
});

test("merging a snapshot reports every conflict once", () => {
  const local = [order("s1", "2026-10-29T08:00:00Z", "a"), order("s2", "2026-10-29T08:00:00Z", "b")];
  const remote = [order("s1", "2026-10-29T09:00:00Z", "a2"), order("s2", "2026-10-29T07:00:00Z", "b2")];
  const { rows, conflicts } = mergeList(local, remote);
  assert.equal(rows.length, 2);
  assert.equal(conflicts.length, 2);
  assert.equal(rows.find((r) => r.id === "s1").note, "a2");
  assert.equal(rows.find((r) => r.id === "s2").note, "b");
});

test("a remote record for an unknown shipment is added, not dropped", () => {
  const { rows, conflict } = applyRemote([], order("s9", "2026-10-29T09:00:00Z", "new"));
  assert.equal(rows.length, 1);
  assert.equal(conflict, null);
});

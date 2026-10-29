import test from "node:test";
import assert from "node:assert/strict";
import { receiveLot } from "../engine/inventory.mjs";
import { startCount, applyCount, writeOff, shrinkageReport, binTransfer, WRITE_OFF_REASONS } from "../engine/inventory-ops.mjs";

const lotA = () => receiveLot({ sku: "SP450", qty: 50, bin: "NBO-01-01-01", lot: "LOT-A", unitCost: 1200 });

// ---- counting ----

test("a count's variance carries its sign, and the status names it", () => {
  const base = { sku: "SP450", bin: "NBO-01-01-01", lot: "LOT-A", expectedQty: 50, countedBy: "Otieno" };

  const match = startCount({ ...base, countedQty: 50 });
  assert.equal(match.variance, 0);
  assert.equal(match.status, "match");

  const over = startCount({ ...base, countedQty: 55 });
  assert.equal(over.variance, 5);
  assert.equal(over.status, "over");

  const short = startCount({ ...base, countedQty: 47 });
  assert.equal(short.variance, -3);
  assert.equal(short.status, "short");

  assert.ok(match.id.startsWith("cnt_"));
  assert.equal(short.expectedQty, 50);
  assert.equal(short.countedQty, 47);
  assert.equal(short.countedBy, "Otieno");
});

test("a count without an expected figure or a bin is refused", () => {
  assert.throws(() => startCount({ sku: "SP450", bin: "B-1", expectedQty: null, countedQty: 10 }), /expectedQty must be a number/);
  assert.throws(() => startCount({ sku: "SP450", bin: "", expectedQty: 10, countedQty: 10 }), /bin/);
});

test("a short count takes the missing units off the lot as a count short write-off", () => {
  const lot = lotA();
  const count = startCount({ sku: "SP450", bin: lot.bin, lot: lot.lot, expectedQty: 50, countedQty: 47, countedBy: "Otieno", at: "2026-10-12T09:00:00Z" });

  const r = applyCount(lot, count);
  assert.equal(r.lot.remaining, 47);
  assert.equal(r.lot.writeOffs.length, 1);
  assert.equal(r.lot.writeOffs[0].qty, 3);
  assert.equal(r.lot.writeOffs[0].reason, "count short");
  assert.equal(r.lot.writeOffs[0].by, "Otieno");
  assert.equal(r.lot.writeOffs[0].at, "2026-10-12T09:00:00.000Z");
  assert.deepEqual(r.lot.appliedCounts, [count.id]);
  assert.equal(lot.remaining, 50); // the lot handed in is not mutated
});

test("an over count adds the surplus as an adjustment, not a write-off", () => {
  const lot = lotA();
  const count = startCount({ sku: "SP450", bin: lot.bin, lot: lot.lot, expectedQty: 50, countedQty: 55, countedBy: "Achieng" });

  const r = applyCount(lot, count);
  assert.equal(r.lot.remaining, 55);
  assert.equal(r.lot.adjustments.length, 1);
  assert.equal(r.lot.adjustments[0].qty, 5);
  assert.equal(r.lot.adjustments[0].reason, "count over");
  assert.equal(r.lot.adjustments[0].by, "Achieng");
  assert.equal((r.lot.writeOffs ?? []).length, 0);
});

test("a matching count moves no stock but is still recorded as applied", () => {
  const lot = lotA();
  const count = startCount({ sku: "SP450", bin: lot.bin, lot: lot.lot, expectedQty: 50, countedQty: 50 });
  const r = applyCount(lot, count);
  assert.equal(r.lot.remaining, 50);
  assert.equal(r.entry, null);
  assert.deepEqual(r.lot.appliedCounts, [count.id]);
});

test("the same count cannot be applied twice", () => {
  const lot = lotA();
  const count = startCount({ sku: "SP450", bin: lot.bin, lot: lot.lot, expectedQty: 50, countedQty: 47, countedBy: "Otieno" });

  const once = applyCount(lot, count);
  // replaying the returned, marked count
  assert.throws(() => applyCount(once.lot, once.count), /already applied/);
  // replaying the original count against the updated lot is caught by the lot's own record
  assert.throws(() => applyCount(once.lot, count), /has already been applied/);
  assert.equal(once.lot.remaining, 47);
});

test("a short count that would push the lot below zero is refused, not clamped", () => {
  const lot = receiveLot({ sku: "SP450", qty: 10, bin: "NBO-01-01-01", lot: "LOT-THIN" });
  const count = startCount({ sku: "SP450", bin: lot.bin, lot: lot.lot, expectedQty: 20, countedQty: 0 });
  assert.throws(() => applyCount(lot, count), /below zero/);
  assert.equal(lot.remaining, 10);
});

// ---- write-off ----

test("only the five stated reasons are accepted for a write-off", () => {
  assert.deepEqual(WRITE_OFF_REASONS, ["damaged", "expired", "lost", "sample", "theft"]);
  const lot = lotA();
  assert.throws(() => writeOff(lot, { qty: 1, reason: "broken", by: "Otieno" }), /not allowed/);
  assert.throws(() => writeOff(lot, { qty: 1, by: "Otieno" }), /must state a reason/);
  assert.throws(() => writeOff(lot, { qty: 1, reason: "adjustment" }), /not allowed/);

  const r = writeOff(lot, { qty: 2, reason: "damaged", by: "Otieno", at: "2026-10-05T00:00:00Z" });
  assert.equal(r.lot.remaining, 48);
  assert.equal(r.entry.reason, "damaged");
  assert.equal(r.entry.qty, 2);
  assert.equal(r.entry.by, "Otieno");
});

test("writing off more than the lot holds is refused with the remaining figure", () => {
  const lot = receiveLot({ sku: "SP450", qty: 10, bin: "B-1", lot: "LOT-SMALL" });
  assert.throws(() => writeOff(lot, { qty: 11, reason: "theft" }), /only 10 remaining/);
  assert.equal(lot.remaining, 10);
  // the whole lot may still go
  assert.equal(writeOff(lot, { qty: 10, reason: "theft" }).lot.remaining, 0);
});

test("a write-off quantity must be positive", () => {
  const lot = lotA();
  assert.throws(() => writeOff(lot, { qty: 0, reason: "damaged" }), /must be positive/);
  assert.throws(() => writeOff(lot, { qty: -5, reason: "damaged" }), /must be positive/);
});

// ---- shrinkage ----

test("shrinkage is totalled by reason and valued at cost, with the largest single loss named", () => {
  let a = receiveLot({ sku: "SP450", qty: 100, bin: "B-1", lot: "LOT-A", unitCost: 1200 });
  a = writeOff(a, { qty: 3, reason: "damaged", by: "Otieno", at: "2026-10-05T00:00:00Z" }).lot;
  a = writeOff(a, { qty: 2, reason: "lost", by: "Otieno", at: "2026-10-20T00:00:00Z" }).lot;
  a = writeOff(a, { qty: 5, reason: "damaged", by: "Otieno", at: "2026-11-05T00:00:00Z" }).lot; // outside the period

  let b = receiveLot({ sku: "SP450", qty: 40, bin: "B-2", lot: "LOT-B", unitCost: 300 });
  b = writeOff(b, { qty: 10, reason: "damaged", by: "Achieng", at: "2026-10-10T00:00:00Z" }).lot;
  // a count short lands in the same report
  const count = startCount({ sku: "SP450", bin: b.bin, lot: b.lot, expectedQty: 30, countedQty: 28, countedBy: "Achieng", at: "2026-10-12T00:00:00Z" });
  b = applyCount(b, count).lot;

  const report = shrinkageReport([a, b], { from: "2026-10-01", to: "2026-10-31" });

  assert.equal(report.byReason.damaged.qty, 13);
  assert.equal(report.byReason.damaged.value, 6600); // 3 x 1200 + 10 x 300
  assert.equal(report.byReason.lost.qty, 2);
  assert.equal(report.byReason.lost.value, 2400);
  assert.equal(report.byReason["count short"].qty, 2);
  assert.equal(report.byReason["count short"].value, 600);
  assert.equal(report.byReason.theft.qty, 0);
  assert.equal(report.totalQty, 17);
  assert.equal(report.valueLost, 9600);
  assert.equal(report.entries, 4);

  assert.equal(report.largest.lot, "LOT-A");
  assert.equal(report.largest.reason, "damaged");
  assert.equal(report.largest.qty, 3);
  assert.equal(report.largest.value, 3600);

  // the November write-off is only in the November report
  const november = shrinkageReport([a, b], { from: "2026-11-01", to: "2026-11-30" });
  assert.equal(november.totalQty, 5);
  assert.equal(november.largest.lot, "LOT-A");
});

test("shrinkage with nothing written off reports zeroes and no largest loss", () => {
  const report = shrinkageReport([lotA()], {});
  assert.equal(report.valueLost, 0);
  assert.equal(report.totalQty, 0);
  assert.equal(report.largest, null);
  assert.equal(report.entries, 0);
});

// ---- bin transfer ----

test("a lot cannot be transferred to the bin it is already in", () => {
  const lot = lotA();
  assert.throws(() => binTransfer(lot, { toBin: "NBO-01-01-01", by: "Otieno" }), /same bin is not a movement/);
  assert.throws(() => binTransfer(lot, { by: "Otieno" }), /must name the bin/);
});

test("a bin transfer moves the stock and leaves a movement in the history", () => {
  const lot = lotA();
  const r = binTransfer(lot, { toBin: "NBO-02-03-01", by: "Otieno", at: "2026-10-15T14:00:00Z" });

  assert.equal(r.lot.bin, "NBO-02-03-01");
  assert.equal(r.lot.remaining, 50);
  assert.equal(r.lot.movements.length, 1);
  assert.deepEqual(r.lot.movements[0], {
    type: "bin transfer",
    from: "NBO-01-01-01",
    to: "NBO-02-03-01",
    qty: 50,
    at: "2026-10-15T14:00:00.000Z",
    by: "Otieno",
  });
  assert.equal(r.movement.qty, 50);
  assert.equal(lot.bin, "NBO-01-01-01"); // the lot handed in is not mutated
  assert.equal(lot.movements, undefined);
});

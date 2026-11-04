/**
 * The load ladder and the carton maths, checked the way a clerk would check them: measure one carton,
 * stack forty, price the load, and see which unit the desk would actually send.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  RUNGS,
  STAGES,
  measureCarton,
  measureConsignment,
  quoteOnLadder,
  ladderFor,
  stageBoard,
  MAX_CARTON_KG,
} from "../engine/ladder.mjs";

test("a carton measures in cubic metres and says it is a box", () => {
  const c = measureCarton({ lengthCm: 60, widthCm: 40, heightCm: 40, weightKg: 20 });
  assert.equal(c.cbm, 0.096);
  assert.equal(c.aspectRatio, 1.5);
  assert.equal(c.boxShaped, true);
  assert.equal(c.densityKgPerM3, 208.3);
  // 20 kg of cargo in 0.096 m3 is 24 kg of volume weight, so volume prices this carton.
  assert.equal(c.chargeableKg, 24);
  assert.deepEqual(c.problems, []);
});

test("a plank-shaped carton is called out, with the box that would replace it", () => {
  const c = measureCarton({ lengthCm: 120, widthCm: 30, heightCm: 30, weightKg: 12 });
  assert.equal(c.boxShaped, false);
  assert.equal(c.aspectRatio, 4);
  assert.equal(c.problems.length, 1);
  assert.match(c.problems[0], /longest side is 4×/);
});

test("a carton above 25 kg is told how many cartons it should become", () => {
  const c = measureCarton({ lengthCm: 50, widthCm: 40, heightCm: 30, weightKg: 60 });
  assert.match(c.problems.join(" "), new RegExp(`${MAX_CARTON_KG} kg a handler lifts`));
  assert.match(c.problems.join(" "), /split into 3 cartons/);
});

test("a carton with no height is refused rather than priced at nothing", () => {
  assert.throws(() => measureCarton({ lengthCm: 60, widthCm: 40, heightCm: 0, weightKg: 10 }), /no height is a pallet/);
});

test("forty cartons stack to 4.147 m3 with the void allowance, and volume prices them", () => {
  const c = measureConsignment({ lengthCm: 60, widthCm: 40, heightCm: 40, weightKg: 20, count: 40 });
  assert.equal(c.count, 40);
  assert.equal(c.cbmPerCarton, 0.096);
  assert.equal(c.cbm, 4.147);
  assert.equal(c.kg, 800);
  assert.equal(c.chargeableKg, 1036.75);
  assert.equal(c.chargeableBasis, "volume");
});

test("800 kg and 4.1 m3 on 500 km goes on the 3-tonne van, and the arithmetic is shown", () => {
  const q = quoteOnLadder({ weightKg: 800, cbm: 4.147, distanceKm: 500 });
  assert.equal(q.rung.code, "van3");
  assert.equal(q.basisOfShare, "volume");
  assert.equal(q.fullVehicleKes, 47500);
  assert.equal(q.payableKes, 14070);
  assert.equal(q.perTonneKes, 17588);
  assert.equal(q.perCbmKes, 3393);
  assert.match(q.basis, /replace with a signed carrier rate/);
});

test("the small units are shown as not fitting rather than quietly dropped", () => {
  const board = ladderFor({ weightKg: 800, cbm: 4.147, distanceKm: 500 });
  assert.equal(board.rows.length, RUNGS.length);
  assert.equal(board.recommended, "van3");
  const pickup = board.rows.find((r) => r.code === "pickup");
  assert.equal(pickup.fits, false);
  assert.match(pickup.reason, /carries 1000 kg \/ 3 m3/);
  assert.equal(board.rows.filter((r) => r.isSmallestFit).length, 1);
});

test("a load bigger than a 30-tonne unit is refused, not squeezed in", () => {
  assert.throws(
    () => quoteOnLadder({ weightKg: 35000, cbm: 60, distanceKm: 900 }),
    /larger than a 30-tonne unit/,
  );
});

test("asking for a rung that cannot carry the load names the next one that can", () => {
  assert.throws(
    () => quoteOnLadder({ weightKg: 800, cbm: 4.147, distanceKm: 500, rungCode: "pickup" }),
    /next rung that carries it is van3/,
  );
});

test("the far end of the ladder is a real 30-tonne unit, not a label", () => {
  const q = quoteOnLadder({ weightKg: 28000, cbm: 90, distanceKm: 1200 });
  assert.equal(q.rung.code, "regional30");
  assert.ok(q.utilisation.weightPct >= 90);
});

test("every stage in the chain carries who owns it, and nothing claims an agency has approved it", () => {
  assert.equal(STAGES.length, 16);
  for (const stage of STAGES) {
    assert.ok(["desk", "agency", "client"].includes(stage.where), `${stage.code} has no owner`);
    assert.equal(typeof stage.note, "string");
    assert.ok(stage.note.length > 20, `${stage.code} has no substance`);
  }
  assert.equal(STAGES.at(-1).code, "signoff");
  assert.equal(STAGES.at(-1).where, "client");
});

test("the board counts only the stages actually completed, and never finishes early", () => {
  const board = stageBoard({ completed: ["onboard", "pack", "source"], current: "trade_finance" });
  assert.equal(board.done, 3);
  assert.equal(board.total, 16);
  assert.equal(board.complete, false);
  assert.equal(board.rows.find((r) => r.code === "trade_finance").state, "current");

  const blocked = stageBoard({ completed: ["onboard"], blocked: ["pvoc"] });
  assert.equal(blocked.rows.find((r) => r.code === "pvoc").state, "blocked");
  assert.equal(blocked.complete, false);
});

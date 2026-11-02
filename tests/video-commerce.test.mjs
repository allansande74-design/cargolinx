import test from "node:test";
import assert from "node:assert/strict";

import {
  VIDEO_SOURCES, countWords, checkFilm, filmPrice,
} from "../src/lib/video-commerce.mjs";

const pitch = "Solar lanterns, twenty in a carton, wired stock, ready today in Nairobi";

test("the five Meta tools of the film lane are named", () => {
  assert.deepEqual(Object.keys(VIDEO_SOURCES), ["poster", "transcript", "goods", "offer", "decision"]);
  assert.equal(VIDEO_SOURCES.poster.tool, "muse-image-1.0");
  assert.equal(VIDEO_SOURCES.transcript.tool, "muse-voice-transcribe-1.0");
  assert.equal(VIDEO_SOURCES.goods.tool, "sam-3.1");
  assert.equal(VIDEO_SOURCES.offer.tool, "muse-wonder-1.0");
  assert.equal(VIDEO_SOURCES.decision.tool, "muse-spark-1.3");
});

test("a film is refused when it is missing the pieces a buyer checks", () => {
  const bare = checkFilm({ product: { goods: 1 } });
  assert.equal(bare.ok, false);
  assert.deepEqual(bare.blockers, ["poster_required", "film_required", "transcript_too_short", "goods_not_counted"]);
  const ready = checkFilm({
    product: { goods: 1_200_000, freight: 250_000, dutyRate: 0.25, quantity: 20 },
    posterRef: "poster.jpg", filmRef: "film.mp4", transcript: pitch, countedUnits: 20,
  });
  assert.deepEqual(ready, { ok: true, blockers: [] });
  assert.equal(countWords(pitch), 12);
});

test("the film price comes from the landed engine and clears the wholesale test", () => {
  const consignment = { goods: 1_200_000, freight: 250_000, dutyRate: 0.25, quantity: 20 };
  const p = filmPrice({ product: consignment, marginPct: 0.3, wholesaleKes: 175_000 });
  assert.equal(p.landedPerUnitKes, 109_454.05);
  assert.ok(p.priceKes > p.landedPerUnitKes, "price must be above the landed cost");
  assert.equal(p.marginPct, 0.3);
  assert.equal(p.underWholesale, true);
  const noWholesale = filmPrice({ product: consignment, marginPct: 30 });
  assert.equal(noWholesale.wholesaleKes, null);
  assert.equal(noWholesale.underWholesale, null);
});

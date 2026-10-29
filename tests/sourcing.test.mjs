import test from "node:test";
import assert from "node:assert/strict";
import { parseSpec, selectTier, landedPerUnit, scoreOffer, compareOffers, dropshipDecision, rfqDraft } from "../engine/sourcing.mjs";
import { list, get, status, configure, supports, dryRun, invoke, PluginNotConfigured, PLUGIN_MANIFESTS } from "../engine/plugins.mjs";

// ---- spec parsing ----

test("a plain-language request becomes a structured brief", () => {
  const spec = parseSpec("I need 500 pcs solar panels under 120 usd to Kenya, HS 8541.43");
  assert.equal(spec.qty, 500);
  assert.equal(spec.qtyUnit, "piece");
  assert.equal(spec.budget, 120);
  assert.equal(spec.currency, "USD");
  assert.equal(spec.destination, "KE");
  assert.equal(spec.hsHint, "8541.43");
  assert.match(spec.product, /solar panels/i);
  assert.equal(spec.complete, true);
});

test("a request without a quantity is incomplete, not guessed", () => {
  const spec = parseSpec("solar panels for Kenya");
  assert.equal(spec.qty, null);
  assert.equal(spec.complete, false);
});

test("thousands separators are read, not truncated", () => {
  assert.equal(parseSpec("2,500 cartons of tiles to Uganda").qty, 2500);
});

// ---- price ladders ----

test("the tier for the quantity is chosen, and below-MOQ is stated with the shortfall", () => {
  const tiers = [{ minQty: 100, unitPrice: 12 }, { minQty: 500, unitPrice: 10.5 }, { minQty: 1000, unitPrice: 9.8 }];
  const at600 = selectTier(tiers, 600);
  assert.equal(at600.unitPrice, 10.5);
  assert.equal(at600.belowMoq, false);

  const at40 = selectTier(tiers, 40);
  assert.equal(at40.belowMoq, true);
  assert.equal(at40.moq, 100);
  assert.equal(at40.shortfall, 60);
});

test("an offer without tiers cannot be priced", () => {
  assert.throws(() => selectTier([], 10), /no price tiers/);
});

// ---- landed cost ----

test("landed cost per unit includes freight once, duty on CIF and VAT on CIF plus duty", () => {
  const r = landedPerUnit({ qty: 100, unitPrice: 10, freight: 200, dutyRate: 0.25 });
  // goods 1000, freight 200, insurance 6, cif 1206, duty 301.5, vat 241.2, total 1748.7
  assert.equal(r.cif, 1206);
  assert.equal(r.duty, 301.5);
  assert.equal(r.vat, 241.2);
  assert.equal(r.total, 1748.7);
  assert.equal(r.perUnit, 17.49);
  assert.ok(r.perUnitKes > 2000);
});

test("a dropship parcel can be priced with no duty applied and no invented threshold", () => {
  const r = landedPerUnit({ qty: 1, unitPrice: 25, freight: 12, dutyRate: 0, vatRate: 0 });
  assert.equal(r.total, 37.19);
  assert.equal(r.perUnit, 37.19);
});

// ---- scoring ----

test("an offer below MOQ and over budget is rejected with both reasons", () => {
  const offer = { supplier: "Shenzhen A", tiers: [{ minQty: 1000, unitPrice: 14 }], leadTimeDays: 35, shipsTo: ["KE"], rating: 4.2 };
  const s = scoreOffer(offer, { qty: 100, budget: 10, destination: "KE" });
  assert.equal(s.verdict, "reject");
  assert.ok(s.reasons.some((r) => /below MOQ/.test(r)));
  assert.ok(s.reasons.some((r) => /over budget/.test(r)));
});

test("a compliant offer is shortlisted", () => {
  const offer = { supplier: "Ningbo B", tiers: [{ minQty: 100, unitPrice: 9 }], leadTimeDays: 20, shipsTo: ["KE"], rating: 4.8, certifications: ["CE"] };
  const s = scoreOffer(offer, { qty: 500, budget: 10, destination: "KE" });
  assert.equal(s.verdict, "shortlist");
  assert.ok(s.score >= 75);
});

test("an offer that does not ship to the destination is heavily penalised", () => {
  const offer = { supplier: "C", tiers: [{ minQty: 10, unitPrice: 5 }], leadTimeDays: 10, shipsTo: ["US"], certifications: ["CE"] };
  const s = scoreOffer(offer, { qty: 20, destination: "KE" });
  assert.ok(s.reasons.some((r) => /does not ship to KE/.test(r)));
  assert.ok(s.score <= 60);
});

test("comparison ranks the best offer first", () => {
  const offers = [
    { supplier: "slow", tiers: [{ minQty: 10, unitPrice: 12 }], leadTimeDays: 60, shipsTo: ["KE"] },
    { supplier: "good", tiers: [{ minQty: 10, unitPrice: 11 }], leadTimeDays: 15, shipsTo: ["KE"], certifications: ["CE"], rating: 4.6 },
  ];
  const ranked = compareOffers(offers, { qty: 100, budget: 13, destination: "KE" });
  assert.equal(ranked[0].supplier, "good");
});

// ---- dropship vs stock ----

test("dropship is chosen when the MOQ would take too long to clear", () => {
  const d = dropshipDecision({ demandPerMonth: 50, moq: 5000, unitPriceBulk: 8, unitPriceDropship: 12, dutyRate: 0.25 });
  assert.equal(d.recommendation, "dropship");
  assert.ok(d.monthsOfCover > 6);
});

test("stock is chosen when bulk beats dropship and the MOQ clears quickly", () => {
  const d = dropshipDecision({ demandPerMonth: 1000, moq: 2000, unitPriceBulk: 7, unitPriceDropship: 12, freightBulk: 500, freightDropship: 3, dutyRate: 0.25 });
  assert.equal(d.recommendation, "hold stock");
  assert.ok(d.savingPerUnit > 0);
  assert.ok(d.cashTiedKes > 0);
});

// ---- RFQ ----

test("an RFQ asks the questions that make a quote usable", () => {
  const spec = parseSpec("300 cartons of floor tiles under 40 usd to Kenya");
  const rfq = rfqDraft(spec);
  assert.match(rfq, /300 carton/);
  assert.match(rfq, /minimum order quantities/);
  assert.match(rfq, /gross weight per carton/);
  assert.match(rfq, /Altovex Global Logistics/);
});

test("an RFQ without a product is refused", () => {
  assert.throws(() => rfqDraft({ qty: 5 }), /product description is required/);
});

// ---- plugins ----

test("the three plugins are registered with declared capabilities", () => {
  const ids = list().map((p) => p.id).sort();
  assert.deepEqual(ids, ["accio_sourcing", "alibaba_dropship", "aliexpress_ds"]);
  assert.equal(supports("alibaba_dropship", "order.create"), true);
  assert.equal(supports("alibaba_dropship", "telekinesis"), false);
});

test("a plugin is not ready until its credentials exist", () => {
  const st = status("alibaba_dropship");
  assert.equal(st.state, "disabled");
  const afterEnable = configure("alibaba_dropship", { appKey: "k" }, { enabled: true });
  assert.equal(afterEnable.state, "not-configured");
  assert.deepEqual(afterEnable.missing, ["AppSecret", "Buyer access token"]);
  const ready = configure("alibaba_dropship", { appSecret: "s", accessToken: "t" }, { enabled: true });
  assert.equal(ready.state, "ready");
});

test("a call without credentials throws instead of inventing a catalogue", async () => {
  configure("aliexpress_ds", { appKey: "k" }, { enabled: true });
  await assert.rejects(() => invoke("aliexpress_ds", "product.lookup", {}), (e) => e instanceof PluginNotConfigured);
});

test("a dry run shows the request that would be sent", () => {
  const run = dryRun("alibaba_dropship", "order.create", { qty: 10 });
  assert.equal(run.request.host, "openapi.alibaba.com");
  assert.equal(run.request.signed, "HMAC-SHA256");
  assert.equal(run.request.body.qty, 10);
  assert.equal(run.credentialsPresent, true);
});

test("an undeclared capability is refused", () => {
  assert.throws(() => dryRun("accio_sourcing", "order.create"), /does not declare/);
  assert.throws(() => get("nope"), /unknown plugin/);
});

test("the sourcing agent needs no credentials and says so", async () => {
  configure("accio_sourcing", {}, { enabled: true });
  assert.equal(status("accio_sourcing").state, "ready");
  const res = await invoke("accio_sourcing", "brief.structure", { text: "x" });
  assert.equal(res.local, true);
});

test("every manifest documents where its credentials come from", () => {
  for (const m of Object.values(PLUGIN_MANIFESTS)) {
    for (const r of m.requires) {
      assert.ok(r.how && r.how.length > 5, `${m.id} ${r.key} needs instructions`);
    }
    assert.ok(m.docs);
  }
});

test("quantity words do not leak into the product name", () => {
  assert.equal(parseSpec("source 300 units of LED bulbs").product, "LED bulbs");
  assert.equal(parseSpec("We need 2,500 cartons of floor tiles to Uganda").product, "floor tiles");
  assert.equal(parseSpec("I need 500 pcs solar panels under 120 usd to Kenya, HS 8541.43").product, "solar panels");
});

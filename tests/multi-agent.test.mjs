import test from "node:test";
import assert from "node:assert/strict";

import { receiveLot } from "../engine/inventory.mjs";
import {
  BUSINESS_AGENTS,
  validateAgentRegistry,
  planWorkflow,
  runSaleWorkflow,
  verifySaleEvidence,
} from "../src/lib/multi-agent.mjs";

const pitch = "Solar lanterns, twenty in a carton, wired stock, ready today in Nairobi";
const film = { filmRef: "film.mp4", posterRef: "poster.jpg", transcript: pitch, countedUnits: 20 };
const item = {
  name: "Solar lantern carton",
  product: { goods: 1_200_000, freight: 250_000, dutyRate: 0.25, quantity: 20 },
  film,
  wholesaleKes: 175_000,
};
const account = { id: "A1", name: "Otieno Stores", status: "active", terms: "net30", creditLimitKes: 5_000_000 };

function lots(qty = 40) {
  return [receiveLot({ sku: "LANTERN-20", description: "Solar lanterns", qty, bin: "A1" })];
}

test("the registry has one orchestrator, allowed models and named implementations", () => {
  assert.equal(BUSINESS_AGENTS.filter((a) => a.kind === "orchestrator").length, 1);
  const result = validateAgentRegistry();
  assert.equal(result.ok, true, result.blockers.join(", "));
  assert.equal(result.agentCount, 7);
  assert.equal(validateAgentRegistry([{ ...BUSINESS_AGENTS[0], model: "unknown-model" }]).ok, false);
});

test("the orchestrator plans all three sale channels through the same governed sequence", () => {
  for (const kind of ["film_sale", "whatsapp_sale", "web_store_sale"]) {
    const plan = planWorkflow(kind);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.steps.map((s) => s.agentId), [
      "catalogue-curator",
      "store-keeper",
      "payment-clerk",
      "customer-messenger",
      "workflow-verifier",
    ]);
    assert.ok(plan.steps.at(-1).evidenceRequired.includes("price_consistency"));
  }
  assert.equal(planWorkflow("unknown").ok, false);
});

test("a governed sale reaches ready-for-dispatch with one price and unsent approval-gated message", () => {
  const result = runSaleWorkflow({
    channel: "whatsapp_sale",
    item,
    sku: "LANTERN-20",
    lots: lots(),
    account,
    qty: 2,
    phone: "0712 345 678",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "payment_pending");
  assert.equal(result.catalogue.priceKes, result.shelf.priceKes);
  assert.equal(result.order.lines[0].unitValue, result.catalogue.priceKes);
  assert.equal(result.outbound.to, "254712345678");
  assert.equal(result.outbound.requiresApproval, true);
  assert.equal(result.outbound.sent, false);

  const paid = runSaleWorkflow({
    channel: "web_store_sale",
    item,
    sku: "LANTERN-20",
    lots: lots(),
    account,
    qty: 2,
    phone: "0712 345 678",
    payment: { amount: result.invoice.total, method: "mpesa", reference: "M-100" },
  });
  assert.equal(paid.ok, true, JSON.stringify(paid.blockers));
  assert.equal(paid.status, "ready_for_dispatch");
  assert.equal(paid.invoice.balance, 0);
  assert.equal(paid.verification.ok, true);
});

test("agents refuse an unfilmable product, absent stock or excess credit before taking payment", () => {
  const unfilmable = runSaleWorkflow({
    item: { ...item, film: { ...film, posterRef: null } },
    sku: "LANTERN-20",
    lots: lots(),
    account,
    payment: { amount: 1 },
  });
  assert.equal(unfilmable.ok, false);
  assert.ok(unfilmable.blockers.includes("poster_required"));

  const noStock = runSaleWorkflow({ item, sku: "GHOST", lots: lots(), account, payment: { amount: 1 } });
  assert.equal(noStock.ok, false);
  assert.ok(noStock.blockers.some((b) => /out of stock|stock/.test(b)));

  const overCredit = runSaleWorkflow({
    item,
    sku: "LANTERN-20",
    lots: lots(),
    account: { ...account, creditLimitKes: 100_000 },
    qty: 2,
    payment: { amount: 1 },
  });
  assert.equal(overCredit.ok, false);
  assert.ok(overCredit.blockers.some((b) => /credit headroom/.test(b)));
});

test("the verifier rejects a price change or incomplete payment evidence", () => {
  const result = verifySaleEvidence({
    catalogue: { filmReady: true, priceKes: 100 },
    shelf: { offerable: true, priceKes: 90 },
    checkoutResult: { ok: true, order: { lines: [{ unitValue: 100 }] } },
    paymentResult: { ok: true, balance: 10 },
    steps: [{ agentId: "catalogue-curator" }, { agentId: "store-keeper" }, { agentId: "payment-clerk" }, { agentId: "customer-messenger" }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("price_changed_between_channels"));
  assert.ok(result.blockers.includes("payment_incomplete"));
});

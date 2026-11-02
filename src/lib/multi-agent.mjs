/**
 * Multi-agent business system: one orchestrator, specialist agents, one set of books.
 *
 * The agents do not each keep their own truth. The orchestrator plans the work, the catalogue
 * agent prices from the landed engine, the store agent checks the warehouse and raises the order
 * and invoice, the payment agent settles against that invoice, and the messenger prepares — but
 * never sends — the customer message. A verifier closes the file only when every step has
 * evidence and the price never changed between channels.
 *
 * Model agents advise and route. Engines decide money, stock, credit and order stage. If the
 * model layer is unavailable, this deterministic workflow still runs and says so in its trail.
 */
import { catalogueLine } from "./whatsapp-store.mjs";
import { shelfItem, checkout, pay } from "./web-store.mjs";
import { confirmationMessage, waNumber } from "./whatsapp-store.mjs";

export const ORCHESTRATOR_ID = "business-orchestrator";

export const BUSINESS_AGENTS = Object.freeze([
  Object.freeze({
    id: ORCHESTRATOR_ID, kind: "orchestrator", model: "muse-wonder-1.0", orchestratedBy: null,
    tools: ["workflow planner", "agent registry", "evidence verifier"],
    implements: "src/lib/multi-agent.mjs:planWorkflow",
    status: "live",
    job: "Plans each business workflow, delegates to specialist agents in dependency order, and verifies the evidence before completion.",
  }),
  Object.freeze({
    id: "catalogue-curator", kind: "generative", model: "muse-image-1.0", orchestratedBy: ORCHESTRATOR_ID,
    tools: ["muse-image-1.0", "muse-voice-transcribe-1.0", "sam-3.1", "landed engine (read-only)"],
    implements: "src/lib/whatsapp-store.mjs:catalogueLine",
    status: "live",
    job: "Checks the selling film and issues the one landed-backed price used by film, chat and store.",
  }),
  Object.freeze({
    id: "store-keeper", kind: "worker", model: "muse-spark-1.3", orchestratedBy: ORCHESTRATOR_ID,
    tools: ["warehouse stock (read-only)", "order engine", "invoicing engine", "credit gate"],
    implements: "src/lib/web-store.mjs:checkout",
    status: "live",
    job: "Confirms real stock, applies the credit gate, and creates the real order and proforma invoice.",
  }),
  Object.freeze({
    id: "payment-clerk", kind: "worker", model: "muse-spark-1.3", orchestratedBy: ORCHESTRATOR_ID,
    tools: ["invoicing engine"],
    implements: "src/lib/web-store.mjs:pay",
    status: "live",
    job: "Settles payments against the invoice, preserves part-payment balances, and refuses overpayment.",
  }),
  Object.freeze({
    id: "customer-messenger", kind: "worker", model: "muse-spark-1.3", orchestratedBy: ORCHESTRATOR_ID,
    tools: ["notifications engine", "WhatsApp address formatter"],
    implements: "src/lib/whatsapp-store.mjs:confirmationMessage",
    status: "live",
    job: "Prepares the rendered customer confirmation for named human approval. It never sends.",
  }),
  Object.freeze({
    id: "workflow-verifier", kind: "verifier", model: "muse-wonder-1.0", orchestratedBy: ORCHESTRATOR_ID,
    tools: ["workflow evidence trail"],
    implements: "src/lib/multi-agent.mjs:verifySaleEvidence",
    status: "live",
    job: "Checks that stock, price, order, invoice and payment evidence agree before the workflow is called complete.",
  }),
  Object.freeze({
    id: "offline-fallback", kind: "fallback", model: "ollama (local) + engine rules", orchestratedBy: ORCHESTRATOR_ID,
    tools: ["landed engine (local)", "warehouse engine (local)", "order engine (local)"],
    implements: "src/lib/multi-agent.mjs:runSaleWorkflow",
    status: "live",
    job: "Runs the same deterministic sale workflow when model services are unavailable; model-only advice is labelled unavailable, never invented.",
  }),
]);

const ALLOWED_MODELS = new Set([
  "muse-wonder-1.0",
  "muse-spark-1.3",
  "muse-image-1.0",
  "muse-voice-transcribe-1.0",
  "sam-3.1",
  "ollama (local) + engine rules",
]);

/** Validate the business-agent registry before any workflow trusts it. */
export function validateAgentRegistry(agents = BUSINESS_AGENTS) {
  const blockers = [];
  const ids = new Set();
  for (const agent of agents) {
    if (!agent?.id) { blockers.push("agent_id_required"); continue; }
    if (ids.has(agent.id)) blockers.push(`duplicate_agent:${agent.id}`);
    ids.add(agent.id);
    if (!ALLOWED_MODELS.has(agent.model)) blockers.push(`model_not_allowed:${agent.id}`);
    if (!/^src\/.+:[A-Za-z][A-Za-z0-9_]*$/.test(agent.implements ?? "")) blockers.push(`implementation_not_named:${agent.id}`);
    if (!["live", "planned"].includes(agent.status)) blockers.push(`status_invalid:${agent.id}`);
  }
  const orchestrators = agents.filter((a) => a.kind === "orchestrator");
  if (orchestrators.length !== 1 || orchestrators[0]?.id !== ORCHESTRATOR_ID) blockers.push("single_business_orchestrator_required");
  for (const agent of agents) {
    if (agent.kind !== "orchestrator" && agent.orchestratedBy !== ORCHESTRATOR_ID) {
      blockers.push(`agent_not_orchestrated:${agent.id}`);
    }
  }
  return { ok: blockers.length === 0, blockers, agentCount: agents.length };
}

export const BUSINESS_FLOWS = Object.freeze({
  film_sale: Object.freeze(["catalogue-curator", "store-keeper", "payment-clerk", "customer-messenger", "workflow-verifier"]),
  whatsapp_sale: Object.freeze(["catalogue-curator", "store-keeper", "payment-clerk", "customer-messenger", "workflow-verifier"]),
  web_store_sale: Object.freeze(["catalogue-curator", "store-keeper", "payment-clerk", "customer-messenger", "workflow-verifier"]),
});

/** Plan a sale without executing it: ordered agents, dependencies and evidence each step must leave. */
export function planWorkflow(kind) {
  const flow = BUSINESS_FLOWS[kind];
  if (!flow) return { ok: false, blockers: [`unknown_workflow:${kind}`], steps: [] };
  const evidence = {
    "catalogue-curator": ["film_check", "landed_price"],
    "store-keeper": ["stock_position", "credit_decision", "order", "invoice"],
    "payment-clerk": ["payment_result", "invoice_balance"],
    "customer-messenger": ["rendered_confirmation", "approval_required"],
    "workflow-verifier": ["price_consistency", "complete_evidence_trail"],
  };
  return {
    ok: true,
    kind,
    orchestrator: ORCHESTRATOR_ID,
    steps: flow.map((agentId, index) => ({
      order: index + 1,
      agentId,
      dependsOn: index === 0 ? [] : [flow[index - 1]],
      evidenceRequired: evidence[agentId],
    })),
  };
}

/** The verifier's rule: same price everywhere, and no missing step in the trail. */
export function verifySaleEvidence({ catalogue, shelf, checkoutResult, paymentResult, steps }) {
  const blockers = [];
  if (!catalogue?.filmReady) blockers.push("film_not_ready");
  if (!shelf?.offerable) blockers.push("stock_unavailable");
  if (!checkoutResult?.ok) blockers.push("checkout_not_completed");
  if (catalogue && shelf && catalogue.priceKes !== shelf.priceKes) blockers.push("price_changed_between_channels");
  const orderLine = checkoutResult?.order?.lines?.[0];
  if (orderLine && catalogue && orderLine.unitValue !== catalogue.priceKes) blockers.push("order_price_differs_from_catalogue");
  if (paymentResult && !paymentResult.ok) blockers.push("payment_failed");
  if (paymentResult?.ok && paymentResult.balance > 0) blockers.push("payment_incomplete");
  for (const step of ["catalogue-curator", "store-keeper", "payment-clerk", "customer-messenger"]) {
    if (!steps?.some((s) => s.agentId === step)) blockers.push(`evidence_missing:${step}`);
  }
  return { ok: blockers.length === 0, blockers };
}

function blocked(status, steps, blockers, extra = {}) {
  return { ok: false, status, steps, blockers, ...extra };
}

/**
 * Run one sale across the agents. `channel` is film, WhatsApp or web store; all three converge on
 * the same catalogue price, warehouse stock, order, invoice and payment. The outbound confirmation
 * is returned for approval with sent:false — this workflow has no authority to contact a customer.
 */
export function runSaleWorkflow({ channel = "web_store_sale", item, sku, lots, account, qty = 1, phone, payment = null, outstandingKes = 0, series = [], promisedAt = "to be confirmed" } = {}) {
  const plan = planWorkflow(channel);
  if (!plan.ok) return blocked("blocked", [], plan.blockers);
  const registry = validateAgentRegistry();
  if (!registry.ok) return blocked("blocked", [], registry.blockers);

  const steps = [];
  const catalogue = catalogueLine(item);
  steps.push({ agentId: "catalogue-curator", action: "check_film_and_price", ok: catalogue.filmReady, evidence: { priceKes: catalogue.priceKes, filmBlockers: catalogue.filmBlockers } });
  if (!catalogue.filmReady) return blocked("blocked", steps, catalogue.filmBlockers, { catalogue });

  const shelf = shelfItem({ sku, item, lots });
  const checkoutResult = shelf.offerable
    ? checkout({ account, lines: [{ name: item.name, qty, priceKes: shelf.priceKes }], outstandingKes, series })
    : { ok: false, gate: { approved: false, reason: "out of stock" } };
  steps.push({ agentId: "store-keeper", action: "check_stock_credit_and_checkout", ok: checkoutResult.ok, evidence: { available: shelf.available, offerable: shelf.offerable, gate: checkoutResult.gate } });
  if (!checkoutResult.ok) return blocked("blocked", steps, [checkoutResult.gate?.reason ?? "checkout_refused"], { catalogue, shelf });

  const { order, invoice } = checkoutResult;
  const paymentResult = payment ? pay(invoice, payment) : { ok: false, balance: invoice.balance, paid: invoice.paid, reason: "payment_not_supplied" };
  steps.push({ agentId: "payment-clerk", action: "settle_invoice", ok: paymentResult.ok && paymentResult.balance === 0, evidence: { balance: paymentResult.balance, reason: paymentResult.reason ?? null } });

  const outbound = phone ? {
    channel: "whatsapp",
    to: waNumber(phone),
    text: confirmationMessage(order, { accountName: account.name ?? account.id, amount: invoice.total, promisedAt }),
    requiresApproval: true,
    sent: false,
  } : null;
  steps.push({ agentId: "customer-messenger", action: "prepare_confirmation", ok: Boolean(outbound), evidence: { requiresApproval: true, sent: false } });

  const verification = verifySaleEvidence({ catalogue, shelf, checkoutResult, paymentResult: payment ? paymentResult : null, steps });
  steps.push({ agentId: "workflow-verifier", action: "verify_evidence", ok: verification.ok, evidence: verification });

  if (payment && !paymentResult.ok) return blocked("payment_failed", steps, [paymentResult.reason], { catalogue, shelf, order, invoice, paymentResult, outbound, verification });
  if (!payment || paymentResult.balance > 0) {
    return { ok: false, status: "payment_pending", steps, blockers: ["payment_incomplete"], catalogue, shelf, order, invoice, paymentResult, outbound, verification };
  }
  if (!verification.ok) return blocked("verification_failed", steps, verification.blockers, { catalogue, shelf, order, invoice, paymentResult, outbound, verification });

  return {
    ok: true,
    status: "ready_for_dispatch",
    steps,
    blockers: [],
    catalogue,
    shelf,
    order,
    invoice: paymentResult.invoice,
    paymentResult,
    outbound,
    verification,
    execution: "deterministic_engines",
  };
}

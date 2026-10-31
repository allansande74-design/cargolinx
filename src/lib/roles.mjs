/**
 * Roles, entities and the credit gate for CargoLinx matchmaking.
 *
 * Two companies, two document sets, chosen by document type — never by the
 * logged-in user's preference:
 *  - ALTOVEX GLOBAL LOGISTICS CO. LTD (seller) — quotations, invoices, POs.
 *  - ALTOVEX CARGOLINX (platform) — tracking views, customs files, PoDs.
 *
 * Pure module, no UI, no database. Mirrors engine/accounts.mjs semantics for
 * the matchmaking lane; the engine remains the canonical store.
 */

export const ENTITIES = Object.freeze({
  seller: Object.freeze({
    key: "seller",
    name: "ALTOVEX GLOBAL LOGISTICS CO. LTD",
    role: "Sourcing, purchase and sale of goods",
    registration: "Kenya — details on file",
    address: "P.O. Box 3515-00100 Nairobi, Kenya",
    contact: "+254 718 554 383 · altovexgl@gmail.com",
    bank: "Cooperative Bank of Kenya · 01192952690600 · SWIFT COOPKENA",
  }),
  platform: Object.freeze({
    key: "platform",
    name: "ALTOVEX CARGOLINX",
    role: "Freight matching, customs file preparation and last-mile tracking",
    registration: "A product of Dreamteam Consulting",
    address: "Nairobi, Kenya",
    contact: "+254 718 554 383",
    bank: null,
  }),
});

/** Document type → owning entity → header block. */
export function documentHeader(kind) {
  if (kind === "quotation" || kind === "invoice" || kind === "purchase_order") {
    return { ...ENTITIES.seller, purpose: kind };
  }
  if (kind === "tracking" || kind === "pod" || kind === "customs_file") {
    return { ...ENTITIES.platform, purpose: kind };
  }
  throw new Error(`no entity defined for ${kind}`);
}

export const ROLES = Object.freeze({
  client_admin: Object.freeze({
    label: "Client administrator",
    can: Object.freeze(["order.create", "order.view", "order.approve", "quote.view", "document.view", "tracking.view", "user.invite"]),
  }),
  client_user: Object.freeze({
    label: "Client user",
    can: Object.freeze(["order.create", "order.view", "quote.view", "document.view", "tracking.view"]),
  }),
  operations: Object.freeze({
    label: "Altovex operations",
    can: Object.freeze(["order.view", "order.advance", "order.hold", "document.attach", "document.verify", "warehouse.receive", "warehouse.pick", "warehouse.pack", "dispatch.create", "tracking.view", "account.view"]),
  }),
  driver: Object.freeze({
    label: "Driver",
    can: Object.freeze(["tracking.view", "pod.capture"]),
  }),
  admin: Object.freeze({ label: "Platform administrator", can: Object.freeze(["*"]) }),
});

/** Permission predicate: may `role` perform `action`? */
export function can(role, action) {
  const r = ROLES[role];
  if (!r) return false;
  return r.can.includes("*") || r.can.includes(action);
}

/**
 * creditDecision(account, orderTotal) — the gate on acceptance.
 * An order above the limit is held with the shortfall printed, never
 * silently accepted or refused. Prepayment accounts must be funded
 * before dispatch, not before the order.
 *
 * account: { status?, terms?, creditLimitKes? } — terms one of
 *   prepayment | net15 | net30. orderTotal is the order total including
 *   statutory charges (compare exposure, not goods value alone).
 *
 * @returns {{ approved: boolean, reason: string, shortfallKes: number, headroomKes: number, requiresFunding: boolean }}
 */
export function creditDecision(account, orderTotal, outstandingKes = 0) {
  if (!account) throw new Error("account required");
  const total = Number(orderTotal);
  if (!Number.isFinite(total) || total < 0) throw new Error("orderTotal must be a non-negative number");
  const outstanding = Number(outstandingKes) || 0;
  if (account.status && account.status !== "active") {
    return { approved: false, reason: `account ${account.status}`, shortfallKes: total, headroomKes: 0, requiresFunding: true };
  }
  if (account.terms === "prepayment" || (!account.terms && !Number(account.creditLimitKes))) {
    return {
      approved: total === 0,
      reason: total === 0 ? "prepayment terms — nil order, nothing to fund" : "prepayment terms — fund KES " + total.toFixed(2) + " before dispatch",
      shortfallKes: total,
      headroomKes: 0,
      requiresFunding: true,
    };
  }
  const limit = Number(account.creditLimitKes) || 0;
  const headroom = limit - outstanding;
  if (total > headroom) {
    const shortfall = total - headroom;
    return {
      approved: false,
      reason: `order exceeds credit headroom by ${shortfall.toFixed(2)}`,
      shortfallKes: Math.round(shortfall * 100) / 100,
      headroomKes: Math.round(headroom * 100) / 100,
      requiresFunding: true,
    };
  }
  return {
    approved: true,
    reason: `within ${account.terms} terms`,
    shortfallKes: 0,
    headroomKes: Math.round((headroom - total) * 100) / 100,
    requiresFunding: false,
  };
}

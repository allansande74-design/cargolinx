/**
 * Accounts, roles and the two legal entities.
 *
 * Two companies sit behind one platform and must never be blurred on a document:
 *  - ALTOVEX GLOBAL LOGISTICS CO. LTD — the seller. It sources, buys and invoices goods.
 *  - ALTOVEX CARGOLINX — the platform. It matches freight, tracks the last mile and holds the file.
 *
 * Accounts are tenant-scoped: every record carries accountId, and a user only sees their own.
 */

export const ENTITIES = {
  seller: {
    key: "seller",
    name: "ALTOVEX GLOBAL LOGISTICS CO. LTD",
    role: "Sourcing, purchase and sale of goods",
    registration: "Kenya — details on file",
    address: "P.O. Box 3515-00100 Nairobi, Kenya",
    contact: "+254 718 554 383 · altovexgl@gmail.com",
    bank: "Cooperative Bank of Kenya · 01192952690600 · SWIFT COOPKENA",
  },
  platform: {
    key: "platform",
    name: "ALTOVEX CARGOLINX",
    role: "Freight matching, customs file preparation and last-mile tracking",
    registration: "A product of Dreamteam Consulting",
    address: "Nairobi, Kenya",
    contact: "+254 718 554 383",
    bank: null,
  },
};

export const ROLES = {
  client_admin: {
    label: "Client administrator",
    can: ["order.create", "order.view", "order.approve", "quote.view", "document.view", "tracking.view", "user.invite"],
  },
  client_user: {
    label: "Client user",
    can: ["order.create", "order.view", "quote.view", "document.view", "tracking.view"],
  },
  ops: {
    label: "Altovex operations",
    can: ["order.view", "order.advance", "order.hold", "document.attach", "document.verify", "warehouse.receive", "warehouse.pick", "warehouse.pack", "dispatch.create", "tracking.view", "account.view"],
  },
  driver: {
    label: "Driver",
    can: ["tracking.view", "pod.capture"],
  },
  admin: {
    label: "Platform administrator",
    can: ["*"],
  },
};

export function can(role, action) {
  const r = ROLES[role];
  if (!r) return false;
  return r.can.includes("*") || r.can.includes(action);
}

export function assertCan(role, action) {
  if (!can(role, action)) throw new Error(`${role} is not permitted to ${action}`);
  return true;
}

/** A trading company opening an account on the platform. */
export function createAccount({ name, country = "KE", taxPin = null, contact = null, creditLimitKes = 0, terms = "prepayment" }) {
  if (!name || name.trim().length < 2) throw new Error("account name required");
  if (!["prepayment", "net15", "net30"].includes(terms)) throw new Error(`unknown terms ${terms}`);
  return {
    id: `acc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    country,
    taxPin,
    contact,
    creditLimitKes,
    terms,
    status: "active",
    createdAt: new Date().toISOString(),
  };
}

export function createUser({ accountId, name, email, role = "client_user" }) {
  if (!ROLES[role]) throw new Error(`unknown role ${role}`);
  if (!accountId) throw new Error("accountId required");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email ?? ""))) throw new Error("valid email required");
  return { id: `usr_${Math.random().toString(36).slice(2, 9)}`, accountId, name, email: email.toLowerCase(), role, status: "invited", createdAt: new Date().toISOString() };
}

/** Every read path goes through this so one account cannot see another's records. */
export function scoped(records, user) {
  if (!user) throw new Error("a signed-in user is required");
  if (can(user.role, "*")) return records;
  return records.filter((r) => r.accountId === user.accountId);
}

/** The right letterhead for the function being performed. */
export function documentHeader(kind) {
  if (kind === "quotation" || kind === "invoice" || kind === "purchase_order") {
    return { ...ENTITIES.seller, purpose: kind };
  }
  if (kind === "tracking" || kind === "pod" || kind === "customs_file") {
    return { ...ENTITIES.platform, purpose: kind };
  }
  throw new Error(`no entity defined for ${kind}`);
}

/**
 * Credit check before an order is accepted.
 * Prepayment accounts must be funded; credit accounts are capped.
 */
export function creditDecision({ account, orderValueKes, outstandingKes = 0 }) {
  if (!account) throw new Error("account required");
  if (account.status !== "active") return { approved: false, reason: `account ${account.status}` };
  if (account.terms === "prepayment") return { approved: true, reason: "prepayment terms — funds required before dispatch", requiresFunding: true };
  const headroom = account.creditLimitKes - outstandingKes;
  if (orderValueKes > headroom) {
    return { approved: false, reason: `order exceeds credit headroom by ${(orderValueKes - headroom).toFixed(2)}`, requiresFunding: true, headroom };
  }
  return { approved: true, reason: `within ${account.terms} terms`, requiresFunding: false, headroom: headroom - orderValueKes };
}

/**
 * Stakeholder dashboards: one catalogue, one scope rule, one set of numbers.
 *
 * Every dashboard reads the same book through the same scope function, so a client never sees
 * another client's file and two dashboards cannot disagree about the same figure. The numbers are
 * derived here, not in the screens: the screens only lay them out.
 *
 * Pure functions, no UI, no database.
 */
import { STAGES, nextStage, blockersFor, slaState, orderValueKes } from "../../engine/orders.mjs";
import { ageing } from "../../engine/invoicing.mjs";
import { eligibility } from "../../engine/partners.mjs";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const day = 86400000;

export const DASHBOARD_SPECS = [
  { key: "overview", role: "overview", file: "overview.jsx", title: "Group overview", sub: "Orders, cash and fleet in one read across the platform." },
  { key: "admin", role: "admin", file: "admin.jsx", title: "Platform administration", sub: "Accounts, users, partner approvals and the outbox." },
  { key: "operations", role: "operations", file: "operations.jsx", title: "Operations desk", sub: "Every live file, its stage and what is blocking the next step." },
  { key: "user", role: "user", file: "user.jsx", title: "Client workspace", sub: "Your orders, your invoices and your documents." },
  { key: "buyer", role: "buyer", file: "buyer.jsx", title: "Buyer dashboard", sub: "What you have ordered, what is late, what you owe." },
  { key: "seller", role: "seller", file: "seller.jsx", title: "Seller dashboard", sub: "Quotes, orders and receivables for the selling entity." },
  { key: "driver", role: "driver", file: "driver.jsx", title: "Driver runs", sub: "Your assignments, the next stop and the proof of delivery." },
  { key: "transporter", role: "transporter", file: "transporter.jsx", title: "Transporter dashboard", sub: "Fleet readiness by plate, lane and paper." },
  { key: "clearing-agent", role: "clearing-agent", file: "clearing-agent.jsx", title: "Clearing agent desk", sub: "Files at the border and the documents that release them." },
  { key: "insurer", role: "insurer", file: "insurer.jsx", title: "Insurer view", sub: "Cargo in transit, declared value and open exceptions." },
  { key: "finance-partner", role: "finance-partner", file: "finance-partner.jsx", title: "Finance partner", sub: "Receivables, ageing and credit exposure by account." },
  { key: "trade-finance-escrow", role: "trade-finance-escrow", file: "trade-finance-escrow.jsx", title: "Trade finance & escrow", sub: "Milestones, funds held and releases waiting on evidence." },
  { key: "sourcing", role: "sourcing", file: "sourcing.jsx", title: "Sourcing desk", sub: "Supplier offers, landed cost and files still being sourced." },
  { key: "procurement", role: "procurement", file: "procurement.jsx", title: "Procurement desk", sub: "Purchase orders, committed spend and supplier standing." },
  { key: "crm", role: "crm", file: "crm.jsx", title: "CRM", sub: "Accounts, activity and who has gone quiet." },
  { key: "sales-marketing", role: "sales-marketing", file: "sales-marketing.jsx", title: "Sales & marketing", sub: "Pipeline value, quotes out and conversion." },
  { key: "hr", role: "hr", file: "hr.jsx", title: "People", sub: "Users by role, drivers on the road and invitations pending." },
  { key: "match", role: "match", file: "match.jsx", title: "Match board", sub: "Loads waiting against trucks that may legally take them." },
];

export const DASHBOARD_KEYS = DASHBOARD_SPECS.map((s) => s.key);

export function dashboardIndex() {
  return DASHBOARD_SPECS.map((s) => ({ ...s }));
}

export function specFor(key) {
  return DASHBOARD_SPECS.find((s) => s.key === key) ?? null;
}

/** Client-side dashboards a client administrator may open on behalf of their own account. */
const CLIENT_VIEWS = {
  client_admin: ["user", "buyer", "seller"],
  client_user: ["user", "buyer"],
};

/**
 * Who may open which dashboard. Platform administrators may open all of them; everyone else is
 * held to their own role, plus the client views their account role legitimately covers.
 */
export function canOpen(user, key) {
  const spec = specFor(key);
  if (!spec) return { allowed: false, reason: `no dashboard named "${key}"` };
  if (!user) return { allowed: true, reason: "no session — demonstration view" };
  if (user.role === "admin") return { allowed: true, reason: "platform administrator" };
  if (user.role === spec.role) return { allowed: true, reason: "own role" };
  if ((CLIENT_VIEWS[user.role] ?? []).includes(key)) return { allowed: true, reason: "client account view" };
  return { allowed: false, reason: `${user.role} may not open the ${spec.title.toLowerCase()} dashboard` };
}

/** Roles whose work is the whole book rather than one account. */
const PLATFORM_ROLES = new Set([
  "admin", "operations", "overview", "crm", "sales-marketing", "hr",
  "procurement", "sourcing", "trade-finance-escrow", "match", "transporter",
  "clearing-agent", "insurer", "finance-partner", "seller", "overview",
]);

/**
 * Scope the order book to the person asking. Returns the rows *and* the basis they were read on,
 * because "no rows" and "no scope" are different facts and the screen must say which it is showing.
 */
export function scopeOrders(orders = [], user = null) {
  const list = Array.isArray(orders) ? orders : [];
  if (!user) return { orders: list, basis: "sample", note: "No session — showing the demonstration book." };
  if (PLATFORM_ROLES.has(user.role)) return { orders: list, basis: "platform", note: "Platform view across all accounts." };
  if (user.role === "driver") {
    const name = String(user.name ?? "").trim().toLowerCase();
    const mine = name ? list.filter((o) => String(o.driverName ?? "").trim().toLowerCase() === name) : [];
    if (mine.length) return { orders: mine, basis: "assignment", note: `Loads assigned to ${user.name}.` };
    return { orders: list.filter((o) => o.stage === "dispatched"), basis: "sample", note: "No load is assigned to this session — showing loads currently on the road." };
  }
  if (user.accountId) {
    return { orders: list.filter((o) => o.accountId === user.accountId), basis: "account", note: "Scoped to your account." };
  }
  return { orders: list, basis: "sample", note: "No account is attached to this session — showing the demonstration book." };
}

export function scopeInvoices(invoices = [], user = null) {
  const list = Array.isArray(invoices) ? invoices : [];
  if (!user) return { invoices: list, basis: "sample", note: "Demonstration book." };
  if (PLATFORM_ROLES.has(user.role)) return { invoices: list, basis: "platform", note: "Platform view." };
  if (user.accountId) return { invoices: list.filter((i) => i.accountId === user.accountId), basis: "account", note: "Your account." };
  return { invoices: list, basis: "sample", note: "Demonstration book." };
}

export function orderTotal(order) {
  if (order == null) return 0;
  if (Number.isFinite(Number(order.valueKes))) return num(order.valueKes);
  const lines = Array.isArray(order.lines) ? order.lines : [];
  if (lines.some((l) => l.unitValue != null)) return orderValueKes(lines);
  return lines.reduce((a, l) => a + num(l.qty) * num(l.unitPriceKes ?? l.unitPrice), 0);
}

export const stageLabel = (key) => STAGES.find((s) => s.key === key)?.label ?? String(key ?? "unknown");

export const stageIndex = (key) => STAGES.findIndex((s) => s.key === key);

export function trucks(partners = []) {
  const rows = [];
  for (const p of Array.isArray(partners) ? partners : []) {
    for (const v of p.fleet ?? []) {
      rows.push({ owner: p.ownerName ?? p.name ?? "—", partnerId: p.id ?? null, partnerStatus: p.status ?? "pending", ...v });
    }
  }
  return rows;
}

/** Is this plate eligible for its first declared corridor today? Papers are checked, not assumed. */
export function truckState(partners = [], truck, at = new Date()) {
  const partner = (Array.isArray(partners) ? partners : []).find((p) => p.id === truck?.partnerId);
  if (!partner) return { eligible: false, blockers: ["partner record missing"], missing: [] };
  const corridor = (truck.corridors ?? [])[0] ?? "northern";
  let verdict;
  try {
    verdict = eligibility(partner, { plate: truck.plate, at, corridor, weightKg: truck.capacityKg });
  } catch (err) {
    return { eligible: false, blockers: [err.message], missing: [], corridor };
  }
  const docs = partner.fleet?.find((v) => v.plate === truck.plate)?.documents ?? {};
  const required = Object.keys(docs).length ? Object.keys(docs) : [];
  return {
    eligible: Boolean(verdict.eligible),
    blockers: verdict.blockers ?? [],
    missing: required.filter((t) => docs[t]?.status !== "verified"),
    corridor,
  };
}

/** Files whose promise date has passed or is inside the next 24 hours. */
export function atRisk(orders = [], now = new Date()) {
  return (Array.isArray(orders) ? orders : [])
    .map((o) => ({ order: o, sla: slaState(o, now) }))
    .filter((r) => ["late", "at risk", "delivered late"].includes(r.sla.status));
}

/** What the next stage of this file needs before it can move. */
export function blockers(order) {
  const target = nextStage(order);
  if (!target) return { target: null, missing: [], note: "file is closed" };
  const res = blockersFor(order, target);
  if (res.skip) {
    const after = nextStage({ ...order, stage: target });
    return { target: after, missing: after ? blockersFor(order, after).missing : [], note: `skips ${stageLabel(target)}` };
  }
  return { target, missing: res.missing ?? [], note: res.missing?.length ? "" : "ready to advance" };
}

const sum = (rows, f) => rows.reduce((a, r) => a + num(f(r)), 0);

export function kpisFor(role, data = {}) {
  const orders = data.orders ?? [];
  const invoices = data.invoices ?? [];
  const partners = data.partners ?? [];
  const accounts = data.accounts ?? [];
  const fleet = trucks(partners);
  const open = orders.filter((o) => !["delivered", "cancelled"].includes(o.stage));
  const unpaid = invoices.filter((i) => i.status !== "paid");
  const outstanding = sum(unpaid, (i) => (i.balance ?? num(i.total) - num(i.paid)));
  const risk = atRisk(orders, data.now ?? new Date());
  const ready = fleet.filter((t) => truckState(partners, t, data.now ?? new Date()).eligible);

  switch (role) {
    case "overview":
      return [
        { k: "Open files", v: open.length },
        { k: "Pipeline value", v: money(sum(open, orderTotal)), money: true },
        { k: "Outstanding", v: money(outstanding), money: true },
        { k: "Trucks ready", v: `${ready.length} of ${fleet.length}` },
      ];
    case "admin":
      return [
        { k: "Accounts", v: accounts.length },
        { k: "Users", v: sum(accounts, (a) => (a.users ?? []).length) },
        { k: "Partner records", v: partners.length },
        { k: "Pending approvals", v: partners.filter((p) => p.status !== "approved").length },
      ];
    case "operations":
      return [
        { k: "Live files", v: open.length },
        { k: "Ready to advance", v: orders.filter((o) => blockers(o).missing.length === 0 && nextStage(o)).length },
        { k: "At risk", v: risk.length },
        { k: "Value at risk", v: money(sum(risk, (r) => orderTotal(r.order))), money: true },
      ];
    case "driver":
      return [
        { k: "Runs open", v: open.length },
        { k: "On the road", v: orders.filter((o) => o.stage === "dispatched").length },
        { k: "POD outstanding", v: orders.filter((o) => o.stage === "dispatched" && !o.pod).length },
        { k: "Delivered", v: orders.filter((o) => o.stage === "delivered").length },
      ];
    case "transporter":
      return [
        { k: "Trucks", v: fleet.length },
        { k: "Eligible today", v: ready.length },
        { k: "Paper gaps", v: fleet.filter((t) => truckState(partners, t, data.now ?? new Date()).missing.length).length },
        { k: "Capacity ready", v: `${Math.round(ready.reduce((a, t) => a + num(t.capacityKg), 0) / 1000)} t` },
      ];
    case "clearing-agent":
      return [
        { k: "In transit", v: orders.filter((o) => o.stage === "in_transit").length },
        { k: "At border", v: orders.filter((o) => o.stage === "arrived").length },
        { k: "Awaiting GRN", v: orders.filter((o) => ["arrived", "in_transit"].includes(o.stage) && !o.grnRef).length },
        { k: "Duty exposure", v: money(sum(orders.filter((o) => ["in_transit", "arrived"].includes(o.stage)), (o) => num(o.dutyKes ?? o.duty))), money: true },
      ];
    case "insurer":
      return [
        { k: "Cargo on the road", v: orders.filter((o) => ["in_transit", "dispatched"].includes(o.stage)).length },
        { k: "Declared value", v: money(sum(orders.filter((o) => ["in_transit", "dispatched"].includes(o.stage)), orderTotal)), money: true },
        { k: "Delivered", v: orders.filter((o) => o.stage === "delivered").length },
        { k: "Open exceptions", v: orders.filter((o) => o.receiptStatus === "variance").length },
      ];
    case "finance-partner":
    case "seller": {
      const age = ageing(unpaid, data.now ?? new Date());
      return [
        { k: "Invoices open", v: unpaid.length },
        { k: "Outstanding", v: money(outstanding), money: true },
        { k: "Over 60 days", v: money(age.buckets?.["60+"] ?? 0), money: true },
        { k: "Credit exposure", v: money(sum(accounts, (a) => num(a.creditLimitKes))), money: true },
      ];
    }
    case "trade-finance-escrow":
      return [
        { k: "Milestones due", v: orders.filter((o) => ["purchased", "freight_booked"].includes(o.stage)).length },
        { k: "Funds to hold", v: money(sum(orders.filter((o) => ["purchased", "freight_booked", "in_transit"].includes(o.stage)), orderTotal)), money: true },
        { k: "Awaiting evidence", v: orders.filter((o) => ["freight_booked", "in_transit"].includes(o.stage) && !o.transportRef).length },
        { k: "Released", v: orders.filter((o) => o.stage === "delivered").length },
      ];
    case "sourcing":
      return [
        { k: "Being sourced", v: orders.filter((o) => o.stage === "sourcing").length },
        { k: "Supplier named", v: orders.filter((o) => o.supplier).length },
        { k: "At landed cost", v: money(sum(orders, (o) => num(o.purchaseValue))), money: true },
        { k: "Cost gaps", v: orders.filter((o) => ["confirmed", "sourcing"].includes(o.stage) && !o.purchaseValue).length },
      ];
    case "procurement":
      return [
        { k: "POs raised", v: orders.filter((o) => o.poRef).length },
        { k: "Committed spend", v: money(sum(orders, (o) => num(o.purchaseValue))), money: true },
        { k: "Suppliers in file", v: new Set(orders.map((o) => o.supplier).filter(Boolean)).size },
        { k: "Awaiting PO", v: orders.filter((o) => o.stage === "sourcing" && !o.poRef).length },
      ];
    case "crm":
      return [
        { k: "Accounts", v: accounts.length },
        { k: "Trading", v: new Set(orders.map((o) => o.accountId).filter(Boolean)).size },
        { k: "Quiet accounts", v: accounts.filter((a) => !orders.some((o) => o.accountId === a.id)).length },
        { k: "Files open", v: open.length },
      ];
    case "sales-marketing":
      return [
        { k: "Pipeline", v: money(sum(open, orderTotal)), money: true },
        { k: "Quotes out", v: orders.filter((o) => ["draft", "confirmed", "sourcing"].includes(o.stage)).length },
        { k: "Converted", v: orders.filter((o) => stageIndex(o.stage) >= stageIndex("purchased")).length },
        { k: "Accounts", v: accounts.length },
      ];
    case "hr":
      return [
        { k: "Users", v: sum(accounts, (a) => (a.users ?? []).length) },
        { k: "Drivers on the road", v: new Set(orders.filter((o) => o.driverName).map((o) => o.driverName)).size },
        { k: "Invitations pending", v: sum(accounts, (a) => (a.users ?? []).filter((u) => u.status === "invited").length) },
        { k: "Accounts", v: accounts.length },
      ];
    case "match":
      return [
        { k: "Loads waiting", v: orders.filter((o) => ["confirmed", "sourcing", "purchased"].includes(o.stage)).length },
        { k: "Trucks eligible", v: ready.length },
        { k: "Trucks idle", v: fleet.length - ready.length },
        { k: "Weight to move", v: `${Math.round(sum(orders.filter((o) => ["confirmed", "sourcing", "purchased"].includes(o.stage)), (o) => num(o.weightKg)) / 1000)} t` },
      ];
    case "buyer":
    case "user":
    default:
      return [
        { k: "Orders", v: orders.length },
        { k: "In progress", v: open.length },
        { k: "Outstanding", v: money(outstanding), money: true },
        { k: "At risk", v: risk.length },
      ];
  }
}

/** The work list: one reason per row, written so an operator can act on it without opening the file. */
export function attentionFor(role, data = {}) {
  const orders = data.orders ?? [];
  const invoices = data.invoices ?? [];
  const partners = data.partners ?? [];
  const accounts = data.accounts ?? [];
  const now = data.now ?? new Date();
  const fleet = trucks(partners);
  const risk = atRisk(orders, now);
  const out = [];

  if (["operations", "overview", "admin"].includes(role)) {
    for (const r of risk.slice(0, 5)) {
      out.push({
        severity: r.sla.status === "late" ? "high" : "medium",
        title: `${r.order.id} ${r.sla.status}`,
        detail: r.sla.lateByHours != null ? `${r.sla.lateByHours}h past the promise to ${r.order.destination?.city ?? r.order.destination?.name ?? "the consignee"}` : `promise due in ${r.sla.hoursToPromise}h`,
        ref: r.order.id,
      });
    }
  }

  if (["operations", "admin"].includes(role)) {
    for (const o of orders.slice(0, 12)) {
      const b = blockers(o);
      if (b.target && b.missing.length) {
        out.push({ severity: "medium", title: `${o.id} cannot reach ${stageLabel(b.target)}`, detail: `missing ${b.missing.join(", ")}`, ref: o.id });
      }
    }
  }

  if (["finance-partner", "seller", "overview", "user", "buyer", "client_admin", "client_user"].includes(role)) {
    for (const inv of invoices.filter((i) => i.status !== "paid")) {
      const days = Math.floor((new Date(now).getTime() - new Date(inv.issuedAt).getTime()) / day);
      if (days >= 30) out.push({ severity: days >= 60 ? "high" : "medium", title: `${inv.number ?? inv.orderId} unpaid ${days} days`, detail: `balance ${money(inv.balance ?? num(inv.total) - num(inv.paid))} · ${inv.kind ?? "invoice"}`, ref: inv.orderId });
    }
  }

  if (["transporter", "match", "admin"].includes(role)) {
    for (const t of fleet) {
      const st = truckState(partners, t, now);
      if (!st.eligible) out.push({ severity: "medium", title: `${t.plate} not eligible on ${st.corridor}`, detail: (st.blockers ?? []).join("; ") || "papers incomplete", ref: t.plate });
    }
  }

  if (["clearing-agent"].includes(role)) {
    for (const o of orders.filter((x) => ["in_transit", "arrived"].includes(x.stage))) {
      if (!o.grnRef) out.push({ severity: o.stage === "arrived" ? "high" : "low", title: `${o.id} waiting on a goods received note`, detail: `carrier ${o.carrier ?? "not named"} · ref ${o.transportRef ?? "none"}`, ref: o.id });
    }
  }

  if (["insurer"].includes(role)) {
    for (const o of orders.filter((x) => x.receiptStatus === "variance")) {
      out.push({ severity: "high", title: `${o.id} received with a variance`, detail: `variance ${o.receiptVariance ?? "unstated"} units on GRN ${o.grnRef}`, ref: o.id });
    }
  }

  if (["crm", "sales-marketing"].includes(role)) {
    for (const a of accounts) {
      if (!orders.some((o) => o.accountId === a.id)) out.push({ severity: "low", title: `${a.name} has never ordered`, detail: `opened ${String(a.createdAt ?? "").slice(0, 10)} · ${a.terms}`, ref: a.id });
    }
  }

  if (role === "driver") {
    for (const o of orders.filter((x) => x.stage === "dispatched" && !x.pod)) {
      out.push({ severity: "high", title: `POD needed for ${o.id}`, detail: `${o.destination?.city ?? o.destination?.name ?? "consignee"} · tracking ${o.trackingRef ?? "none"}`, ref: o.id });
    }
  }

  if (["user", "buyer", "seller", "client_admin", "client_user"].includes(role)) {
    for (const o of risk) out.push({ severity: "medium", title: `${o.order.id} ${o.sla.status}`, detail: `promise ${String(o.order.promisedAt ?? "").slice(0, 10) || "not set"}`, ref: o.order.id });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 8);
}

export function money(n) {
  const v = Math.round(num(n));
  return `KES ${v.toLocaleString("en-KE")}`;
}

export function shortDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

/**
 * Order lifecycle: sourcing → freight → Nairobi warehouse → fulfilment → last mile.
 *
 * The state machine is the product. A stage cannot be entered without the data that makes the
 * previous stage true — no "shipped" without a carrier and a reference, no "received" without a
 * goods-received note and counts, no "delivered" without a proof of delivery.
 *
 * Dropship orders skip the warehouse entirely: the supplier ships to the client's customer, and the
 * file jumps from arrival to dispatch. That is a different flow, not a different system.
 */

export const ORDER_TYPES = {
  import: { label: "Import through Nairobi warehouse", usesWarehouse: true },
  dropship: { label: "Dropship — supplier to consignee", usesWarehouse: false },
  domestic: { label: "Domestic movement", usesWarehouse: true },
};

export const STAGES = [
  { key: "draft", label: "Draft", requires: [] },
  { key: "confirmed", label: "Confirmed", requires: ["accountId", "lines"] },
  { key: "sourcing", label: "Sourcing", requires: [] },
  { key: "purchased", label: "Purchased from supplier", requires: ["supplier", "poRef", "purchaseValue"] },
  { key: "freight_booked", label: "Freight booked", requires: ["carrier", "transportRef"] },
  { key: "in_transit", label: "In transit", requires: [] },
  { key: "arrived", label: "Arrived at port or border", requires: [] },
  { key: "received", label: "Received at Nairobi warehouse", requires: ["grnRef", "receivedQty"], warehouseOnly: true },
  { key: "picked", label: "Picked", requires: ["pickedQty"], warehouseOnly: true },
  { key: "packed", label: "Packed", requires: ["packedQty"], warehouseOnly: true },
  { key: "dispatched", label: "Dispatched on last mile", requires: ["vehicleId", "driverName", "trackingRef"] },
  { key: "delivered", label: "Delivered", requires: ["signedBy"] },
];

const stageIndex = (key) => STAGES.findIndex((s) => s.key === key);

export function orderValueKes(lines = []) {
  return Math.round(lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unitValue) || 0), 0) * 100) / 100;
}

export function createOrder({ accountId, type = "import", lines = [], destination = {}, incoterm = "DAP", promisedAt = null, currency = "KES" }) {
  if (!accountId) throw new Error("accountId required — an order belongs to an account");
  if (!ORDER_TYPES[type]) throw new Error(`unknown order type ${type}`);
  if (!Array.isArray(lines) || lines.length === 0) throw new Error("at least one order line required");
  for (const [i, l] of lines.entries()) {
    if (!l.description) throw new Error(`line ${i + 1}: description required`);
    if (!(Number(l.qty) > 0)) throw new Error(`line ${i + 1}: quantity must be positive`);
  }
  return {
    id: `ord_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    accountId,
    type,
    lines,
    destination,
    incoterm,
    currency,
    promisedAt,
    stage: "draft",
    history: [{ stage: "draft", at: new Date().toISOString(), note: "Order created" }],
    valueKes: orderValueKes(lines),
    createdAt: new Date().toISOString(),
  };
}

/** What is missing before the next stage can be entered. */
export function blockersFor(order, target) {
  const spec = STAGES.find((s) => s.key === target);
  if (!spec) throw new Error(`unknown stage ${target}`);
  if (spec.warehouseOnly && !ORDER_TYPES[order.type].usesWarehouse) return { skip: true, missing: [] };
  const missing = (spec.requires ?? []).filter((k) => order[k] === undefined || order[k] === null || order[k] === "" || (Array.isArray(order[k]) && order[k].length === 0));
  return { skip: false, missing };
}

export function nextStage(order) {
  const i = stageIndex(order.stage);
  for (let j = i + 1; j < STAGES.length; j++) {
    const cand = STAGES[j];
    if (cand.warehouseOnly && !ORDER_TYPES[order.type].usesWarehouse) continue;
    return cand.key;
  }
  return null;
}

/**
 * Advance the order. Data for the new stage arrives with the transition and is written first, so a
 * guard is never satisfied by a value that was not recorded.
 */
export function advance(order, data = {}, { role = "ops", at = new Date().toISOString() } = {}) {
  if (order.stage === "delivered") throw new Error("order is already delivered");
  if (order.stage === "cancelled") throw new Error("order is cancelled");
  const target = data.stage ?? nextStage(order);

  const idxNow = stageIndex(order.stage);
  const idxTarget = stageIndex(target);
  if (idxTarget <= idxNow) throw new Error(`cannot move backwards from ${order.stage} to ${target}`);
  if (idxTarget > idxNow + 1 && role !== "admin") throw new Error(`only an administrator may skip from ${order.stage} to ${target}`);

  const merged = { ...order, ...data };
  delete merged.stage;

  const { skip, missing } = blockersFor(merged, target);
  if (!skip && missing.length) throw new Error(`cannot enter ${target}: missing ${missing.join(", ")}`);

  const allowed =
    role === "admin" ||
    (["warehouse.receive", "warehouse.pick", "warehouse.pack"].includes(`warehouse.${target}`) && ["ops", "admin"].includes(role)) ||
    ["ops", "admin", "driver"].includes(role);
  if (!allowed) throw new Error(`${role} may not advance this order`);

  return {
    ...merged,
    stage: skip ? nextStage({ ...merged, stage: target }) ?? target : target,
    updatedAt: at,
    history: [...(order.history ?? []), { stage: target, at, note: data.note ?? "", by: role }],
  };
}

/** Goods received against what was ordered. Over, short and damaged are stated, not smoothed over. */
export function receiveGoods(order, { grnRef, receipts = [], at = new Date().toISOString() }) {
  if (!grnRef) throw new Error("goods received note reference required");
  const lines = order.lines.map((l) => {
    const r = receipts.find((x) => x.description === l.description) ?? { qty: 0, damaged: 0 };
    const received = Number(r.qty) || 0;
    const damaged = Number(r.damaged) || 0;
    return { description: l.description, ordered: l.qty, received, damaged, variance: received + damaged - l.qty };
  });
  const totalOrdered = lines.reduce((a, l) => a + l.ordered, 0);
  const totalReceived = lines.reduce((a, l) => a + l.received, 0);
  const totalDamaged = lines.reduce((a, l) => a + l.damaged, 0);
  const clean = lines.every((l) => l.variance === 0 && l.damaged === 0);
  return {
    ...order,
    grnRef,
    receivedQty: totalReceived,
    receipts: lines,
    receiptVariance: totalReceived + totalDamaged - totalOrdered,
    receiptStatus: clean ? "clean" : "variance",
    updatedAt: at,
  };
}

/** Dispatch creates the last-mile job and hands the vehicle to the tracking layer. */
export function dispatch(order, { vehicleId, driverName, driverPhone = null, trackingRef, plannedRoute = null, at = new Date().toISOString() }) {
  if (!vehicleId) throw new Error("vehicleId required — last mile cannot be tracked without a vehicle");
  if (!driverName) throw new Error("driverName required");
  if (!trackingRef) throw new Error("trackingRef required");
  const job = {
    id: `job_${Date.now().toString(36)}`,
    orderId: order.id,
    accountId: order.accountId,
    vehicleId,
    driverName,
    driverPhone,
    trackingRef,
    plannedRoute,
    status: "dispatched",
    createdAt: at,
  };
  return {
    order: {
      ...order,
      vehicleId,
      driverName,
      driverPhone,
      trackingRef,
      stage: "dispatched",
      updatedAt: at,
      history: [...(order.history ?? []), { stage: "dispatched", at, note: `Vehicle ${vehicleId} · ${driverName}` }],
    },
    job,
  };
}

/** Delivery closes the file, and the proof is a document, not a status. */
export function deliver(order, { signedBy, signatureRef = null, photoRef = null, at = new Date().toISOString() }) {
  if (!signedBy) throw new Error("proof of delivery must name who signed");
  return {
    ...order,
    stage: "delivered",
    pod: { signedBy, signatureRef, photoRef, at },
    updatedAt: at,
    history: [...(order.history ?? []), { stage: "delivered", at, note: `Signed by ${signedBy}` }],
  };
}

/** Where the order stands against its promise. */
export function slaState(order, now = new Date()) {
  if (!order.promisedAt) return { status: "no promise", promisedAt: null };
  const due = new Date(order.promisedAt).getTime();
  const t = new Date(now).getTime();
  const hours = (due - t) / 3600000;
  if (order.stage === "delivered") {
    const late = t > due;
    return { status: late ? "delivered late" : "delivered on time", promisedAt: order.promisedAt, hoursToPromise: Math.round(hours) };
  }
  if (hours < 0) return { status: "late", promisedAt: order.promisedAt, lateByHours: Math.round(-hours) };
  if (hours <= 24) return { status: "at risk", promisedAt: order.promisedAt, hoursToPromise: Math.round(hours) };
  return { status: "on track", promisedAt: order.promisedAt, hoursToPromise: Math.round(hours) };
}

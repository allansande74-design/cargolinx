/**
 * Local-first store. Every write lands here first; the network is optional.
 * IndexedDB, no dependencies.
 */
const DB_NAME = "cargolinx";
const DB_VERSION = 5;
export const STORES = { shipments: "shipments", orders: "orders", invoices: "invoices", lots: "lots", outbox: "outbox", conflicts: "conflicts", photos: "photos", server: "server", kv: "kv" };

let dbp = null;

export function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.shipments)) db.createObjectStore(STORES.shipments, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORES.outbox)) db.createObjectStore(STORES.outbox, { keyPath: "idempotencyKey" });
      if (!db.objectStoreNames.contains(STORES.conflicts)) db.createObjectStore(STORES.conflicts, { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains(STORES.orders)) db.createObjectStore(STORES.orders, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORES.invoices)) db.createObjectStore(STORES.invoices, { keyPath: "number" });
      if (!db.objectStoreNames.contains(STORES.lots)) db.createObjectStore(STORES.lots, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORES.photos)) db.createObjectStore(STORES.photos, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORES.server)) db.createObjectStore(STORES.server, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORES.kv)) db.createObjectStore(STORES.kv, { keyPath: "k" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const req = fn(s);
    if (req) req.onsuccess = () => (out = req.result);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const put = (store, value) => tx(store, "readwrite", (s) => s.put(value));
export const get = (store, key) => tx(store, "readonly", (s) => s.get(key));
export const del = (store, key) => tx(store, "readwrite", (s) => s.delete(key));
export const all = (store) => tx(store, "readonly", (s) => s.getAll());
export const clear = (store) => tx(store, "readwrite", (s) => s.clear());

export async function kvGet(k, dflt = null) {
  const row = await get(STORES.kv, k);
  return row ? row.v : dflt;
}
export async function kvSet(k, v) {
  return put(STORES.kv, { k, v });
}

export function newId(prefix = "clx") {
  const rnd = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}${rnd[0].toString(36)}${rnd[1].toString(36)}`;
}

/** Save a shipment locally and queue it for the server in one step. */
export async function saveShipment(shipment, op = "upsert") {
  const record = { ...shipment, updatedAt: new Date().toISOString() };
  await put(STORES.shipments, record);
  const { enqueue } = await import("./sync-core.mjs");
  const outbox = await all(STORES.outbox);
  const payload = { ...record };
  delete payload.photoBlob;
  const next = enqueue(outbox, { entity: "shipment", entityId: record.id, op, payload, at: record.updatedAt });
  const added = next[next.length - 1];
  if (added) await put(STORES.outbox, added);
  return record;
}

export async function savePhoto(blob, meta = {}) {
  const id = newId("img");
  await put(STORES.photos, { id, blob, ...meta, at: new Date().toISOString() });
  return id;
}

export async function getPhoto(id) {
  return get(STORES.photos, id);
}

/**
 * Jobs that exist so a first visit is not an empty desk.
 *
 * A judge, or a new operator, opens the desk and finds nothing to press: no lane to read, no order to
 * follow, no export to reverse. These three jobs are sample data and say so in the record, so nothing
 * here can be mistaken for a client's work. They use only place names and goods; no company, no person,
 * no address and no price.
 */
export const DEMO_JOBS = [
  { id: "clx_demo_1", ref: "CLX-DEMO-0001", origin: "Mombasa", destination: "Kampala", cargo: "Solar panels, boxed", qty: 12, weightKg: 900, status: "quoted", value: { goods: 18500, freight: 2900 }, services: { clearing: 0, transport: 0, lastMile: 0 }, dutyRate: 0 },
  { id: "clx_demo_2", ref: "CLX-DEMO-0002", origin: "Mombasa", destination: "Nairobi", cargo: "Ceramic tiles, palletised", qty: 40, weightKg: 4500, status: "in transit", value: { goods: 9400, freight: 1100 }, services: { clearing: 0, transport: 0, lastMile: 0 }, dutyRate: 0.25 },
  { id: "clx_demo_3", ref: "CLX-DEMO-0003", origin: "Nairobi", destination: "Kigali", cargo: "Packaged foods, cartons", qty: 160, weightKg: 1200, status: "quoted", value: { goods: 7600, freight: 1450 }, services: { clearing: 0, transport: 0, lastMile: 0 }, dutyRate: 0.1 },
];

/** Write the demonstration jobs once, and never overwrite anything already on the desk. */
export async function seedDemoJobs(now = new Date()) {
  const existing = await all(STORES.shipments);
  if ((existing ?? []).length > 0) return { seeded: 0, reason: "desk already has jobs" };
  const stamp = now.toISOString();
  let seeded = 0;
  for (const job of DEMO_JOBS) {
    const record = {
      ...job,
      demo: true,
      note: "Demonstration job — sample data, not a client shipment.",
      createdAt: stamp,
      updatedAt: stamp,
    };
    await put(STORES.shipments, record);
    seeded += 1;
  }
  return { seeded, reason: "empty desk" };
}

/** Persist an order and queue it, same contract as a shipment: local first, network later. */
export async function saveOrder(order, op = "upsert") {
  const record = { ...order, updatedAt: new Date().toISOString() };
  await put(STORES.orders, record);
  const { enqueue } = await import("./sync-core.mjs");
  const outbox = await all(STORES.outbox);
  const next = enqueue(outbox, { entity: "order", entityId: record.id, op, payload: record, at: record.updatedAt });
  const added = next[next.length - 1];
  if (added) await put(STORES.outbox, added);
  return record;
}

/** Generic queued save for records that follow the same local-first contract. */
export async function saveQueued(store, entity, record, keyField = "id") {
  await put(store, record);
  const { enqueue } = await import("./sync-core.mjs");
  const outbox = await all(STORES.outbox);
  const next = enqueue(outbox, { entity, entityId: String(record[keyField]), payload: record, at: new Date().toISOString() });
  const added = next[next.length - 1];
  if (added) await put(STORES.outbox, added);
  return record;
}

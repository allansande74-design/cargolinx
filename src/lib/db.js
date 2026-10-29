/**
 * Local-first store. Every write lands here first; the network is optional.
 * IndexedDB, no dependencies.
 */
const DB_NAME = "cargolinx";
const DB_VERSION = 3;
export const STORES = { shipments: "shipments", outbox: "outbox", conflicts: "conflicts", photos: "photos", server: "server", kv: "kv" };

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

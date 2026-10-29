/**
 * Sync layer. Two adapters behind one interface:
 *  - loopback: a demo server kept inside IndexedDB, so the offline/reconnect story can be
 *    demonstrated and tested with no network and no credentials. It is labelled as such in the UI.
 *  - supabase: the real backend, used only when a URL and key are configured.
 */
import { STORES, all, put, kvGet, kvSet } from "./db.js";
import { collapseForPush, acknowledge, mergeList } from "./sync-core.mjs";

export async function getConfig() {
  return (
    (await kvGet("backend")) ?? {
      mode: "loopback",
      label: "Demo server (loopback, on this device)",
      url: "",
      key: "",
      table: "shipments",
    }
  );
}

export async function setConfig(cfg) {
  await kvSet("backend", cfg);
  return cfg;
}

const loopback = {
  async push(record, key) {
    const rows = (await all(STORES.server)) ?? [];
    const existing = rows.find((r) => r.id === record.id);
    const seen = existing?.seen ?? [];
    if (seen.includes(key)) return { duplicate: true, record: existing };
    const incoming = { ...record, seen: [...seen, key].slice(-200) };
    if (!existing) {
      await put(STORES.server, incoming);
      return { created: true, record: incoming };
    }
    const newer = new Date(record.updatedAt ?? 0) >= new Date(existing.updatedAt ?? 0);
    const winner = newer ? { ...incoming, id: existing.id } : existing;
    await put(STORES.server, winner);
    return { merged: true, record: winner, conflict: !newer || record.status !== existing.status };
  },
  async pull() {
    return (await all(STORES.server)) ?? [];
  },
  async healthy() {
    return true;
  },
};

const supabase = (cfg) => ({
  async push(record) {
    const res = await fetch(`${cfg.url}/rest/v1/${cfg.table}?on_conflict=id`, {
      method: "POST",
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([record]),
    });
    if (!res.ok) throw new Error(`backend ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return { pushed: true };
  },
  async pull() {
    const res = await fetch(`${cfg.url}/rest/v1/${cfg.table}?select=*&order=updatedAt.desc&limit=200`, {
      headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
    });
    if (!res.ok) throw new Error(`backend ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return res.json();
  },
  async healthy() {
    const res = await fetch(`${cfg.url}/rest/v1/`, { headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` } });
    return res.ok;
  },
});

export async function adapter() {
  const cfg = await getConfig();
  return { cfg, impl: cfg.mode === "supabase" ? supabase(cfg) : loopback };
}

const online = () => (typeof navigator === "undefined" ? true : navigator.onLine);

/**
 * Push everything queued, then pull. Safe to call as often as you like:
 * the idempotency keys make a replay harmless.
 */
export async function flush() {
  if (!online()) return { ok: false, reason: "offline", pushed: 0, conflicts: [] };
  const { cfg, impl } = await adapter();
  const outbox = (await all(STORES.outbox)) ?? [];
  if (outbox.length === 0) {
    const rows = await impl.pull().catch(() => []);
    return { ok: true, reason: "nothing queued", pushed: 0, pulled: rows.length, conflicts: [] };
  }
  const { send, superseded } = collapseForPush(outbox);
  const done = [];
  const conflicts = [];
  let lastError = null;
  for (const entry of send) {
    try {
      const record = { id: entry.entityId, ...entry.payload, updatedAt: entry.at };
      const res = await impl.push(record, entry.idempotencyKey);
      done.push(entry.idempotencyKey);
      if (res?.conflict) conflicts.push({ id: entry.entityId, at: new Date().toISOString(), kind: "merge" });
    } catch (err) {
      lastError = err.message;
      break;
    }
  }
  const remaining = acknowledge(outbox, [...done, ...superseded.map((s) => s.idempotencyKey)]);
  const { clear } = await import("./db.js");
  await clear(STORES.outbox);
  for (const e of remaining) await put(STORES.outbox, e);

  for (const c of conflicts) await put(STORES.conflicts, c);

  let pulled = 0;
  if (done.length) {
    const remote = await impl.pull().catch(() => []);
    const local = (await all(STORES.shipments)) ?? [];
    const { rows, conflicts: listConflicts } = mergeList(local, remote.map(({ seen, ...r }) => r));
    for (const r of rows) await put(STORES.shipments, r);
    for (const c of listConflicts) await put(STORES.conflicts, { ...c, id: `c_${c.entityId}_${Date.now()}`, at: new Date().toISOString() });
    pulled = remote.length;
  }
  return { ok: !lastError, reason: lastError ?? "synced", pushed: done.length, pulled, conflicts, backend: cfg.label };
}

export async function queueDepth() {
  return ((await all(STORES.outbox)) ?? []).length;
}

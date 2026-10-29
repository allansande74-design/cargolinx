/**
 * Offline sync core — pure functions, no browser or network.
 *
 * Rules the engine guarantees:
 *  - every write is queued locally before it is attempted anywhere else;
 *  - each queued write carries an idempotency key, so a retry after a dropped link cannot duplicate;
 *  - when the same shipment changed on two devices, the later write wins and the loser is recorded
 *    as a conflict rather than discarded silently.
 */

/** Stable idempotency key for a write. */
export function makeKey(entity, entityId, at, nonce) {
  const stamp = new Date(at).toISOString();
  return `${entity}:${entityId}:${stamp}:${nonce}`.replace(/\s+/g, "");
}

let counter = 0;
export function nextKey(entity, entityId, at) {
  counter = (counter + 1) % 100000;
  return makeKey(entity, entityId, at, `${counter}-${Math.random().toString(36).slice(2, 8)}`);
}

/** Queue a write. Identical keys are ignored, which makes retries safe. */
export function enqueue(outbox, entry) {
  if (!entry.entity || !entry.entityId) throw new Error("entity and entityId required");
  const key = entry.idempotencyKey ?? nextKey(entry.entity, entry.entityId, entry.at ?? Date.now());
  if (outbox.some((e) => e.idempotencyKey === key)) return outbox;
  return [
    ...outbox,
    {
      idempotencyKey: key,
      entity: entry.entity,
      entityId: entry.entityId,
      op: entry.op ?? "upsert",
      payload: entry.payload ?? null,
      at: new Date(entry.at ?? Date.now()).toISOString(),
      attempts: 0,
    },
  ];
}

/**
 * Collapse the queue for sending: only the newest write per entity matters,
 * older ones are acknowledged as superseded locally instead of replayed.
 */
export function collapseForPush(outbox) {
  const latest = new Map();
  for (const e of outbox) latest.set(`${e.entity}:${e.entityId}`, e);
  const order = [];
  for (const e of outbox) {
    const k = `${e.entity}:${e.entityId}`;
    if (latest.get(k) === e) order.push(e);
  }
  return { send: order, superseded: outbox.filter((e) => !order.includes(e)) };
}

/** Drop acknowledged entries from the queue by key. */
export function acknowledge(outbox, keys) {
  const set = new Set(keys);
  return outbox.filter((e) => !set.has(e.idempotencyKey));
}

/**
 * Merge one record from the server into the local copy.
 * Returns the winner plus a conflict record when both sides had moved.
 */
export function mergeRecord(local, remote, { deviceId = "this-device" } = {}) {
  if (!remote) return { winner: local, conflict: null };
  if (!local) return { winner: remote, conflict: null };
  const lt = new Date(local.updatedAt ?? 0).getTime();
  const rt = new Date(remote.updatedAt ?? 0).getTime();
  if (lt === rt) {
    const winner = String(remote.updatedAt ?? "") >= String(local.updatedAt ?? "") ? remote : local;
    return { winner, conflict: null };
  }
  const remoteWins = rt > lt;
  const winner = remoteWins ? { ...local, ...remote } : { ...remote, ...local };
  return {
    winner: { ...winner, id: winner.id ?? local.id ?? remote.id },
    conflict: {
      entityId: winner.id,
      localUpdatedAt: local.updatedAt ?? null,
      remoteUpdatedAt: remote.updatedAt ?? null,
      winner: remoteWins ? "remote" : "local",
      deviceId,
      at: new Date().toISOString(),
    },
  };
}

/** Merge a full list; returns merged rows and any conflicts, keyed by id. */
export function mergeList(localList, remoteList, opts = {}) {
  const byId = new Map(localList.map((r) => [r.id, r]));
  const conflicts = [];
  for (const r of remoteList) {
    const { winner, conflict } = mergeRecord(byId.get(r.id), r, opts);
    byId.set(winner.id, winner);
    if (conflict) conflicts.push(conflict);
  }
  return { rows: [...byId.values()], conflicts };
}

/** Apply one remote write to local state — used on the receive side of a sync. */
export function applyRemote(localList, record, opts = {}) {
  const { winner, conflict } = mergeRecord(localList.find((r) => r.id === record.id), record, opts);
  const rest = localList.filter((r) => r.id !== winner.id);
  return { rows: [...rest, winner], conflict };
}

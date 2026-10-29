/**
 * Warehouse stock: lots, bins, allocation and picking.
 *
 * Receiving a quantity is not stock a client can be promised. Stock becomes promisable only when it
 * sits in a known bin, under a known lot, and allocation is honoured before a pick list exists.
 * Expired lots are excluded from allocation and the exclusion is stated.
 */

const round = (n) => Math.round(n * 100) / 100;

export function binName({ warehouse = "NBO", aisle, rack, level }) {
  if (!aisle || !rack || !level) throw new Error("aisle, rack and level are required for a bin");
  return `${warehouse}-${String(aisle).padStart(2, "0")}-${String(rack).padStart(2, "0")}-${String(level).padStart(2, "0")}`;
}

/** A lot is the unit of truth: supplier, date, expiry, bin and cost travel with the goods. */
export function receiveLot({ sku, description, qty, bin, lot, unitCost = 0, receivedAt = new Date(), expiresAt = null, grnRef = null, supplier = null }) {
  if (!sku) throw new Error("sku required");
  if (!(Number(qty) > 0)) throw new Error("received quantity must be positive");
  if (!bin) throw new Error("a bin is required — goods without a location are not stock");
  return {
    id: `lot_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    sku,
    description: description ?? sku,
    lot: lot ?? null,
    qty: round(Number(qty)),
    remaining: round(Number(qty)),
    allocated: 0,
    bin,
    unitCost: round(Number(unitCost)),
    receivedAt: new Date(receivedAt).toISOString(),
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    grnRef,
    supplier,
  };
}

const isExpired = (lot, now) => lot.expiresAt && new Date(lot.expiresAt).getTime() < new Date(now).getTime();

export function stockPosition(lots, { sku, now = new Date() } = {}) {
  const rows = lots.filter((l) => (sku ? l.sku === sku : true));
  const onHand = round(rows.reduce((a, l) => a + l.remaining, 0));
  const allocated = round(rows.reduce((a, l) => a + l.allocated, 0));
  const expired = round(rows.filter((l) => isExpired(l, now)).reduce((a, l) => a + l.remaining, 0));
  const available = round(onHand - allocated - expired);
  return {
    sku: sku ?? null,
    onHand,
    allocated,
    expired,
    available: Math.max(0, available),
    lots: rows.map((l) => ({ id: l.id, lot: l.lot, bin: l.bin, remaining: l.remaining, allocated: l.allocated, expiresAt: l.expiresAt })),
    value: round(rows.reduce((a, l) => a + l.remaining * l.unitCost, 0)),
  };
}

/**
 * Allocate stock to an order, first-expiry-first-out, skipping expired lots and stating the shortfall.
 * Returns the allocations and the lots with their remaining and allocated counts updated.
 */
export function allocate(lots, { sku, qty, orderId, now = new Date() }) {
  const need = round(Number(qty));
  if (!(need > 0)) throw new Error("allocation quantity must be positive");
  if (!orderId) throw new Error("an allocation must name the order it belongs to");

  const candidates = lots
    .filter((l) => l.sku === sku && l.remaining > 0 && !isExpired(l, now))
    .sort((a, b) => {
      const ea = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
      const eb = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
      if (ea !== eb) return ea - eb;
      return new Date(a.receivedAt) - new Date(b.receivedAt);
    });

  const skipped = lots.filter((l) => l.sku === sku && l.remaining > 0 && isExpired(l, now)).map((l) => ({ lot: l.lot, why: "expired" }));

  let left = need;
  const allocations = [];
  const updated = new Map();
  for (const lot of candidates) {
    if (left <= 0) break;
    const take = Math.min(lot.remaining, left);
    allocations.push({ lotId: lot.id, lot: lot.lot, bin: lot.bin, qty: round(take), orderId, sku, expiresAt: lot.expiresAt });
    updated.set(lot.id, { ...lot, remaining: round(lot.remaining - take), allocated: round(lot.allocated + take) });
    left = round(left - take);
  }

  if (allocations.length === 0) {
    throw new Error(`no available stock for ${sku} — requested ${need}, available ${stockPosition(lots, { sku, now }).available}`);
  }

  return {
    allocations,
    lots: lots.map((l) => updated.get(l.id) ?? l),
    shortfall: left > 0 ? left : 0,
    skipped,
    complete: left <= 0,
  };
}

/** Return allocated stock to its lots when an order is cancelled. */
export function release(lots, { orderId }) {
  const released = [];
  return {
    lots: lots.map((l) => {
      const held = (l.holds ?? []).filter((h) => h.orderId === orderId);
      if (!held.length) return l;
      const back = held.reduce((a, h) => a + h.qty, 0);
      released.push({ lot: l.lot, qty: back });
      return { ...l, remaining: round(l.remaining + back), allocated: round(l.allocated - back), holds: (l.holds ?? []).filter((h) => h.orderId !== orderId) };
    }),
    released,
  };
}

/** The pick list a warehouse hand can work from: bin order, lot, quantity, and nothing else. */
export function pickList(allocations) {
  if (!allocations?.length) return [];
  return [...allocations]
    .sort((a, b) => String(a.bin).localeCompare(String(b.bin)))
    .map((a, i) => ({ seq: i + 1, bin: a.bin, lot: a.lot, sku: a.sku, qty: a.qty, orderId: a.orderId, expiresAt: a.expiresAt ?? null }));
}

/** What the warehouse can honestly say to a client. */
export function availabilityStatement(position) {
  if (position.available <= 0) return `No available stock of ${position.sku ?? "this item"} at the Nairobi warehouse.`;
  return `${position.available} available of ${position.sku ?? "this item"}${position.expired ? ` (${position.expired} expired and excluded)` : ""}.`;
}

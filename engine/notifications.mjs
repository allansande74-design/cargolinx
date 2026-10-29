/**
 * Notifications: what the customer is told, on which channel, and by whose hand.
 *
 * Three rules hold this module together:
 *  1. A message is a claim about the file, so every variable it prints comes from the payload. A
 *     template carries no defaults and no fallback wording: a missing field throws and names
 *     itself, because "your order" with a blank reference is worse than no message at all.
 *  2. Every channel has a hard length. Exceeding it is refused at render time rather than silently
 *     truncated — a truncated delivery reference is a wrong delivery reference.
 *  3. Nothing leaves the building on its own. Every item is queued 'pending', needs a named
 *     approver, and quiet hours are checked at the moment of sending, not of queueing.
 *
 * Pure functions over plain objects: no clock reads beyond an injected default, no I/O, no
 * Node-only APIs, so the same file runs in the browser bundle and in the tests.
 */

/** What each channel can carry. maxLength is characters of text actually transmitted. */
export const CHANNELS = {
  sms: { label: "SMS", supportsSubject: false, maxLength: 160 },
  whatsapp: { label: "WhatsApp", supportsSubject: false, maxLength: 1024 },
  email: { label: "Email", supportsSubject: true, maxLength: 2000 },
  inapp: { label: "In-app", supportsSubject: true, maxLength: 500 },
};

/**
 * The events the platform speaks about. Fields are written as {name} and are required; there is no
 * optional syntax on purpose, so a template cannot quietly print a hole. `amount`, `promisedAt` and
 * friends arrive display-ready from the caller (the engine does not invent currency or date formats).
 */
export const TEMPLATES = {
  order_confirmed: {
    subject: "Order {orderRef} confirmed",
    body: "Order {orderRef} is confirmed for {accountName}. {lineCount} line(s). Value {amount}. Promised {promisedAt}.",
  },
  purchase_placed: {
    subject: "Purchase placed — {poRef}",
    body: "{poRef} placed with {supplier} for {amount} against order {orderRef}. Expected {expectedAt}.",
  },
  freight_booked: {
    subject: "Freight booked — {orderRef}",
    body: "{carrier} booked under {transportRef} for order {orderRef}, departing {departureAt}.",
  },
  arrived: {
    subject: "Arrived — {orderRef}",
    body: "Order {orderRef} arrived at {location} on {arrivedAt}.",
  },
  warehouse_received: {
    subject: "Warehouse receipt — {orderRef}",
    body: "Order {orderRef} received under {grnRef}: {receivedQty} received, condition {receiptStatus}.",
  },
  dispatched: {
    subject: "Out for delivery — {orderRef}",
    body: "Order {orderRef} left with {driverName} in {vehicleId}. Tracking {trackingRef}.",
  },
  delivered: {
    subject: "Delivered — {orderRef}",
    body: "Order {orderRef} delivered on {deliveredAt}, signed by {signedBy}.",
  },
  invoice_issued: {
    subject: "Invoice {invoiceNumber}",
    body: "Invoice {invoiceNumber} for order {orderRef}: {amount}, due {dueAt}.",
  },
  payment_received: {
    subject: "Payment received — {invoiceNumber}",
    body: "Payment {amount} received against invoice {invoiceNumber} on {paidAt}, reference {paymentRef}.",
  },
  document_outstanding: {
    subject: "Document outstanding — {orderRef}",
    body: "Order {orderRef} is held: {documentName} is outstanding and is needed by {neededBy}.",
  },
};

export const EVENT_KEYS = Object.keys(TEMPLATES);

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

/** Every {field} a template prints, in order of first appearance. Derived, never hand-listed. */
function fieldsOf(template) {
  const found = [];
  for (const text of [template.subject ?? "", template.body]) {
    for (const m of text.matchAll(PLACEHOLDER)) if (!found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

const FIELDS = Object.fromEntries(Object.entries(TEMPLATES).map(([key, t]) => [key, fieldsOf(t)]));

/** Text or a finite number only: an object would interpolate as "[object Object]", which is invention. */
function displayValue(field, value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error(`field ${field} must be text or a number, got ${Array.isArray(value) ? "array" : typeof value}`);
}

const fill = (text, payload) => text.replace(PLACEHOLDER, (_m, field) => displayValue(field, payload[field]));

/**
 * Render one event for one channel.
 * Returns { eventKey, channel, subject, body, text, length, maxLength }. Subject is null on channels
 * that cannot carry one. The whole template's fields are required regardless of channel: the payload
 * must be complete for the event, not just for the part this channel happens to transmit.
 */
export function render(eventKey, payload = {}, channelKey) {
  const template = TEMPLATES[eventKey];
  if (!template) throw new Error(`unknown notification event ${eventKey}`);
  const channel = CHANNELS[channelKey];
  if (!channel) throw new Error(`unknown channel ${channelKey}`);
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${eventKey}: payload must be an object of fields`);
  }

  const missing = FIELDS[eventKey].filter((f) => payload[f] === undefined || payload[f] === null || payload[f] === "");
  if (missing.length) throw new Error(`${eventKey}: missing ${missing.join(", ")}`);

  const subject = channel.supportsSubject ? fill(template.subject, payload) : null;
  const body = fill(template.body, payload);
  const text = subject ? `${subject}\n${body}` : body;

  if (text.length > channel.maxLength) {
    throw new Error(`${eventKey}: ${text.length} characters over the ${channelKey} limit of ${channel.maxLength}`);
  }

  return { eventKey, channel: channelKey, subject, body, text, length: text.length, maxLength: channel.maxLength };
}

/** Template fields for an event — so a caller can check its payload before it queues anything. */
export function requiredFields(eventKey) {
  if (!FIELDS[eventKey]) throw new Error(`unknown notification event ${eventKey}`);
  return [...FIELDS[eventKey]];
}

const isoAt = (at, what) => {
  const t = at instanceof Date ? at.getTime() : Date.parse(at ?? "");
  if (!Number.isFinite(t)) throw new Error(`${what}: invalid time ${at}`);
  return new Date(t).toISOString();
};

/**
 * Queue one message. Returns a NEW queue; the input is never mutated.
 * `at` is both the enqueue stamp and the earliest send time — queued now means due now.
 * The rendered text is stored on the item, because the approval is an approval of that exact text.
 */
export function enqueueNotification(queue, { eventKey, payload = {}, channel, to, at = new Date() } = {}) {
  if (!Array.isArray(queue)) throw new Error("notification queue must be an array");
  if (!to || String(to).trim() === "") throw new Error("recipient required — a notification with no destination is a draft");
  const stamp = isoAt(at, "enqueueNotification");
  const message = render(eventKey, payload, channel);

  const item = {
    id: `ntf_${Date.parse(stamp).toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    eventKey,
    channel,
    to: String(to).trim(),
    payload,
    subject: message.subject,
    body: message.body,
    length: message.length,
    status: "pending",
    requiresApproval: true,
    at: stamp,
    createdAt: stamp,
    approvedBy: null,
    approvedAt: null,
    sentAt: null,
  };
  return [...queue, item];
}

/** Approve one item. A named human is required, and an approval cannot be given twice. */
export function approveNotification(queue, id, { by, at = new Date() } = {}) {
  if (!Array.isArray(queue)) throw new Error("notification queue must be an array");
  const item = queue.find((n) => n.id === id);
  if (!item) throw new Error(`notification ${id} is not in the queue`);
  if (!by || String(by).trim() === "") throw new Error("approval must name who approved — approvals are not anonymous");
  if (item.status === "approved") throw new Error(`notification ${id} was already approved by ${item.approvedBy}`);
  if (item.status === "sent") throw new Error(`notification ${id} was already sent at ${item.sentAt}`);
  if (item.status !== "pending") throw new Error(`notification ${id} is ${item.status} and cannot be approved`);

  const stamp = isoAt(at, "approveNotification");
  return queue.map((n) => (n.id === id ? { ...n, status: "approved", approvedBy: String(by).trim(), approvedAt: stamp } : n));
}

// --- quiet hours -------------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, "0");

const offsetLabel = (minutes) => {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

/**
 * Is `date` inside the recipient's quiet window?
 *
 * Pure arithmetic on the supplied offset — no Intl, no host timezone — so the answer is the same in
 * a browser, a worker and a test. The wall clock is UTC minutes shifted by the offset and wrapped
 * into the day. A window whose start is after its end wraps midnight (21:00–07:00); the start is
 * inclusive and the end exclusive, so 07:00 is already a civil hour and 21:00 is not.
 */
export function isWithinQuietHours(date, { startHour = 21, endHour = 7, timezoneOffsetMinutes = 0 } = {}) {
  const t = date instanceof Date ? date.getTime() : Date.parse(date ?? "");
  if (!Number.isFinite(t)) throw new Error("quiet hours need a valid date");

  const offset = Number(timezoneOffsetMinutes);
  if (!Number.isFinite(offset) || !Number.isInteger(offset) || offset < -720 || offset > 840) {
    throw new Error(`timezoneOffsetMinutes must be a whole number from -720 to 840, got ${timezoneOffsetMinutes}`);
  }
  for (const [name, hour] of [["startHour", startHour], ["endHour", endHour]]) {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error(`${name} must be a whole hour from 0 to 23, got ${hour}`);
  }
  if (startHour === endHour) throw new Error("quiet hours start and end cannot be the same hour — that window covers nothing or everything");

  const utcMinutes = Math.floor(t / 60000) % 1440;
  const localMinutes = (((utcMinutes + offset) % 1440) + 1440) % 1440;
  const start = startHour * 60;
  const end = endHour * 60;

  return start < end ? localMinutes >= start && localMinutes < end : localMinutes >= start || localMinutes < end;
}

/** The reason a send is blocked right now, or null. Stated, never implied. */
export function quietHoursReason(at, quietHours) {
  if (!quietHours) return null;
  if (!isWithinQuietHours(at, quietHours)) return null;
  const { startHour = 21, endHour = 7, timezoneOffsetMinutes = 0 } = quietHours;
  return `quiet hours ${pad(startHour)}:00–${pad(endHour)}:00 at UTC${offsetLabel(Number(timezoneOffsetMinutes))}, sending resumes at ${pad(endHour)}:00`;
}

// --- sending -----------------------------------------------------------------------------------

/** Approved and not yet sent, and already due. Pending items are never due — approval gates the send. */
export function dueNotifications(queue, at = new Date()) {
  if (!Array.isArray(queue)) throw new Error("notification queue must be an array");
  const now = Date.parse(at instanceof Date ? at.toISOString() : at);
  if (!Number.isFinite(now)) throw new Error(`invalid time ${at}`);
  return queue.filter((n) => n.status === "approved" && Date.parse(n.at) <= now);
}

/**
 * Send one approved item. Returns { queue, receipt } with a new queue.
 * Refusals are errors with the reason attached: unapproved, already sent, or quiet hours.
 */
export function sendNotification(queue, id, { at = new Date(), quietHours = null } = {}) {
  if (!Array.isArray(queue)) throw new Error("notification queue must be an array");
  const item = queue.find((n) => n.id === id);
  if (!item) throw new Error(`notification ${id} is not in the queue`);
  if (item.status === "sent") throw new Error(`notification ${id} was already sent at ${item.sentAt}`);
  if (item.status !== "approved") {
    throw new Error(`notification ${id} is ${item.status} — nothing is sent without approval by a named user`);
  }

  const stamp = isoAt(at, "sendNotification");
  const blocked = quietHoursReason(stamp, quietHours);
  if (blocked) throw new Error(`notification ${id} not sent: ${blocked}`);

  const receipt = { id: item.id, eventKey: item.eventKey, channel: item.channel, to: item.to, sentAt: stamp, approvedBy: item.approvedBy };
  const next = queue.map((n) => (n.id === id ? { ...n, status: "sent", sentAt: stamp } : n));
  return { queue: next, receipt };
}

/**
 * Send everything due. Quiet hours block the whole batch (they are local time, not per message), so
 * the blocked list comes back with reasons instead of throwing.
 */
export function sendDue(queue, { at = new Date(), quietHours = null } = {}) {
  const due = dueNotifications(queue, at);
  if (due.length === 0) return { queue, sent: [], blocked: [] };

  const blocked = quietHoursReason(at, quietHours);
  if (blocked) return { queue, sent: [], blocked: due.map((n) => ({ id: n.id, reason: blocked })) };

  let next = queue;
  const sent = [];
  for (const item of due) {
    const result = sendNotification(next, item.id, { at, quietHours });
    next = result.queue;
    sent.push(result.receipt);
  }
  return { queue: next, sent, blocked: [] };
}

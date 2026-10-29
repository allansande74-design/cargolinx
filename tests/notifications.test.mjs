import test from "node:test";
import assert from "node:assert/strict";
import {
  CHANNELS,
  TEMPLATES,
  EVENT_KEYS,
  render,
  requiredFields,
  enqueueNotification,
  approveNotification,
  dueNotifications,
  isWithinQuietHours,
  quietHoursReason,
  sendNotification,
  sendDue,
} from "../engine/notifications.mjs";

const AT = "2026-10-29T12:00:00Z";

/** One complete payload per event. Nothing here is optional: every field a template prints is set. */
const PAYLOADS = {
  order_confirmed: { orderRef: "ORD-1042", accountName: "Mwangi Traders", lineCount: 3, amount: "KES 2,550,000.00", promisedAt: "10 Nov 2026" },
  purchase_placed: { poRef: "PO-8821", supplier: "Kunpeng Solar", amount: "USD 18,400.00", orderRef: "ORD-1042", expectedAt: "24 Nov 2026" },
  freight_booked: { carrier: "Maersk", transportRef: "MAEU-4471209", orderRef: "ORD-1042", departureAt: "02 Nov 2026" },
  arrived: { orderRef: "ORD-1042", location: "Mombasa port", arrivedAt: "26 Nov 2026" },
  warehouse_received: { orderRef: "ORD-1042", grnRef: "GRN-77", receivedQty: 198, receiptStatus: "short by 2, none damaged" },
  dispatched: { orderRef: "ORD-1042", driverName: "Otieno", vehicleId: "KDG 123A", trackingRef: "TRK-5510" },
  delivered: { orderRef: "ORD-1042", deliveredAt: "02 Dec 2026", signedBy: "J. Mwangi" },
  invoice_issued: { invoiceNumber: "INV-2610-0007", orderRef: "ORD-1042", amount: "KES 2,958,000.00", dueAt: "17 Dec 2026" },
  payment_received: { amount: "KES 2,958,000.00", invoiceNumber: "INV-2610-0007", paidAt: "10 Dec 2026", paymentRef: "MPESA-QK71" },
  document_outstanding: { orderRef: "ORD-1042", documentName: "certificate of origin", neededBy: "20 Nov 2026" },
};

const queued = (eventKey = "delivered", payload = PAYLOADS.delivered, channel = "email", at = AT) =>
  enqueueNotification([], { eventKey, payload, channel, to: "j.mwangi@example.co.ke", at });

// --- templates ---------------------------------------------------------------------------------

test("every event renders its payload and prints no field it was not given", () => {
  assert.deepEqual(EVENT_KEYS.sort(), Object.keys(TEMPLATES).sort());
  assert.equal(EVENT_KEYS.length, 10);
  for (const key of EVENT_KEYS) {
    const message = render(key, PAYLOADS[key], "email");
    assert.equal(message.eventKey, key);
    assert.ok(message.subject && message.subject.length > 0, `${key} needs a subject`);
    assert.ok(message.body.length > 0, `${key} needs a body`);
    assert.doesNotMatch(message.text, /undefined|null|object Object|\[object/, `${key} leaked an empty value`);
    // every declared field actually appears in the rendered text
    for (const field of requiredFields(key)) {
      assert.ok(String(PAYLOADS[key][field]).length > 0);
      assert.ok(message.text.includes(String(PAYLOADS[key][field])), `${key}: ${field} not printed`);
    }
  }
});

test("a missing variable throws and names the field", () => {
  const { signedBy, ...withoutSigner } = PAYLOADS.delivered;
  assert.throws(() => render("delivered", withoutSigner, "sms"), /delivered: missing signedBy/);
  assert.throws(() => render("invoice_issued", { ...PAYLOADS.invoice_issued, amount: "" }, "email"), /missing amount/);
  // several at once are all named, not just the first
  assert.throws(() => render("dispatched", { orderRef: "ORD-1042" }, "inapp"), /missing driverName, vehicleId, trackingRef/);
  // null is a missing value, not something to print
  assert.throws(() => render("arrived", { ...PAYLOADS.arrived, location: null }, "sms"), /missing location/);
});

test("a field that is not text is refused rather than printed as an object", () => {
  assert.throws(() => render("order_confirmed", { ...PAYLOADS.order_confirmed, amount: { kes: 1 } }, "email"), /amount must be text or a number, got object/);
  assert.throws(() => render("arrived", { ...PAYLOADS.arrived, location: ["Mombasa"] }, "sms"), /got array/);
  // numbers are fine and are printed as written
  assert.match(render("warehouse_received", PAYLOADS.warehouse_received, "sms").body, /198 received/);
});

test("unknown events and channels are refused", () => {
  assert.throws(() => render("shipped_somewhere", PAYLOADS.arrived, "sms"), /unknown notification event/);
  assert.throws(() => render("arrived", PAYLOADS.arrived, "carrier_pigeon"), /unknown channel/);
  assert.throws(() => requiredFields("shipped_somewhere"), /unknown notification event/);
});

// --- channels ----------------------------------------------------------------------------------

test("channels declare what they can carry", () => {
  assert.equal(CHANNELS.sms.supportsSubject, false);
  assert.equal(CHANNELS.sms.maxLength, 160);
  assert.equal(CHANNELS.email.supportsSubject, true);
  assert.equal(render("delivered", PAYLOADS.delivered, "sms").subject, null);
  assert.equal(render("delivered", PAYLOADS.delivered, "email").subject, "Delivered — ORD-1042");
});

test("a message longer than the channel limit is refused, not truncated", () => {
  const long = { ...PAYLOADS.delivered, signedBy: "X".repeat(200) };
  assert.throws(() => render("delivered", long, "sms"), /over the sms limit of 160/);
  // the wider channels carry the same text
  assert.equal(render("delivered", long, "inapp").length < 500, true);
  assert.equal(render("delivered", long, "email").length > 160, true);
  assert.throws(() => render("delivered", { ...PAYLOADS.delivered, signedBy: "X".repeat(600) }, "inapp"), /over the inapp limit of 500/);

  // the check is on what is transmitted: subject counts on channels that carry one
  const subjectHeavy = { ...PAYLOADS.delivered, orderRef: "O".repeat(300) };
  const under = render("delivered", subjectHeavy, "email");
  assert.equal(under.body.length < 500, true, "the body alone fits in 500");
  assert.equal(under.length > 500, true, "subject plus body does not");
  assert.throws(() => render("delivered", subjectHeavy, "inapp"), /over the inapp limit of 500/);
  // a body at exactly the limit still passes; the filler is sized against the template's fixed
  // prefix and its closing full stop, so the boundary is tested rather than approximated
  const prefix = "Order ORD-1042 delivered on 02 Dec 2026, signed by ".length;
  const exact = "Y".repeat(160 - prefix - 1); // 160 minus the prefix and the closing full stop
  const atLimit = render("delivered", { ...PAYLOADS.delivered, signedBy: exact }, "sms");
  assert.equal(atLimit.length, 160);
  assert.equal(atLimit.text.endsWith("."), true);
  // one character more is refused
  assert.throws(() => render("delivered", { ...PAYLOADS.delivered, signedBy: exact + "Y" }, "sms"), /over the sms limit of 160/);
});

test("queueing validates the recipient and the message before anything is stored", () => {
  assert.throws(() => enqueueNotification([], { eventKey: "delivered", payload: PAYLOADS.delivered, channel: "sms", to: "  " }), /recipient required/);
  assert.throws(() => enqueueNotification([], { eventKey: "delivered", payload: { orderRef: "ORD-1042" }, channel: "sms", to: "+254718554383" }), /missing/);
  assert.throws(() => enqueueNotification([], { eventKey: "delivered", payload: PAYLOADS.delivered, channel: "sms", to: "+254718554383", at: "not a time" }), /invalid time/);
});

// --- queue and approval ------------------------------------------------------------------------

test("every queued notification is pending and requires approval", () => {
  const queue = queued();
  assert.equal(queue.length, 1);
  const [item] = queue;
  assert.equal(item.status, "pending");
  assert.equal(item.requiresApproval, true);
  assert.equal(item.approvedBy, null);
  assert.equal(item.sentAt, null);
  assert.equal(item.to, "j.mwangi@example.co.ke");
  assert.equal(item.length, item.body.length + item.subject.length + 1);
});

test("enqueueing returns a new queue and leaves the old one alone", () => {
  const first = queued("delivered");
  const second = enqueueNotification(first, { eventKey: "arrived", payload: PAYLOADS.arrived, channel: "sms", to: "+254718554383", at: AT });
  assert.equal(first.length, 1);
  assert.equal(second.length, 2);
  assert.notEqual(second[1].id, second[0].id);
});

test("nothing is sent before an approval", () => {
  const queue = queued();
  const { id } = queue[0];
  assert.throws(() => sendNotification(queue, id, { at: AT }), /pending — nothing is sent without approval/);
  assert.deepEqual(dueNotifications(queue, AT), []);
  assert.deepEqual(sendDue(queue, { at: AT }), { queue, sent: [], blocked: [] });
  // an approval still needs a name
  assert.throws(() => approveNotification(queue, id, { at: AT }), /must name who approved/);
  assert.throws(() => approveNotification(queue, "ntf_nope", { by: "Amanda", at: AT }), /not in the queue/);
});

test("approval records who approved, and a second approval is refused", () => {
  const queue = queued();
  const { id } = queue[0];
  const once = approveNotification(queue, id, { by: "Amanda", at: AT });
  assert.equal(once[0].status, "approved");
  assert.equal(once[0].approvedBy, "Amanda");
  assert.equal(once[0].approvedAt, "2026-10-29T12:00:00.000Z"); // ISO, normalised
  assert.equal(queue[0].status, "pending", "the original queue must not be mutated");

  assert.throws(() => approveNotification(once, id, { by: "Otieno", at: AT }), /already approved by Amanda/);

  const { queue: sent } = sendNotification(once, id, { at: AT });
  assert.equal(sent[0].status, "sent");
  assert.throws(() => approveNotification(sent, id, { by: "Otieno", at: AT }), /was already sent/);
  assert.throws(() => sendNotification(sent, id, { at: AT }), /was already sent/);
});

// --- due filtering -----------------------------------------------------------------------------

test("dueNotifications returns approved-and-unsent only, never pending", () => {
  const queue = [
    ...queued("delivered", PAYLOADS.delivered, "email", AT).map((n) => ({ ...n, id: "a" })),
    ...queued("arrived", PAYLOADS.arrived, "sms", AT).map((n) => ({ ...n, id: "b" })),
    ...queued("invoice_issued", PAYLOADS.invoice_issued, "email", AT).map((n) => ({ ...n, id: "c" })),
  ];
  let q = approveNotification(queue, "a", { by: "Amanda", at: AT });
  q = approveNotification(q, "b", { by: "Amanda", at: AT });

  assert.deepEqual(dueNotifications(q, AT).map((n) => n.id), ["a", "b"]);
  assert.equal(dueNotifications(q, AT).every((n) => n.status === "approved"), true);

  // once sent, it stops being due
  const { queue: after } = sendNotification(q, "a", { at: AT });
  assert.deepEqual(dueNotifications(after, AT).map((n) => n.id), ["b"]);

  // a message queued for later is not due yet
  const future = enqueueNotification([], { eventKey: "arrived", payload: PAYLOADS.arrived, channel: "sms", to: "+254718554383", at: "2026-10-30T09:00:00Z" });
  const futureApproved = approveNotification(future, future[0].id, { by: "Amanda", at: AT });
  assert.deepEqual(dueNotifications(futureApproved, AT), []);
  assert.equal(dueNotifications(futureApproved, "2026-10-30T09:00:00Z").length, 1);
});

test("sendDue sends the approved ones and states nothing about the pending ones", () => {
  const queue = [
    ...queued("delivered", PAYLOADS.delivered, "email", AT).map((n) => ({ ...n, id: "a" })),
    ...queued("arrived", PAYLOADS.arrived, "sms", AT).map((n) => ({ ...n, id: "b" })),
  ];
  const q = approveNotification(queue, "a", { by: "Amanda", at: AT });
  const result = sendDue(q, { at: "2026-10-29T13:00:00Z" });
  assert.deepEqual(result.sent.map((r) => r.id), ["a"]);
  assert.deepEqual(result.blocked, []);
  assert.equal(result.queue.find((n) => n.id === "a").status, "sent");
  assert.equal(result.queue.find((n) => n.id === "b").status, "pending");
  assert.equal(result.queue.find((n) => n.id === "b").sentAt, null);
});

// --- quiet hours -------------------------------------------------------------------------------

test("quiet hours wrap midnight and respect the start and end edges", () => {
  const nairobi = { startHour: 21, endHour: 7, timezoneOffsetMinutes: 180 };
  // 19:00Z is 22:00 in Nairobi
  assert.equal(isWithinQuietHours("2026-10-29T19:00:00Z", nairobi), true);
  // 00:00Z is 03:00, still the same quiet night
  assert.equal(isWithinQuietHours("2026-10-29T00:00:00Z", nairobi), true);
  // 06:30 local — quiet
  assert.equal(isWithinQuietHours("2026-10-29T03:30:00Z", nairobi), true);
  // 21:00 exactly is the first quiet minute
  assert.equal(isWithinQuietHours("2026-10-29T18:00:00Z", nairobi), true);
  // 07:00 exactly is already civil time
  assert.equal(isWithinQuietHours("2026-10-29T04:00:00Z", nairobi), false);
  // midday
  assert.equal(isWithinQuietHours("2026-10-29T09:00:00Z", nairobi), false);
  // 20:59 local
  assert.equal(isWithinQuietHours("2026-10-29T17:59:00Z", nairobi), false);
});

test("quiet hours are offset arithmetic, not the host clock", () => {
  // 02:00Z is 21:00 the previous evening in New York (UTC-5)
  assert.equal(isWithinQuietHours("2026-10-29T02:00:00Z", { startHour: 21, endHour: 7, timezoneOffsetMinutes: -300 }), true);
  // the same instant is 05:00 in Nairobi — quiet as well, but 12:00Z is not
  assert.equal(isWithinQuietHours("2026-10-29T12:00:00Z", { startHour: 21, endHour: 7, timezoneOffsetMinutes: 180 }), false);
  assert.equal(isWithinQuietHours("2026-10-29T12:00:00Z", { startHour: 21, endHour: 7, timezoneOffsetMinutes: -300 }), false);
  // a day-time window does not wrap
  const office = { startHour: 9, endHour: 17, timezoneOffsetMinutes: 180 };
  assert.equal(isWithinQuietHours("2026-10-29T09:00:00Z", office), true); // 12:00 local
  assert.equal(isWithinQuietHours("2026-10-29T17:00:00Z", office), false); // 20:00 local
  assert.equal(isWithinQuietHours(new Date("2026-10-29T09:00:00Z"), office), true); // Date accepted too
});

test("quiet hours refuse a window that says nothing and an offset that cannot exist", () => {
  assert.throws(() => isWithinQuietHours("2026-10-29T12:00:00Z", { startHour: 8, endHour: 8 }), /cannot be the same hour/);
  assert.throws(() => isWithinQuietHours("2026-10-29T12:00:00Z", { startHour: 21, endHour: 7, timezoneOffsetMinutes: 2000 }), /timezoneOffsetMinutes must be/);
  assert.throws(() => isWithinQuietHours("2026-10-29T12:00:00Z", { startHour: 24, endHour: 7 }), /startHour must be a whole hour/);
  assert.throws(() => isWithinQuietHours("nonsense", { startHour: 21, endHour: 7 }), /valid date/);
});

test("sending during quiet hours is blocked with the reason stated", () => {
  const queue = queued();
  const { id } = queue[0];
  const q = approveNotification(queue, id, { by: "Amanda", at: AT });
  const nairobi = { startHour: 21, endHour: 7, timezoneOffsetMinutes: 180 };

  assert.throws(() => sendNotification(q, id, { at: "2026-10-29T19:00:00Z", quietHours: nairobi }), /not sent: quiet hours 21:00–07:00 at UTC\+03:00, sending resumes at 07:00/);
  assert.equal(q[0].status, "approved", "a blocked send must not consume the approval");

  const blocked = sendDue(q, { at: "2026-10-29T19:00:00Z", quietHours: nairobi });
  assert.deepEqual(blocked.sent, []);
  assert.deepEqual(blocked.blocked.map((b) => b.id), [id]);
  assert.match(blocked.blocked[0].reason, /quiet hours 21:00–07:00/);
  assert.equal(blocked.queue[0].status, "approved");

  // the same message goes out at 07:00 local
  const { queue: sent, receipt } = sendNotification(q, id, { at: "2026-10-29T04:00:00Z", quietHours: nairobi });
  assert.equal(sent[0].status, "sent");
  assert.equal(receipt.approvedBy, "Amanda");
  assert.equal(quietHoursReason("2026-10-29T12:00:00Z", nairobi), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createAccount, createUser, can, assertCan, scoped, documentHeader, creditDecision, ENTITIES } from "../engine/accounts.mjs";
import { config, parseWebhook, trackingState, probe, LoconavNotConfigured, ENDPOINTS, LOCONAV } from "../engine/loconav.mjs";

const account = createAccount({ name: "Ndumbuki Enterprises", taxPin: "P051234567X", creditLimitKes: 1_000_000, terms: "net30" });

test("an account carries its terms and credit limit", () => {
  assert.equal(account.name, "Ndumbuki Enterprises");
  assert.equal(account.terms, "net30");
  assert.equal(account.status, "active");
});

test("bad account input is refused", () => {
  assert.throws(() => createAccount({ name: "x" }), /name required/);
  assert.throws(() => createAccount({ name: "Good Co", terms: "net90" }), /unknown terms/);
});

test("users get a role and an email address", () => {
  const u = createUser({ accountId: account.id, name: "Ndambuki", email: "Facts@Ndumbuki.co.ke", role: "client_admin" });
  assert.equal(u.email, "facts@ndumbuki.co.ke");
  assert.equal(u.status, "invited");
  assert.throws(() => createUser({ accountId: account.id, email: "nope", role: "client_user" }), /valid email/);
  assert.throws(() => createUser({ accountId: account.id, email: "a@b.co", role: "wizard" }), /unknown role/);
});

test("a client user cannot advance an order; operations can", () => {
  assert.equal(can("client_user", "order.advance"), false);
  assert.equal(can("ops", "order.advance"), true);
  assert.throws(() => assertCan("client_user", "order.advance"), /not permitted/);
  assert.equal(can("admin", "anything.at.all"), true);
});

test("one account cannot read another account's records", () => {
  const a = createUser({ accountId: "acc_a", name: "A", email: "a@x.co", role: "client_admin" });
  const records = [{ id: 1, accountId: "acc_a" }, { id: 2, accountId: "acc_b" }];
  assert.equal(scoped(records, a).length, 1);
  const admin = createUser({ accountId: "acc_a", name: "Root", email: "root@x.co", role: "admin" });
  assert.equal(scoped(records, admin).length, 2);
  assert.throws(() => scoped(records, null), /signed-in user/);
});

test("the seller and the platform never share a letterhead", () => {
  assert.equal(documentHeader("quotation").name, ENTITIES.seller.name);
  assert.equal(documentHeader("customs_file").name, ENTITIES.platform.name);
  assert.match(documentHeader("quotation").bank, /Cooperative Bank/);
  assert.throws(() => documentHeader("selfie"), /no entity defined/);
});

test("credit decisions respect terms and headroom", () => {
  const prepay = createAccount({ name: "Cash Buyer" });
  assert.equal(creditDecision({ account: prepay, orderValueKes: 500_000 }).requiresFunding, true);

  const ok = creditDecision({ account, orderValueKes: 400_000, outstandingKes: 300_000 });
  assert.equal(ok.approved, true);
  assert.equal(ok.headroom, 300_000);

  const over = creditDecision({ account, orderValueKes: 800_000, outstandingKes: 300_000 });
  assert.equal(over.approved, false);
  assert.match(over.reason, /exceeds credit headroom/);

  const frozen = creditDecision({ account: { ...account, status: "suspended" }, orderValueKes: 10 });
  assert.equal(frozen.approved, false);
});

// ---- LocoNav ----

test("without a token every LocoNav call refuses instead of inventing a position", async () => {
  const cfg = config({ region: "global" });
  assert.equal(cfg.configured, false);
  assert.equal(cfg.baseUrl, "https://api.a.loconav.com");
  await assert.rejects(() => probe(cfg).then(async (p) => { if (!p.configured) throw new Error("no token"); }), /no token/);
  const { vehicles } = await import("../engine/loconav.mjs");
  await assert.rejects(() => vehicles(cfg, {}), (e) => e instanceof LoconavNotConfigured);
});

test("the authentication header and hosts match the developer documentation", () => {
  assert.equal(LOCONAV.authHeader, "User-Authentication");
  assert.equal(LOCONAV.hosts.ksa, "https://sa.loconav.com");
  assert.equal(LOCONAV.docs, "https://developers.loconav.com/");
  assert.match(ENDPOINTS.location.confidence, /confirm/);
});

test("a well-formed GPS webhook is normalised, including seconds and milliseconds", () => {
  const sec = parseWebhook({ vehicleId: "KDG 123A", lat: -1.2921, lng: 36.8219, speed: 54, timestamp: 1793000000, type: "location" });
  assert.equal(sec.valid, true);
  assert.equal(sec.at, new Date(1793000000 * 1000).toISOString());
  const ms = parseWebhook({ vehicle: { id: "KDG 123A" }, location: { lat: -1.29, lng: 36.82 }, eventTime: 1793000000000 });
  assert.equal(ms.valid, true);
});

test("a webhook with no coordinates is not treated as a position at zero", () => {
  const bad = parseWebhook({ vehicleId: "KDG 123A", type: "alert" });
  assert.equal(bad.valid, false);
  const state = trackingState({ lastFix: bad });
  assert.equal(state.status, "no position");
});

test("a fix older than fifteen minutes is stale, not live", () => {
  const fix = parseWebhook({ vehicleId: "V1", lat: -1.29, lng: 36.82, timestamp: 1793000000 });
  const fresh = trackingState({ lastFix: fix, now: new Date(1793000000 * 1000 + 60_000) });
  assert.equal(fresh.status, "live");
  const old = trackingState({ lastFix: fix, now: new Date(1793000000 * 1000 + 40 * 60_000) });
  assert.equal(old.status, "position stale");
  assert.match(old.detail, /do not present this as live/);
});

test("an out-of-range coordinate is rejected", () => {
  const bad = parseWebhook({ lat: 91, lng: 200 });
  assert.equal(bad.valid, false);
});

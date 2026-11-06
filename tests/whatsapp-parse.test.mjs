import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseReply, brokerFee, brokerFeeWithinCap, GROUP_TEMPLATES } from "../src/lib/onboarding.mjs";

describe("parseReply", () => {
  it("parses truck post", () => {
    const r = parseReply(`🚛 TRUCK AVAILABLE\nName: Peter N\nPhone: 0722000001\nTruck: 28T flatbed\nPlate: KDA 123B\nEmpty at: Nairobi, Nov 7\nWants: Mombasa\nRate ask: 90000 KES`);
    assert.equal(r.type, "transporters");
    assert.equal(r.ok, true);
    assert.ok(r.fields.contact.includes("Peter"));
    assert.ok(r.fields.capacity.includes("28T"));
  });
  it("parses client goods request", () => {
    const r = parseReply(`📦 MOVE MY GOODS\nName: Achieng\nPhone: 0733000002\nFrom: Kisumu, Kenya\nTo: Kampala, Uganda\nGoods: maize flour, 200 cartons\nWeight/Qty: 8T\nDate needed: Nov 10\nNeed clearing? YES — Border: Malaba\nNeed tax filing? NO`);
    assert.equal(r.type, "clients");
    assert.equal(r.ok, true);
    assert.equal(r.fields.origin, "Kisumu, Kenya");
    assert.equal(r.fields.clearingFlag, "YES");
  });
  it("parses clearing post", () => {
    const r = parseReply(`🛃 CLEARING JOB / AGENT\nAgent: Juma + LIC123\nPhone: 0711000003\nBorder: Malaba\nJob: clear 1x40ft ex Mombasa, docs ready\nDocs: IDF READY\nETA border: Nov 8`);
    assert.equal(r.type, "clearing");
    assert.equal(r.ok, true);
    assert.equal(r.fields.border, "Malaba");
  });
  it("refuses unknown template as data", () => {
    const r = parseReply(`Hello how are you`);
    assert.equal(r.ok, false);
    assert.equal(r.refusals[0].code, "unknown_template");
  });
  it("lists missing fields", () => {
    const r = parseReply(`📦 MOVE MY GOODS\nName: Achieng\nPhone: \nFrom: Kisumu\nTo: Kampala\nGoods: flour\nWeight/Qty: 8T\nDate needed: Nov 10\nNeed clearing? YES\nNeed tax filing? NO`);
    assert.equal(r.ok, false);
    assert.ok(r.missing.length > 0);
    assert.equal(r.refusals[0].code, "missing_fields");
  });
  it("keeps 5% broker cap intact", () => {
    assert.equal(brokerFee(480000), 24000);
    assert.equal(brokerFeeWithinCap(480000, 24000), true);
    assert.equal(GROUP_TEMPLATES.clients.parseTo.length, 7);
  });
});

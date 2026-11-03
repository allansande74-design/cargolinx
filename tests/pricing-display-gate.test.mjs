/**
 * Role gate on the pricing policy display.
 *
 * The 30% target / 15% floor / 5% concession figures are the desk's own buying policy.
 * They must be readable by an Altovex operator and by nobody else: a client who sees the
 * floor knows exactly how far to push, and a judge who sees it learns the margin, not the product.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { can, ROLES } from "../engine/accounts.mjs";
import { POLICY } from "../engine/pricing-policy.mjs";

const PERM = "pricing.policy.view";

test("the operator role may read the pricing policy", () => {
  assert.equal(can("ops", PERM), true);
  assert.ok(ROLES.ops.can.includes(PERM));
});

test("the platform administrator may read the pricing policy", () => {
  assert.equal(can("admin", PERM), true); // via "*"
});

test("no client role may read the pricing policy", () => {
  for (const role of ["client_admin", "client_user", "driver"]) {
    assert.equal(can(role, PERM), false, `${role} must not see the floor`);
  }
});

test("every desk-side sign-in role may read the policy, so the operator is not blinded by the gate", () => {
  // the demo sign-in screen offers owner / ops / finance; all three are Altovex staff
  for (const role of ["owner", "ops", "finance", "admin"]) {
    assert.equal(can(role, PERM), true, `${role} is a desk role and must see the floor`);
  }
  // and each one must resolve to a real label, or the account screens throw on lookup
  for (const role of ["owner", "ops", "finance"]) {
    assert.ok(ROLES[role]?.label, `${role} must exist in ROLES`);
  }
});

test("an unknown or missing role is denied, not defaulted to allowed", () => {
  assert.equal(can(undefined, PERM), false);
  assert.equal(can("nobody", PERM), false);
});

test("the quote screen shows floor and concession only behind the gate", () => {
  const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const gate = src.indexOf(`can(user?.role, "${PERM}")`);
  assert.ok(gate > 0, "the gate must be present in the quote screen");

  for (const label of ["<span>Floor price", "concession</span>"]) {
    const at = src.indexOf(label);
    assert.ok(at > gate, `${label} must sit after the gate, not before it`);
    assert.equal(src.split(label).length - 1, 1, `${label} must appear exactly once`);
  }
  // and the gated block must actually close before the itemised cost table
  const after = src.slice(gate);
  assert.ok(after.indexOf("</>") < after.indexOf("Itemised landed cost"), "the gate must wrap both figures and close");
});

test("the margin control and its policy wording are operator-only too", () => {
  const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const gate = src.indexOf(`can(user?.role, "${PERM}") ? (`);
  assert.ok(gate > 0, "the margin control must be behind the same gate");
  const block = src.slice(gate, src.indexOf("</>", gate) === -1 ? undefined : src.length);
  assert.ok(block.indexOf("policy band 30–40%") > 0, "the band wording sits inside the gated branch");
  const before = src.slice(0, gate);
  assert.ok(!before.includes("policy band 30–40%"), "no band wording may render before the gate");
});

test("the figures rendered by the gate are the policy's, not literals", () => {
  const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.ok(!src.includes("Floor price (10%)"), "a hard-coded floor label must not survive");
  assert.ok(!src.includes("Floor price (15%)"), "a hard-coded floor label must not survive");
  // The screen must read the policy object, so a change to the floor cannot leave the display behind.
  assert.ok(src.includes("POLICY.minMargin * 100"), "the floor label is computed from POLICY");
  assert.equal(POLICY.minMargin, 0.15);
  assert.equal(POLICY.targetMargin, 0.3);
  assert.equal(POLICY.negotiationRoom, 0.05);
});

// ------------------------------------------- the policy stays out of public surfaces too

/**
 * The gate above stops a client seeing the floor in the UI. These cases stop the same figures
 * leaking into the artefacts the public actually reads: the repo README, the docs a judge opens,
 * the marketing page, and the terminal output a screen-share might show.
 */
const PUBLIC_SURFACES = ["README.md", "docs/HACKATHON.md", "docs/QUOTE-REPRO.md", "src/Landing.jsx"];

const BANNED_IN_PUBLIC = [
  [/policy band/i, "the policy band"],
  [/\b(?:15|30|40)\s*%\s*margin/i, "a margin percentage"],
  [/\b10\s*%\s*(?:hard\s*)?floor/i, "the floor percentage"],
  [/\btarget margin\b/i, "the target margin"],
  [/2,357,810\.29/, "the floor price for the reference run"],
  [/with the margin visible/i, "a promise that margin is shown to the buyer"],
];

for (const surface of PUBLIC_SURFACES) {
  test(`${surface} publishes none of the desk's policy figures`, () => {
    const src = readFileSync(new URL(`../${surface}`, import.meta.url), "utf8");
    for (const [re, what] of BANNED_IN_PUBLIC) {
      assert.ok(!re.test(src), `${surface} publishes ${what} (${re})`);
    }
  });
}

test("the quote CLI is silent about policy unless the operator asks for it", () => {
  const args = ["cli/quote.mjs", "--goods", "1200000", "--freight", "250000", "--duty", "0.25", "--margin", "0.30"];
  const root = new URL("..", import.meta.url).pathname;
  const quiet = execFileSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  assert.ok(!/policy band/i.test(quiet), "default output must not name the policy band");
  assert.ok(!/floor\s*\d+%/i.test(quiet), "default output must not print the floor percentage");
  assert.ok(!/concession\s*\d+%/i.test(quiet), "default output must not print the concession percentage");
  assert.ok(/QUOTE at 30\.0% margin/.test(quiet), "the quote itself must still print");

  const loud = execFileSync(process.execPath, [...args, "--show-policy"], { cwd: root, encoding: "utf8" });
  assert.ok(/floor\s*15%/i.test(loud), "--show-policy is how an operator reads the floor");
});

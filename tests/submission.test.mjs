import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Submission-readiness facts. Every assertion below reads the repository on disk;
// none of them trusts a sentence in the README on its own.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const at = (...p) => join(ROOT, ...p);
const read = (...p) => readFileSync(at(...p), "utf8");

const README = read("README.md");

// ---------------------------------------------------------------- README reader

// A filename the README can be read as claiming exists.
const CLAIMED_FILE =
  /\b(?:engine\/[\w./-]*\.mjs|src\/lib\/[\w./-]*\.mjs|src\/App\.jsx|tests\/[\w./-]*\.test\.mjs)\b/g;

// Sentences that explicitly disclaim the file they name must not be counted as claims.
const DISCLAIMER = /\bnot yet\b|\bpending\b/i;

const sentences = (markdown) =>
  markdown
    .split("\n")
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);

// Returns the sorted, de-duplicated list of files the README claims exist.
export const filesClaimed = (markdown) => {
  const found = new Set();
  for (const sentence of sentences(markdown)) {
    if (DISCLAIMER.test(sentence)) continue;
    for (const match of sentence.match(CLAIMED_FILE) ?? []) found.add(match);
  }
  return [...found].sort();
};

// ------------------------------------------------------------- gitignore reader

// Anchored per line: "dev-dist/" must not be read as excluding "dist".
const excludes = (gitignore, name) =>
  gitignore
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .some((l) => new RegExp(`^/?${name}/?$`).test(l));

// ------------------------------------------------------------------- (1) files

test("every file the README claims exists is on disk", () => {
  const claimed = filesClaimed(README);
  assert.ok(claimed.length >= 3, `README reader found only ${claimed.length} filename(s)`);
  const missing = claimed.filter((f) => !existsSync(at(...normalize(f).split(sep))));
  assert.deepEqual(missing, [], `README claims these files exist but they do not: ${missing.join(", ")}`);
});

test("the README reader ignores files named only as not yet written or pending", () => {
  assert.deepEqual(filesClaimed("`engine/ghost.mjs` is not yet written."), []);
  assert.deepEqual(filesClaimed("`src/lib/ghost.mjs` is pending."), []);
  assert.deepEqual(filesClaimed("`tests/ghost.test.mjs` will land once the licence is pending signature."), []);
  assert.deepEqual(filesClaimed("`engine/landed.mjs` computes the landed cost."), ["engine/landed.mjs"]);
});

test("the files the feature sections name by hand are the ones the reader returns", () => {
  const claimed = filesClaimed(README);
  for (const file of ["engine/plugins.mjs", "engine/sourcing.mjs", "engine/rates/ke-2026.mjs", "src/App.jsx"]) {
    assert.ok(claimed.includes(file), `README names ${file} but the reader did not find it`);
    assert.ok(existsSync(at(...file.split("/"))), `${file} is named in the README and is not on disk`);
  }
});

// ------------------------------------------------------- (2) no submission claims

test("the README claims no public repository and no deployed submission URL", () => {
  // The licence is now a fact of the repository, so it is no longer a forbidden claim; a repository
  // address and a hosting address remain claims, and stay forbidden until they actually exist.
  const forbidden = ["github.com/", "vercel.app", "workers.dev"];
  const lines = README.split("\n");
  const hits = [];
  for (const [i, line] of lines.entries()) {
    const lower = line.toLowerCase();
    for (const token of forbidden) {
      if (lower.includes(token)) hits.push(`line ${i + 1}: "${token}" in ${line.trim()}`);
    }
  }
  assert.deepEqual(hits, [], `README makes a claim that is not true of this repository:\n${hits.join("\n")}`);
});

test("the README links no absolute URL except localhost", () => {
  const urls = README.match(/https?:\/\/[^\s`)]+/g) ?? [];
  const external = urls.filter((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u));
  assert.deepEqual(external, [], `README points at external URLs: ${external.join(", ")}`);
});

// ------------------------------------------------------------- (3) npm scripts

const pkg = JSON.parse(read("package.json"));

test("package.json has a test script that runs node --test", () => {
  assert.equal(typeof pkg.scripts?.test, "string", "no test script");
  assert.match(pkg.scripts.test, /\bnode\s+--test\b/);
});

test("package.json has a build script that runs vite build", () => {
  assert.equal(typeof pkg.scripts?.build, "string", "no build script");
  assert.match(pkg.scripts.build, /\bvite\s+build\b/);
});

// ---------------------------------------------------------------- (4) gitignore

test(".gitignore excludes node_modules and dist", () => {
  const gitignore = read(".gitignore");
  assert.ok(excludes(gitignore, "node_modules"), ".gitignore does not exclude node_modules");
  assert.ok(excludes(gitignore, "dist"), ".gitignore does not exclude dist");
});

test("the gitignore check is anchored, so dev-dist is not read as dist", () => {
  assert.equal(excludes("dev-dist/\n", "dist"), false);
  assert.equal(excludes("node_modules/\ndist/\n", "dist"), true);
  assert.equal(excludes("# dist/\n", "dist"), false);
});

// ------------------------------------------------------------------- (5) licence

test("a licence file is present and grants rights explicitly", () => {
  const present = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING"].filter((f) => existsSync(at(f)));
  assert.ok(present.length >= 1, "no licence file: the repository grants nothing, which fails the rules");
  const body = readFileSync(at(present[0]), "utf8");
  assert.ok(/apache license|mit license/i.test(body), `${present[0]} is not a recognised open licence`);
});

test("the README names the licence instead of leaving it open", () => {
  assert.ok(/licen[cs]e/i.test(README), "README does not mention the licence at all");
  assert.ok(!README.includes("No licence is granted yet"), "README still says no licence is granted yet");
});

// -------------------------------------------------------------------- (6) engine

test("engine holds at least eight ESM modules", () => {
  const modules = readdirSync(at("engine"), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".mjs"));
  assert.ok(modules.length >= 8, `engine holds ${modules.length} .mjs modules, fewer than 8`);
});

test("the readiness checklist exists, and still names what is missing", () => {
  const heading = "## Submission readiness checklist (added 29 October 2026)";
  assert.ok(README.includes(heading), "the readiness checklist heading is missing");
  const section = README.slice(README.indexOf(heading));
  const done = section.match(/^- \[x\]/gim) ?? [];
  const open = section.match(/^- \[ \]/gim) ?? [];
  assert.ok(done.length >= 3, `the checklist has ${done.length} verified item(s)`);
  assert.ok(open.length >= 3, `the checklist has ${open.length} open item(s)`);
  for (const gap of ["repository", "deployed", "Meta model key"]) {
    assert.match(section, new RegExp(gap, "i"), `the checklist does not name the missing ${gap}`);
  }
});

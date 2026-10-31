/** DeepSeek-harness plugin gateway: every new stack/plugin/tool/skill/IoT/bot arrives here; core code untouched. */
import { PLUGIN_MANIFESTS } from "./plugins.mjs";

export const CATEGORIES = ["tech-stack", "plugin", "tool", "skill", "iot", "bot"];

const registry = new Map();

function valid(m) {
  return (
    m && typeof m === "object" &&
    typeof m.id === "string" && m.id.length > 0 &&
    typeof m.name === "string" && m.name.length > 0 &&
    CATEGORIES.includes(m.category) &&
    typeof m.version === "string" && m.version.length > 0 &&
    Array.isArray(m.capabilities) && m.capabilities.length > 0 &&
    m.capabilities.every((c) => typeof c === "string" && c.length > 0) &&
    typeof m.entry === "string" && m.entry.length > 0
  );
}

export function register(manifest) {
  if (!valid(manifest)) throw new Error("invalid harness manifest: require {id, name, category, version, capabilities[], entry}");
  const rec = { ...manifest };
  registry.set(rec.id, rec);
  return { ...rec };
}

export function unregister(id) {
  return registry.delete(id);
}

export function listHarness() {
  const builtins = Object.values(PLUGIN_MANIFESTS).map((m) => ({
    id: m.id, name: m.name, category: "plugin",
    version: "builtin", capabilities: [...m.capabilities], entry: "engine/plugins.mjs",
  }));
  return [...builtins, ...[...registry.values()].map((r) => ({ ...r }))];
}

export function harnessStatus(id) {
  if (registry.has(id) || PLUGIN_MANIFESTS[id]) return { id, state: "registered", detail: "known to harness" };
  return { id, state: "unknown", detail: "not registered" };
}

export function describeHarness() {
  return { categories: [...CATEGORIES], count: listHarness().length, core_untouched: true };
}

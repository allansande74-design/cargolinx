// doc-seal.mjs — per-page twin sealed verification markers + ERP webhook hook.
// Companion to doc-auth.mjs (which stamps whole documents). This module seals
// individual pages: each page carries a full date+time stamp plus TWO sealed
// verification markers (sealA / sealB) derived from distinct system markers
// ('ALTOVEX-A', 'ALTOVEX-B') known only to the system. Markers are revealed
// only on board-approved authentication; this file implements the algorithm
// only — no key material is stored here.
// Pure ESM, zero imports, no network, never throws on verify.

function fnv1aHex(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function normalisePage({ docRef, pageNo, issuedAt }) {
  if (typeof docRef !== "string" || docRef.length === 0) return { error: "docRef required" };
  if (!Number.isInteger(pageNo) || pageNo < 1) return { error: "pageNo must be a positive integer" };
  const d = issuedAt instanceof Date ? issuedAt : new Date(issuedAt);
  if (Number.isNaN(d.getTime())) return { error: "issuedAt must be a valid date+time" };
  return { docRef, pageNo, at: d.toISOString() };
}

export function sealPage({ docRef, pageNo, issuedAt }) {
  const n = normalisePage({ docRef, pageNo, issuedAt });
  if (n.error) throw new Error(n.error);
  const base = `${n.docRef}|${n.pageNo}|${n.at}`;
  return {
    sealA: fnv1aHex(`${base}|ALTOVEX-A`),
    sealB: fnv1aHex(`${base}|ALTOVEX-B`),
  };
}

export function verifyPageSeal({ docRef, pageNo, issuedAt, sealA, sealB } = {}) {
  try {
    const n = normalisePage({ docRef, pageNo, issuedAt });
    if (n.error) return { ok: false, error: n.error };
    if (typeof sealA !== "string" || typeof sealB !== "string") {
      return { ok: false, error: "sealA and sealB required" };
    }
    const base = `${n.docRef}|${n.pageNo}|${n.at}`;
    const ok = sealA === fnv1aHex(`${base}|ALTOVEX-A`) && sealB === fnv1aHex(`${base}|ALTOVEX-B`);
    return ok ? { ok: true, error: null } : { ok: false, error: "seal mismatch" };
  } catch {
    return { ok: false, error: "verification failed" };
  }
}

export function erpHook({ event, docRef } = {}) {
  if (typeof event !== "string" || event.length === 0) throw new Error("event required");
  if (typeof docRef !== "string" || docRef.length === 0) throw new Error("docRef required");
  return { event, docRef, at: new Date().toISOString(), source: "cargolinx" };
}

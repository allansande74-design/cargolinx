# Demo wiring checklist — Admin + Contacts + quote-qr + doc-auth + doc-seal

Status truth: Admin and Contacts exist but are UNWIRED (no import in `src/App.jsx`).
quote-qr / doc-auth / doc-seal exist as pure lib modules, tested, but NOT imported
by `src/App.jsx` (only `quoteHtml` from `src/lib/quote-doc.mjs` is used, line 7).
Each item below is one import + one route/tab line in `src/App.jsx`. No other file changes.

Routing model (existing, `src/App.jsx` lines 236–340):
- Top level `routeFromHash()`: `#` → `Landing` (`src/Landing.jsx`),
  `#/signin` → `Auth` (`src/Auth.jsx`), `#/desk/...` → `Desk`.
- Desk tabs `tabFromHash()`: `#/desk/<tab>`, `<tab>` must be in `TAB_KEYS`
  (derived from `NAV`, line 293). Add a NAV entry and the tab works.

## 1. Admin — `src/Admin.jsx` (default export `Admin`)
- Import in `src/App.jsx` (with the other view imports, ~line 23–25):
  `import Admin from "./Admin.jsx";`
- Route/tab in `src/App.jsx`: add `["admin", "Modules", "gear"]` to the
  `NAV` Workspace group (line 249–256); add
  `admin: { title: "Modules", sub: "..." }` to `PAGE` (line 259–274);
  add `{tab === "admin" && <Admin />}` beside the other tab renders (line 209–222).
- Shows: ERP modules overview (Finance, Warehouse, Fleet, SMM/SEO, Ads — all PLANNED).
- Judge clicks: Desk nav → Modules → `#/desk/admin`.

## 2. Contacts — `src/Contacts.jsx` (default export `Contacts`)
- Import in `src/App.jsx`: `import Contacts from "./Contacts.jsx";`
- Route/tab in `src/App.jsx`: add `["contact", "Contact", "chat"]` to `NAV`
  Workspace group; add `contact: { title: "Contact", ... }` to `PAGE`;
  add `{tab === "contact" && <Contacts />}` to the tab renders.
- Shows: DreamTeam phone/email/site, Altovex postal/email/paybill, WhatsApp PENDING.
- Judge clicks: Desk nav → Contact → `#/desk/contact`.

## 3. quote-qr — `src/lib/quote-qr.mjs` (`buildQuotePayload`, `verifyQuotePayload`)
- Import in `src/App.jsx` (`QuoteView` Documents section, ~line 847–857):
  `import { buildQuotePayload, verifyQuotePayload } from "./lib/quote-qr.mjs";`
- Also import in `src/lib/quote-doc.mjs` (`quoteHtml`) to embed the payload
  string as the printed QR on the quotation.
- Shows: `QuoteView` → Documents → "Open printable quote" (`printQuote`, line 862)
  opens `quoteHtml({ shipment, lc, q })` with a QR encoding
  `{v, ref, total, cur, at}` built from the engine's `q.priceIncVat`.
- Judge clicks: `#/desk/quote` → "Open printable quote" → scan QR →
  `verifyQuotePayload` returns `ok:true` with matching ref/total.
- Proof: `tests/doc-chain.test.mjs` "quote payload verifies ok:true".

## 4. doc-auth — `src/lib/doc-auth.mjs` (`stampDocument`, `verifyStampedDocument`, `SUPPORTED_TYPES`)
- Import in `src/App.jsx` (`QuoteView` Documents section):
  `import { stampDocument, verifyStampedDocument } from "./lib/doc-auth.mjs";`
- Shows: each printed doc (quote, delivery-note, invoice, receipt, packing-list,
  customs-declaration, certificate) stamped via
  `stampDocument({ docType, docRef, issuer, figures })` — figures RESTATED from
  the engine, timestamp + canonical `qr` string attached; footer shows
  docType/ref/issuedAt for the judge to re-verify with `verifyStampedDocument`.
- Judge clicks: printed quote footer → copy `qr` → verify → `ok:true`;
  tampered payload → `ok:false` with named error.
- Proof: `tests/doc-chain.test.mjs` "customs-declaration envelope verifies ok:true",
  "junk envelope verifies ok:false".

## 5. doc-seal — `src/lib/doc-seal.mjs` (`sealPage`, `verifyPageSeal`, `erpHook`)
- Import in `src/App.jsx` (Documents section or print path):
  `import { sealPage, verifyPageSeal, erpHook } from "./lib/doc-seal.mjs";`
- Shows: each printed page carries date+time stamp + twin markers
  (`sealA`/`sealB` from `sealPage({ docRef, pageNo, issuedAt })`);
  `verifyPageSeal` confirms; `erpHook({ event: "doc.sealed", docRef })`
  emits the ERP webhook payload.
- Judge clicks: page 1 footer → compare sealA/sealB → verify `ok:true`;
  altered seal → `ok:false, "seal mismatch"`.
- Proof: `tests/doc-chain.test.mjs` "page seals 1-2 verify ok:true",
  "tampered seal verifies ok:false", "erpHook payload has event/docRef/at/source shape".

## Judge click path (6 clicks, end to end)
1. `#` Landing → Enter → `#/desk/new` (`Landing.jsx` → `NewShipment`).
2. Enter consignment → creates shipment → `#/desk/quote` (`QuoteView` ladder).
3. `#/desk/quote` → "Open printable quote" → printed `quoteHtml` + QR + seals.
4. `#/desk/track` → ETA + offline queue badge (`TrackView`).
5. Desk nav → Modules (`#/desk/admin`, `Admin`) — everything PLANNED, labelled.
6. Desk nav → Contact (`#/desk/contact`, `Contacts`) — verified contacts only.

## Demo-script mapping (`src/demo-script.md`, 6 scenes / 165s)
- Scenes 1–5 already wired (Landing, NewShipment, QuoteView, TrackView, `src/lib/meta.js`).
- Scene 6 (145–165s, printed quotation) is where items 3–5 land:
  QR (`quote-qr`) + envelope (`doc-auth`) + page seals (`doc-seal`).
- Items 1–2 (`Admin`, `Contacts`) are post-quote credibility screens, not in the
  165s script — show only if the judge asks "who/where".

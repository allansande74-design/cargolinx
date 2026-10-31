# CargoLinx v2 — Legal Audit (read-only findings, 31 Oct 2026)

> Every legal conclusion below is marked **NEEDS-COUNSEL**. This file records facts found in the tree plus open items. It is not legal advice.

## 1. Third-party dependencies (direct, from `package.json`)

| Package | Version (installed) | Licence (own package.json / lock) | Attribution needed | Status |
|---|---|---|---|---|
| react | 18.3.1 | MIT | Keep MIT notice in distributions | No NOTICE file yet — see §4 |
| react-dom | 18.3.1 | MIT | Keep MIT notice in distributions | No NOTICE file yet — see §4 |
| vite | 5.4.21 (dev) | MIT | Keep MIT notice if shipped | Build tool; not in runtime bundle — NEEDS-COUNSEL |
| @vitejs/plugin-react | 4.7.0 (dev) | MIT | As above | As above |
| vite-plugin-pwa | 0.21.2 (dev) | MIT | As above; pulls Workbox (Apache-2.0) transitively at build time | Transitive licences not enumerated — see §4 |

Notes: `package-lock.json` (lockfile v3) lists 394 packages total — transitive licences were NOT individually verified. `package.json` has `"private": true`, so the package is not published to npm; distribution happens via `dist/` builds and the repo itself.

## 2. LICENSE vs README match check

- `LICENSE`: MIT, `Copyright (c) 2026 Allan Sande, Altovex Global Logistics`. Standard MIT text. **PASS** on content.
- `README.md` §Licence: "MIT License — see `LICENSE` (© 2026 Allan Sande, Altovex Global Logistics)". **PASS** — licence named, file referenced, terms summarised accurately.
- OPEN-1 CLOSED 31 Oct 2026: holder naming now identical in LICENSE + README (Mr Allan decided: individual + company). No counsel needed on holder.

## 3. Vendored / copied-code scan (names only, no findings of wrongdoing)

- Grep for `vendored|copied from|adapted from|borrowed from|SPDX|licensed under` across `src/`, `engine/`, `server/`: **zero hits**. No copied-code markers found.
- `engine/loconav.mjs`: adapter written against LocoNav's developer docs (header names, epoch params); no LocoNav SDK code in tree.
- `engine/plugins.mjs` + `engine/sourcing.mjs`: Alibaba / AliExpress / Accio integrations are dry-run contract plugins; no third-party SDK or catalogue data in tree.
- Meta model layer (`muse-spark-1.3`, `muse-wonder-1.0` via api.meta.ai): API calls only; hackathon entry terms govern use — NEEDS-COUNSEL.
- Static assets: `public/icon-192.png`, `public/icon-512.png`, `public/favicon.svg` — generator/origin undocumented (OPEN-3). No vendored fonts found.

## 4. Attribution gaps needing a notice

- **OPEN-2 (main gap): no third-party notice file.** MIT-licensed runtime deps (react, react-dom) require the copyright + permission notice to accompany distributions (`dist/` served to judges/users counts — NEEDS-COUNSEL). Proposed: add `THIRD-PARTY-NOTICES.md` at repo root listing direct + generated transitive licences (`npx license-checker --summary` output), for Mr Allan's approval before adding.
- OPEN-4: transitive dependency licences (394 lock entries, incl. Workbox via vite-plugin-pwa) never enumerated.
- OPEN-3: icon/favicon provenance undocumented — confirm original work or add source + licence.
- OPEN-1: holder naming variance LICENSE vs README.

## 5. Registration checklist — KIPI (Kenya) + international (all PENDING)

| # | Item | Status | Depends on |
|---|---|---|---|
| R-1 | KIPI trademark search + filing for "CargoLinx" (and Altovex CargoLinx device, if any) | PENDING | Mr Allan decision + counsel |
| R-2 | Copyright: Kenya protects automatically on creation, no registration needed, but deposit/recordal strategy | PENDING | Counsel to confirm — NEEDS-COUNSEL |
| R-3 | Company vs individual ownership record (Altovex Global Logistics Co. Ltd vs Allan Sande) for code, name, docs | PENDING | Mr Allan decision + counsel |
| R-4 | International trademark route (ARIPO Banjul / WIPO Madrid) if expansion beyond Kenya is planned | PENDING | Mr Allan decision + counsel |
| R-5 | Patent/utility-model screen (none expected for this software; recorded for completeness) | PENDING | Counsel — NEEDS-COUNSEL |
| R-6 | Hackathon IP terms (Meta Global AI Developer Hackathon): confirm entry retains Mr Allan's ownership and MIT grant is compatible | PENDING | Counsel review of competition rules — NEEDS-COUNSEL |
| R-7 | Third-party API terms on file (LocoNav, Alibaba, AliExpress, Meta api.meta.ai) before production keys | PENDING | Mr Allan + counsel |

## 6. Where notices must go (once approved)

1. `LICENSE` — already present (MIT). Keep; fix holder naming per OPEN-1.
2. `README.md` §Licence — already present. Keep in sync with any LICENSE change.
3. NEW `THIRD-PARTY-NOTICES.md` at root (proposed, awaiting approval) — direct + transitive licences.
4. App shell (About/footer in `src/`) — short "© 2026 [holder] · MIT · third-party notices" line linking the above.
5. `dist/` builds — ensure the notice files ship with or are linked from deployed output.
6. Printed quotation/POD documents — already carry entity headers (Altovex Global Logistics Co. Ltd vs Altovex CargoLinx); counsel to confirm footer IP line — NEEDS-COUNSEL.

## Open items count: 4 findings + 7 registrations = 11

Findings: OPEN-1 (holder naming), OPEN-2 (no notice file), OPEN-3 (icon provenance), OPEN-4 (transitive licences). Registrations: R-1…R-7, all PENDING, all need Mr Allan's decision and counsel; nothing has been filed or searched.

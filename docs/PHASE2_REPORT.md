# Phase Two report — offline-first attendance and marks

## Built
| Area | What exists |
|---|---|
| On-device storage | `js/offline/kvStore.js` — IndexedDB (memory fallback for tests); outbox, drafts, saved class copies |
| Outbox + sync engine | `outbox.js`, `syncEngine.js` — idempotent opIds, per-record folding, single-flight sync, crash recovery, back-off, conflicts, never-silent failures |
| Demo-mode transport | `localTransport.js` — duplicate-proof, version conflicts, role/class-scope checks, validation, locked-result hook |
| Screens | **Mobile register** (Attendance tab) and **Mobile marks** (Exams & Assessments tab), 44px touch targets, sync panel with Keep mine / Use server's / Retry / Discard |
| Offline app | `sw.js` + `manifest.webmanifest` + `precache.json` (versioned from file contents); installable on Android |
| Teacher scope | the new screens show only assigned classes, regardless of package |

## Tests actually run
* `node tests/run-all.mjs` — 7 files pass: auth, bursar, capacity, **offline (19)**, **pwa (6)**, sql-security, teacher.
* Mutation check: deliberately breaking the base-version and conflict rules made 3 offline tests fail, so they are not vacuous.
* Real Chromium (Playwright) at 390px: service worker active with 174 files cached; offline marking queued 2 changes with **0** records claimed synced; app reopened offline after a reload with the queue intact; reconnect synced to `version 1`; a simulated second device produced a conflict (server record untouched); Keep mine produced version 3; marks draft restored after reload; mark of 60/50 blocked; offline submit queued and synced correctly.
* The browser test found and I fixed: (1) teacher saw all classes, (2) Keep mine did not trigger a sync, (3) a race that stored one learner's mark as blank, (4) the marks tab was mounted in the wrong page.

## Not done / not proven
* **Cloud sync is not built** (backend is last, as agreed). The screens are hidden in cloud mode. Contract: `docs/OFFLINE_SYNC_CONTRACT.md`.
* Only Chromium was tested. **iPhone Safari, Firefox and real Android phones were not.** Browsers may still evict offline data if storage is cleared ("clear site data" deletes the unsynced queue).
* The "second device" was simulated by editing the stored record, not two real browsers.
* Attendance is per class per day (the existing model); lesson/period-level attendance and school-configurable status lists are not built.
* The existing *Mark attendance* and marks screens still write directly, not through the outbox. Prefer the mobile screens on phones.
* The "locked/published results" rule is implemented and unit-tested, but demo mode has no published-results concept to trigger it in the browser.
* Audit history: synced changes are written through the normal audited repositories (who/when/what); a dedicated before/after history screen is not built.

## Continue from here
Next in your brief is Phase Three (finish the Bursar Pack: installment plans, credit notes, cashbook, scholarships, statements). Backend phases (cloud transport, live M-Pesa, migrations on staging) remain last.

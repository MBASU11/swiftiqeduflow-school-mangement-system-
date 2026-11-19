# Phase Five report — academic engine and report cards (PARTIAL)

**Phase Five is not finished.** The calculation engine, its tests and the first settings screen are done. The approval
workflow screens, competency/coverage screens and the report-card publication/PDF work are not.

## Built and tested
| Item | Where |
|---|---|
| **Academic engine** (pure functions) | `js/services/academicEngine.js` — report policy, decimal-correct rounding, grade-band validation and matching, weighted assessments (exam + any assessment types, weights must total 100), configurable ranking (none / class / stream; tie handling; minimum subjects), class statistics (mean, median, highest, lowest, std. dev., pass rate, grade distribution), learner trend, competency/learning-outcome ratings and profiles, curriculum coverage, and the approval-workflow rules (who may submit/return/approve/publish/unpublish/reopen, reasons required, approver ≠ submitter, submit blockers, locked-run rule) |
| **Report builder now uses the engine** | `buildClassResults` in `reportCardService.js` (same output shape, so existing report-card screens work). Respects the policy's "show position" / "show class average". |
| **Report settings screen** (administrator) | Exams & Assessments → **Report settings**: report policy, a plain-language **grade-scale checker** (gaps, overlaps, missing grades), and **weighted-assessment schemes** (per subject / class / term, live total, validation) |

## Tests actually run
* `node tests/run-all.mjs` — **12 files pass**. New: `engine.test.mjs` (hand-worked cases for rounding, bands, weighting, report totals, ranking, statistics, competencies, coverage, workflow; a 400-class randomized ranking check; a check that default settings give the same positions as the pre-engine algorithm) and `engine-integration.test.mjs` (the engine inside the real report builder).
* Mutation check: breaking tie ranking and the approver rule made 4 tests fail.
* Browser (Chromium, `tests/browser/report_card_check.py`, `report_settings_check.py`): the real Report Cards screen renders from the engine with no NaN; as administrator, the grade-scale checker flagged a missing 0–49 band, a policy change turned ranking off, invalid weights were rejected, and a 60% exam / 40% CAT scheme produced Maths 86 for a learner with exam 90 and CAT 80%.

## Corrections and bugs found
* **A correction to something I said earlier:** I told you the old rounding formula could turn 50.05 into 50.0. That was wrong. At one decimal place (the current default) the old formula gives the same answer as the new one. It only misrounds at **two or more** decimals (for example 0.145 → 0.14), which the new policy now allows. I measured this before restating it.
* **Latent bug fixed:** if a learner had no mark record at all for a subject, the old code counted it as scored and the average became **NaN**.
* **Behaviour change you should know about:** scores that fall between integer grade bands (for example 79.5 between 70–79 and 80–100) used to get **no grade**; they now take the band below. This can be turned off (Grade matching → "Strictly inside min–max"). The cloud report builder uses the same engine, so this applies there too.
* A UI exception when editing a weight (re-drawing a form while a field was losing focus) was found in testing and fixed.

## Not done
* **Draft → moderation → approval → publication has rules and tests but no screens, and nothing enforces it yet.** Marks are not locked when a report is submitted (the offline transport has a lock hook ready for it), and report cards can still be shared as before.
* **Competency tracking:** the rating scale, ratings, outcome summaries and learner profile are in the engine; there is no screen to define outcomes, record ratings or view them, and lesson plans cannot yet be tagged with outcomes.
* **Curriculum coverage:** calculated by the engine; no report screen yet.
* **Class performance summary and learner progress** screens: statistics exist in the engine; the only place they appear today is the report builder's result.
* **Branded PDF report cards:** the printed card works (A4, print styles, signature lines). There is no server-side PDF generation; "PDF" means the browser's Save as PDF. No signature images or approver signatures.
* **Secure parent/learner access to report cards:** unchanged (cloud share links exist; learner login is Phase Six).
* **Cloud mode:** the new settings screen is demo-only; `reportPolicy` and `weightingSchemes` need cloud tables and role rules in the backend phase. Until then cloud report builds use the default policy.

## Continue from here
1. Report-run workflow screens + enforcement (lock marks on submit, publish gate, approver signature).
2. Competency screens and lesson-plan outcome tagging; coverage and class/learner performance reports.
3. Then Phase Six (parent and learner portals).

## Phase 5 completion: report-run workflow (demo mode)
- One **run** per examination + class: Draft → In moderation → Approved → Published. Rules are in `academicEngine.js` (`canDo`, `submitBlockers`, `applyAction`, `shareGate`); storage and wiring in `reportRunService.js`; screen in `features/exams/reportRunPanel.js`, shown above the report cards.
- **Submit** is blocked until marks, subject comments (and optionally the class comment) are complete and the grading scale has no errors.
- **Lock:** once submitted, exam marks, weighted assessments in that term, and the teacher's comments cannot change (screens, service and the offline sync path all refuse). Principal's comment stays editable until publish. Return/reopen needs a reason and clears approvals.
- **Approver signature:** the approver's name, title and date print on the principal's box. (A drawn/uploaded signature image is not built.)
- **Share gate:** parent links, SMS, email and WhatsApp are available only when the run is published. Printing stays open but prints a "Draft – not yet approved" banner until then. Policy switch `enforceWorkflow` (Report settings) turns the gate off.
- A single-administrator school cannot approve its own submission while "Approver must differ" is on; switch it off in Report settings.
- Cloud mode: no run table yet, so nothing is locked or gated there (backend phase).
- Tests: `tests/reportrun.test.mjs` (Node) and `tests/browser/report_run_check.py`.

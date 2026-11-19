# Phase 7: principal dashboard (demo mode)

Administrators (the school owner and anyone with the Administrator role) now see a "principal's view" at the top of the dashboard. Other roles keep the dashboard they had.

## What it shows
- **Needs your attention** (tap an item to open the page): class reports waiting for approval or publishing, admission applications awaiting a decision, approved applicants not yet admitted, classes under 85% attendance over 30 days, learners with unpaid fees, low inventory. Red items are waiting on the principal; amber items are worth a look.
- **Headline numbers:** learners, today's attendance, fees collected in 30 days and the collection rate, fees outstanding.
- **Report cards** for the newest examination: each class's status (Draft → Published).
- **Attendance by class** (30 days, lowest first) and **performance by class** (mean and pass rate, lowest first), using the same engine and report policy as the report cards.
- **Largest fee balances.**

## How it is built
Nothing new is stored. `principalLogic.js` holds the rules (pure functions), `principalService.js` gathers facts from the services every module already uses, `features/dashboard/principalDashboard.js` draws it. The 85% attendance line is a constant in `principalLogic.js` (`LOW_ATTENDANCE`).

## Limits
- Demo mode only; the cloud dashboard (`remoteDashboard.js`) is unchanged and the backend phase should carry the same numbers over.
- "Newest examination" is the one with the latest start date; there is no term or year filter yet.
- Pass rate follows the school's report policy pass mark.
- Tests: `tests/principal.test.mjs` and `tests/browser/principal_check.py`.

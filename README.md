# SwiftIQ EduFlow

A plain HTML, CSS, and JavaScript school-management prototype. It has no build step or package installation requirement.

## Run locally

Serve this directory over HTTP because browsers block JavaScript module imports from `file://` URLs. For example:

```powershell
npx serve .
```

You can also use VS Code Live Server or another static file server. The default app runs in browser-local prototype mode until Supabase is configured.

## Deploy the static app to Netlify

`netlify.toml` configures a no-dependency build that publishes only the browser app files to `dist/` (not tests, docs, or database migrations). For a local preview of the deploy output, run:

```powershell
node scripts/build-netlify.mjs
npx serve dist
```

Connect the repository in Netlify to build and deploy automatically. Supabase URL and the publishable key are browser-visible client settings; never add a service-role key or database password. Before using the deployed site with real school records, complete the production checklist in `docs/DEPLOYMENT.md`, including Auth URL settings and legal review for the European database region.

## Architecture

- `js/storage/StorageManager.js` owns browser `localStorage` access and scopes school records to the signed-in school.
- `js/storage/Repository.js` provides the current synchronous local repository implementation.
- `js/storage/SupabaseRepository.js` is the asynchronous tenant-scoped repository used by migrated features.
- `js/services/` contains feature services and backend adapters.
- `js/router.js` is the hash router; `js/layouts/appShell.js` builds the standard local-mode shell.
- `supabase/migrations/` contains the database schema, Row Level Security policies, and transactional operations.

## Supabase backend

The remote path uses Supabase Auth, PostgreSQL, Row Level Security, and a private Storage bucket. Configure the public project URL and anon/publishable key in `js/config/supabase.js`; never put a service-role key or database password in browser code. Follow `supabase/README.md` to apply the migration and create the platform administrator.

When configured, login/signup, platform approvals and billing, setup, and the following school areas use the shared tenant database:

- Academics and initial school setup
- Dashboard
- Students and staff
- Admissions and attendance
- Assessments and examinations, including grading and report cards
- Discipline, communication, documents, inventory, library, and transport
- Finance, Settings, and Reports

Database transactions enforce sensitive multi-record operations, including school setup, admission conversion, attendance, scores, payments, stock movement, borrowing/return, transport assignment, and approval-related operations. Each school's records are isolated by database policies tied to the authenticated membership; customers awaiting approval cannot access school records.

Approved schools can import an existing browser backup from the account-status page. Legacy document files are uploaded into the private school bucket during that import. Local-mode backup/reset controls apply only to browser-local data; use Supabase's backup facilities for cloud recovery.

Without Supabase configuration, the app continues to use its prototype browser storage and local authentication. The seeded local administrator credentials are for development only; do not use `12345` in a live environment. This frontend prototype is not a substitute for a production deployment review, tested database migration, backups, monitoring, email configuration, or real payment integration.

## Feature coverage

The prototype includes students, staff, academics, attendance, admissions, assessments, examinations/report cards, finance, discipline, communication, documents, inventory, library, transport, and the Reports Center. Activities remains a placeholder. Some user and permission models, notifications, and external delivery/payment integrations still need production-specific implementation.

## Subjects per grade, timetable and report cards (latest changes)

- **Subjects per grade:** Academics → Classes → *Manage subjects* on each grade ticks which subjects that grade takes (or copy from another grade). Subjects can now be edited (name, code, curriculum, grades) and filtered by grade. Report cards, marks entry and timetables only use the grade's own subjects.
- **Timetable:** printable weekly grid (class, teacher and student views), editable periods, multi-day add, breaks (Tea, Lunch, Games...) for one grade or every grade, clash checks for class/teacher/room. Click a cell to edit or add.
- **Report cards:** A4 print layout with class position, class averages, grade remarks, attendance, comments and signatures. *Print whole class* prints every student's card, one per page. Use the browser print dialog's *Save as PDF* for a file.
- **Sharing:** Email / SMS / WhatsApp buttons open the device app with the message ready (nothing is sent automatically). With Supabase connected, *Create secure link* publishes a private `report.html?t=...` link a parent can open and print; it can be updated or revoked. Apply `supabase/migrations/202610130001_timetable_breaks_and_report_sharing.sql` first.
- Fixed: the Supabase report card screen read the school profile from data that was never loaded.

## Import / export, and who can see what (latest changes)

### Import & Export (menu: Import & Export)
- Import **students** (a whole school or one class, with parents linked automatically), **marks** (one class, one column per subject), **admissions**, **staff**, **subjects**, **classes & streams**, **library books** and **inventory** from Excel (.xlsx/.xls) or CSV. Export any of them to Excel or CSV; exported files can be imported again unchanged.
- Messy files are fine: title rows above the headings, your own column names (e.g. "ADM NO", "NAMES"), Excel dates, phone numbers that lost their leading 0, "Grade 1 A" meaning class + stream. You see the column matching and a row-by-row preview (ready / note / skipped / problem) before anything is saved, and can download the problem rows.
- **Marks**: choose the exam and class, download the pre-filled class sheet (or use your own), fill in marks and upload. Only that grade's subjects are accepted; totals, grades, positions and report cards are calculated automatically. "ABS" or blank leaves a mark untouched.
- Excel support loads from a CDN the first time (needs internet). Try the files in `sample-import-files/`.

### Roles
Administrators add colleagues under **Settings → Team & access**. Roles: **Administrator** (Principal/Director/Head teacher: everything), **Accounts / Finance** (finance, finance reports, look up students), **Admissions & Students** (admissions, students, documents), **Teacher / Trainer** (academics, attendance, timetable, exams & assessments, communication, documents).
- Menus, dashboards, report tabs, import/export lists and add/edit buttons all follow the role. Rules live in `js/config/roles.js`.
- Cloud mode: the **database enforces the same rules** (`supabase/migrations/202610140001_roles_and_team.sql`), so they hold even if someone bypasses the screens. Colleagues join with an invitation code (Log in → "Join with your invitation code").
- Browser-only mode (no Supabase): each person gets their own login on the same computer; enforcement there is in the app only (not secure against someone using browser tools).

## Subscription packages, Control Centre & strict student capacity

**Done and tested in the browser (local mode) and with `node tests/capacity.test.mjs`:**
- **Package & Feature Control Centre** (platform admin → *Package & Feature Control Centre*): per-school capacity table (paid limit, overflow, maximum, active, remaining paid, over paid, remaining overflow, warning level, expiry/renewal); per-school package, billing, status, trial, add-ons, capacity override (custom maximum + expiry date), per-module and per-feature overrides; package/price/limit/module/feature editor, monthly billing switch, add-on prices, combined-pack discount, separate charges; payments to verify; audit log. Every change needs a reason and a confirmation and is audited.
- **Strict capacity enforcement** (`js/services/capacityGuard.js`, hooked into `storage/Repository.js`): registration, admission conversion, bulk import (refused as a whole), re-activation and transfers are rejected past the maximum with the exact message from the brief. Existing records can still be edited; withdrawing/graduating/archiving is never blocked and frees a place. Same admission number never counts twice.
- **Subscription page for schools** (`#/subscription`): current package, dates, renewal status, capacity meter, price breakdown with every line and the total, request, and manual payment submission. A payment reference **never** activates anything — only the platform admin's *Verify & activate* does. A capacity banner appears above every page when near/over/at the limit.
- **Entitlements**: modules the package doesn't include disappear from the menu and show "Not included in your package" (records are kept). Essential modules always stay open. Schools with no package assigned yet keep everything.

**Cloud (Supabase) mode:** migration `supabase/migrations/202610160001_subscriptions_and_capacity.sql` adds the catalogue, subscriptions, payment verification, audit log and a database trigger so the limit holds even if someone bypasses the screens. This migration is applied to the linked staging project; production still requires a separate project and migration rehearsal.

**Not built yet:** Bursar Pack screens (refunds, optional charges, sibling discounts, SwiftIQ Pay settings, reconciliation, bursar dashboard), Teacher Pack screens (lesson plans, homework, eLearning, live lessons, welfare, teacher dashboard), parent/student portal additions for both, Principal/Bursar role dashboards, Activities/Health/Hostel screens. The switches for all of these already exist in the Control Centre. M-Pesa, SMS/WhatsApp and video lessons need an external provider and a server-side function.

## Bursar Pack (inside the existing Finance module)

Extra Finance tabs appear only for features the school's package includes (Control Centre → features): **Bursar dashboard, Invoices, Payments & receipts, Fee reminders, Refunds, Charges & discounts, Reconciliation, SwiftIQ Pay, Bursar reports.** Existing tabs are unchanged.

- **Confirmed-only money:** cash is receipted at once; M-Pesa, bank, cheque and SwiftIQ Pay entries stay *pending verification* and never reduce a balance until confirmed (manually, or from a matched statement). Each confirmation creates exactly one numbered receipt. Invoice, receipt and refund numbers are sequential per year (INV-2026-0001).
- **Invoices:** single, bulk and segmented (whole school, classes, streams, boarders/day/transport groups, individuals), with preview, duplicate protection, optional charges, transport fee (set a *Fee per term* on each Transport route) and sibling discounts. Print, CSV export, void (only with no payments).
- **Sibling discounts:** families = children sharing a parent record; configurable tiers; optional approval, in which case the invoice is created without the discount until the approver accepts.
- **Refunds:** limited to confirmed payments, request → approve → paid out (reference required), full history on each refund. Approval limited to the school administrator when *Refund approvals* is on.
- **Reminders:** configurable schedule/template/channels; shown as *queued*, never *delivered* (no provider connected). Buttons open SMS/WhatsApp/email on the device.
- **SwiftIQ Pay:** settings and "how to pay" text on invoices only. Live M-Pesa confirmation needs a server-side callback — not built.
- **Parent portal:** fee figures ignore unconfirmed payments and show receipts (cloud mode needs migration `202610170001_bursar_pack.sql`).

Tests: `node tests/capacity.test.mjs` and `node tests/bursar.test.mjs`.

## Teacher Pack (inside Academics and Attendance)

Extra tabs appear only for features the package includes: **My teaching** (teacher dashboard), **Lesson plans**, **Schemes of work** (term plans with week-by-week completion), **Homework**, **eLearning**, **Live lessons**, **Student welfare**, **Academic reports**, **Class allocation** (administrator). Attendance gets a **Parent notices** tab. Existing tabs are unchanged.

- **Who sees what:** a teacher's login is linked to their Staff record by **email address**. Their classes come from *Class allocation* plus the timetable. Class pickers, the Students list, attendance and every Teacher Pack screen show only those classes, and saving for another class is refused. A teacher whose email matches no staff record sees no classes (the screen says why) rather than everything. Administrators are unrestricted.
- **Homework:** publish with due date, instructions, links and maximum marks; per-student status, marks (bounded by the maximum), feedback; late hand-ins are labelled late; feedback reaches parents only when "Share with parent" is ticked. Students have no login yet, so teachers record hand-ins on their behalf.
- **Student welfare:** confidential. Only the administrator and teachers the administrator ticks under *Who may use welfare records* can open or add notes — everyone else gets nothing, whatever their role. Teachers can only note students in their own classes.
- **Absence notices:** queued per absent/late student per day, never shown as sent; buttons open SMS/WhatsApp/email on the device. Parents with no contact details are flagged.
- **Live lessons:** schedule and share a Meet/Zoom/Teams link (http/https only). EduFlow does not host video.
- **eLearning:** notes and links per class, with a visible-to-parents switch. Quizzes are not built.
- **Parent portal:** shows homework status, shared feedback and marks, published materials and upcoming live lessons for the child's class (cloud mode needs migration `202610180001_teacher_pack.sql`).

Tests: `node tests/capacity.test.mjs`, `node tests/bursar.test.mjs`, `node tests/teacher.test.mjs`.

## Packages on the landing page, sign-up and Super Admin

The old plan list (Private/Public Primary & Secondary, Bronze/Silver, onboarding fee, "single or both modules") is removed everywhere. The landing page, sign-up form and Super Admin school screen now all read the six size-based packages (Micro → Enterprise Plus) from the catalogue the Super Admin edits in **Package & Feature Control Centre → Packages & prices**, so a price change shows up on the landing page and in new invoices straight away.

- **Sign-up:** choose a package and a billing frequency (per term / per year, and monthly if switched on). The total payable is shown; Enterprise Plus is by quotation.
- **Super Admin → Schools → a school:** change its package and billing, create the package invoice (package line, add-on packs and separate setup/training/migration charges, each its own line), approve or suspend the school, and **Activate / Apply / Suspend / Resume the subscription**. Every subscription change needs a reason and confirmation and is audited. Suspending locks the package's optional modules; essential records stay open and nothing is deleted.
- **Existing schools** registered under the old plans show "old plan — choose a new package" until the Super Admin assigns one.
- **Cloud mode:** migration `supabase/migrations/202610190001_new_packages.sql` (the old single/both column now stores billing frequency) is applied to the linked staging project. Production still requires a separate project and migration rehearsal.

## Offline-first attendance and marks (Phase Two)

New **Mobile register** (Attendance) and **Mobile marks** (Exams & Assessments) screens for phones:
- Every tap is saved on the phone first (IndexedDB), then synced. Works with no signal; survives refreshes and restarts. A service worker lets the app itself open offline (https or localhost).
- Each learner shows Waiting to sync / Syncing / Synchronized / Failed / Conflict. "Synchronized" only appears after the stored record was actually updated.
- Teachers only see classes assigned to them (Class allocation or timetable), whatever the package.
- Duplicates are impossible (one record per learner per class per day / per assessment); retries are idempotent; edits made while a sync is in flight are kept.
- Two phones editing the same record: the second gets a **conflict** with the other value shown, and chooses Keep mine / Use server's. Nothing is silently overwritten.
- Marks: drafts autosave as you type and are restored after a refresh; marks are checked against the maximum before submission.
- **Demo mode only for now:** syncing targets the browser's own school data. The cloud transport is the backend phase — see `docs/OFFLINE_SYNC_CONTRACT.md`. Run `node scripts/generate-precache.mjs` before each deploy.
- Tests: `node tests/run-all.mjs`.

## Bursar Pack, Phase Three (demo mode)
Adds **Fee statements, Installment plans, Credit notes, Cashbook, Financial audit**, plus scholarships/sponsorships, split-payment allocation, payment rules, an extended Bursar dashboard and an unmatched-payment **review queue** in Reconciliation. All money rules are in `js/services/bursarLogic.js` (pure, tested). Details and the cloud to-do list: `docs/PHASE3_REPORT.md`. Run all tests: `node tests/run-all.mjs`.

## Teacher Pack, Phase Four (demo mode)
**My workspace** (sidebar) groups every teacher tool: timetable & deadlines, class lists & learner profiles, attendance, lessons, homework, marks, exam results, **report-card preparation** (private drafts → "ready"), class announcements, and (administrator) class teacher + **curriculum templates**. Details: `docs/PHASE4_REPORT.md`. Browser test scripts: `tests/browser/`.

## Academic engine, Phase Five (partial)
All report calculations now run through `js/services/academicEngine.js` under a school-configurable **report policy**, with optional **weighted assessments** — set in Exams & Assessments → **Report settings** (administrator, demo mode). See `docs/PHASE5_REPORT.md` for what is done, what is not (approval workflow screens, competency/coverage screens, publication), and a correction about rounding.

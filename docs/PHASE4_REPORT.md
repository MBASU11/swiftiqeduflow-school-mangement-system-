# Phase Four report — completing the Teacher Pack

## Built (demo mode; cloud versions wait for the backend phase)
| Brief item | Where |
|---|---|
| Unified teacher workspace | **My workspace** (sidebar, for packages with the Teacher Pack): Today · My classes · Teaching · Assessment · Communication · Care · Set-up. Reuses every existing teacher screen, the Mobile register and Mobile marks. The Academics page also shows the Teacher Pack tabs in their own labelled row. |
| Assigned classes and subjects, class lists, learner profiles | **Class lists & learners** — class list (printable), per-learner profile: attendance for the term, homework hand-in rate, assessment average and trend, exam average, parent/guardian contacts. Fees, health and welfare are deliberately not shown. |
| Examination results | **Exam results** — the teacher's own subjects only, class mean, missing marks |
| Report-card preparation | **Report-card preparation** — subject comments (drafts are private until marked **ready**), per-learner marks completeness, bulk "mark ready"; the **class teacher** also writes the class comment. Only ready comments reach the printed report card. |
| Class announcements | **Class announcements** — post to a class you teach (goes through the school's normal announcements) |
| Teacher timetable and deadlines | **Timetable & deadlines** — today's lessons, week grid, and one deadlines list (homework due/to mark, assessments, missing marks, lessons not marked taught, live lessons) with overdue first |
| Configurable curricula | **Curriculum templates** (administrator): each curriculum gets its own extra lesson-plan fields. Competency-based, syllabus-based and generic starting templates are only presets to copy and edit; nothing in the app depends on a curriculum name. |
| Class teacher | a checkbox on **Class allocation**; one class teacher per class |

## Bugs found by this phase's testing (and fixed)
1. **Today's timetable was always empty** on the earlier teacher dashboard: it compared weekday names to the timetable's `MO/TU/WE` codes.
2. **Teachers could not use several earlier Teacher Pack buttons.** The app hides anything that looks like a write button ("New…", "Save…", "Mark…") on pages where the role is read-only; teachers have read-only Academics, so "New lesson plan", "Save lesson plan" and similar were hidden. My earlier tests called the services directly and missed it; a real-browser test as a teacher found it. Teacher tool screens now opt out (`data-own-permissions`); the repository still refuses any write the role may not make.

## Tests actually run
* `node tests/run-all.mjs` — **11 files pass**; new: `teacher4.test.mjs` (13 rule checks) and `teacher4-service.test.mjs` (permissions as real teacher accounts: own-subject comments only, drafts private, one class teacher per class, class announcements only to own classes, frameworks admin-only and lesson plans keep exactly the defined fields).
* Mutation check: breaking the day-code and "ready only" rules made 2 tests fail.
* Real Chromium as an administrator and as a teacher: every screen above exercised (see `tests/browser/phase4_browser.py`, now shipped in the project with a README), plus a phone-size layout check. No page errors.

## Not done / not proven
* **Cloud mode:** the new tabs and workspace are demo-only. The backend must add `reportComments` and `planningFrameworks` to the SQL role table (teachers write comments; administrators write templates), make `parent_portal()`/report-card publication include ready subject comments, and enforce "class teacher only" and "own subjects only" server-side (today the database only knows collection-level roles; a teacher with write access to `reportCards` could change a principal comment through the API).
* Report-card **moderation/approval/publication workflow, grading rules and PDF output are Phase Five**; "ready" here means "the subject teacher is done", not "approved".
* Announcements reach parents only through the existing announcements feature (no SMS/WhatsApp).
* Not built: a teacher-side view of a learner's welfare history inside the profile (welfare stays in its own restricted tab), marking-deadline settings, per-week extra fields on schemes of work (curriculum templates apply to lesson plans).
* Only Chromium tested; no real phones.

## Continue from here
Phase Five: the academic engine and report cards (configurable grading scales and weighted assessments, draft → moderation → approval → publication, curriculum coverage, branded PDF report cards, secure parent/learner access). Backend phases remain last.

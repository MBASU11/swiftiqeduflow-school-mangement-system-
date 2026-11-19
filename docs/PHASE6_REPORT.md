# Phase 6: parent and learner portals (demo mode)

## What works
- **Family logins** (Settings → Learner and parent logins, administrators only): a username + password for one learner or one parent. A learner's username defaults to the admission number, a parent's to their phone number. Passwords are shown once on creation; reset and remove are available.
- **Sign in** with "Email or username" on the normal login page. A parent or learner login opens the portal and nothing else (no school screens, even by typing `#/students`).
- **Parent portal:** only children linked to that parent: report cards, fees/receipts, homework, learning materials, live lessons, timetable, attendance (30 days), notices.
- **Learner portal:** the same screen for the learner only, **without fees or receipts**.
- **Report cards appear only when the class's report run is published**, with the approver's name on them. Unpublish hides them again.
- Notices follow audience: school-wide, parents or learners, class, stream.
- Code: `demoPortalService.js` builds the data (same shape as the cloud `parent_portal()`), `parentPortal.js` draws it (`renderDemoPortal`), `familyAccess.js` is the admin screen, `authService.js` has `createFamilyAccount` / `listFamilyAccounts`.
- Tests: `tests/portal.test.mjs` (Node), `tests/browser/portal_check.py`.

## Limits (be honest with schools)
- **Demo mode is not secure storage.** The data and the password hashes live in the same browser. These logins separate who sees what on screen; they do not protect data from someone with the device. Real protection needs the backend (database access rules).
- **Cloud mode:** the parent portal already exists there (invitation-based). A cloud **learner** role (database function, invitations, access rules) is not built; it belongs to the backend phase.
- Parents can see homework status but cannot hand in for a learner (young learners without a login are not covered yet).
- No password-reset by email in demo mode: the administrator resets it.

## Learner homework hand-in (added after Phase 8 Hostel)
- In the learner portal each published homework for the learner's class has a **Hand in** button: a written answer (up to 5,000 characters) and/or one file (PNG, JPEG, PDF or text file, **up to 300 KB**: browser storage is small).
- **Rules:** before the deadline a hand-in can be changed or its file removed or replaced. After the deadline a first hand-in is still accepted and recorded as **late**, but a hand-in already made is frozen. Once the teacher has **marked** it, it is frozen for good. A learner can only hand in homework for their own class.
- **Teacher side:** the learner's answer and a download link appear under their name in the marking table. **Fixed:** marking no longer overwrites the learner's answer (it used to blank the text field).
- **Marks and feedback** reach the learner or parent only after the teacher publishes feedback. Until then a marked item simply shows "Handed in". (The demo portal previously showed marks as soon as they were entered.)
- Code: `handInLogic.js` (rules), `handInService.js` (storage), hand-in panel in `parentPortal.js`. A learner login can write to the homework submissions collection and nothing else. Tests: `tests/handin.test.mjs`, `tests/browser/handin_check.py`.
- **Limits:** demo mode; files are stored in the browser, so a school should not rely on this for large work; no notification to the teacher yet (they see it in "Homework to mark"); no "return for correction" step yet.

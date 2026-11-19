# What is still pending (outside the database), as of this pass

## Done in this pass
- Accessibility: darker helper-text, green and amber colours (all now pass WCAG AA contrast); every form control gets an accessible name (`js/components/a11y.js`, installed once at start-up); scrollable tables are keyboard-reachable; visible focus outline. Re-scanned with axe-core on the landing page, login, signup, every school screen listed in the nav, and the Super Admin console: 0 issues.
- Student profile tabs (Academics, Attendance, Finance, Discipline, Transport, Activities, Health) now show the learner's real records, with honest messages when the person's role or the school's package does not allow it. Health summary is administrators and nurse only, and logged.
- Landing page: feature list now matches what is built (Inventory, Reports Center, Principal's view, parent and learner portals, Clubs & activities, Hostel & boarding); the outdated "coming soon" line is gone; Health is shown as "coming soon" (on the Professional card: "Adds: ... Health (coming soon)") until the secure cloud version is live. To release it, remove `soon: true` from the Health module in `js/config/features.js`.

## Still to do before real schools
1. ~~Privacy policy, terms and data-protection notice~~ Drafted and wired in (see docs/PRIVACY_CHECKLIST.md). Still needs a lawyer's review, the owner's details in Business settings, ODPC registration, and the Kenya hosting requirement (regulation 26) must be met before real schools use it.
2. Security headers / Content-Security-Policy at the hosting layer; two-step login screen for admin accounts; error monitoring.
3. ~~CBC competency tracking screens~~ Done: see docs/CBC.md.
4. Notifications (report ready, fee reminders, exeat, homework hand-in alerts): need the SMS provider.
5. Finance: late fees, debit notes, sponsor invoices, one statement per family, opening balances.
6. Smaller: lesson-level attendance, before/after audit history screen, signature image on report cards, homework "return for correction", a warden role, boarding and activity fees through Finance.

## Needs the owner (not code)
Supabase staging project, Safaricom Daraja access, SMS provider account and Sender ID, WhatsApp Business verification if wanted, a Kenyan data-protection lawyer, the payment-instructions text shown to schools, and the decision on which package carries Health and Hostel.

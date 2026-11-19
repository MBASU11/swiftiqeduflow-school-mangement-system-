# Super Admin automation, packages and pricing page

## What the Super Admin does now
Open the console. The **Needs you** panel lists only what needs a decision, each with one button:

| Item | One-click action |
|---|---|
| School awaiting approval | **Approve & invoice** (or **Approve all**): approves, allocates the package the school chose, starts its trial, issues the first invoice at the catalogue price |
| Payment a school submitted | **Verified: activate**: subscription active, invoice marked paid |
| Overdue invoice | **Copy reminder** (ready-to-paste text) |
| Renewals not yet invoiced | **Create renewal invoices** (also created automatically once a day) |
| Trial ending, school near its student limit | Shown for information |

**Automatic, no click:** a subscription invoice paid in full activates or renews the subscription (wherever the payment is recorded); a renewal continues from the day after the old expiry; when a trial ends unpaid or the grace period runs out, the school is restricted to its essential records (nothing is deleted); renewal invoices are created `renewalWindowDays` before expiry.

Settings (Control Centre → Packages & prices → Automation): trial on approval, first invoice on approval, automatic renewal invoices, invoice due days, renewal window, grace days after expiry (default 7), trial length.

## The simplified Super Admin (latest)
- **Packages tab** (was "Package & Feature Control Centre"): one screen. Each package shows its student limit and prices (the only things that normally change), what it includes and does not include in plain words, and how many schools are on it. Saving checks the numbers (limits and prices must rise from one package to the next). One button resets what every package includes to the recommended sets. Modules, features, add-ons, billing options, automation rules and the audit log are under **Advanced**, one tap away, with a way back.
- **School page:** one card, "Package & students": the package, students against the limit (with a bar), the subscription state and what happens next, and a **Change package** control that does the rest automatically. Moving up applies now and issues a pro-rated invoice for the days left (it does not alter the subscription dates). Moving down takes effect at renewal, and the renewal invoice is at the new price. Before the first payment the unpaid invoice is cancelled and reissued. A package priced by quotation, or a part-paid first invoice, is refused with the reason. The old manual controls (Save package, Activate, Suspend, Resume, per-school limit and module overrides) are folded under **Manual overrides (rarely needed)**.
- Student limits and modules follow the package automatically: capacity is enforced from the package (limit plus allowance), and a lapsed school drops to its essential records.

## Packages: what each includes by default
Core (all packages): Dashboard, Students, Academics, Attendance, Settings, Import & Export (backups are never a paid extra).
- **Micro:** + Admissions, Timetable, Exams & assessments, Finance, Communication, Reports, Documents, Parents & learners portal
- **Starter:** + Transport, Inventory, Discipline, Library, Staff
- **Professional:** + Activities, Health, Hostel / Boarding
- **Advanced, Enterprise, Enterprise Plus:** same modules, plus higher-tier features (analytics, audit controls, multi-campus, departmental permissions). See the per-feature table under Control Centre.
- **Add-on packs** (Bursar Pack, Teacher Pack) unlock extra finance and teaching features on any package that includes the module.
The Super Admin can change any of this in **Packages & prices → What each package includes**, and use **Reset to recommended** to restore it. A single school can be given an extra module under Schools & capacity → Manage. Catalogues saved before this change (everything on everywhere) move to the recommended sets once; customised ones are left alone.

## Pricing page
Each plan card shows what it adds over the one below and what it does not include, generated from the live catalogue, so it cannot disagree with what a school actually gets. The add-on packs and their prices are listed below the cards. (The full feature-by-feature comparison table was removed from the landing page at the owner's request; the data behind it, `comparisonTable()` in `js/config/plans.js`, is kept and tested, so it can be brought back or reused for a printable price list.)

## School side
The Subscription page shows the school's invoices (due date, balance, overdue), a trial notice, and the platform's payment instructions (set in the console's business settings). A module outside the package says which package includes it.

## Limits (demo mode)
- The automation runs when the console is opened (no server clock in demo mode). In cloud mode it moves to the server in the backend phase.
- Reminders are text to copy; sending them by SMS or WhatsApp needs the SMS provider. Payments are still confirmed by the admin until M-Pesa (Daraja) is connected, after which they can be confirmed automatically.
- New schools still complete the setup wizard before their workspace opens.
- Cloud (Supabase) mode does not yet have the "Needs you" panel or automatic invoicing.
- Tests: `tests/platform.test.mjs` (Node), `tests/browser/platform_flow.py` (whole journey, phone-sized).

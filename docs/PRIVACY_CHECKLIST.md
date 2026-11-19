# Privacy, terms and data protection: what was built, and what must be true before launch

**Status: DRAFT FOR LEGAL REVIEW.** Nothing here is legal advice. A Kenyan data-protection lawyer must read the three public pages and the parents' template, fill the yellow items, and then the owner sets the review date in Business settings (the "Draft" banner disappears).

## What was built
- Public pages `#/privacy`, `#/terms`, `#/processing` (Privacy Notice, Terms of Service, Data Processing Terms), linked from the landing page footer, the login and signup pages, and the parent and learner portal. Text lives in `js/config/legalText.js`; the owner's details come from **Business settings → Legal and privacy details**. Anything missing shows as a yellow "[to be completed: …]", never a guess.
- Signup now requires accepting all three, and the account records the version and time (`account.terms`) as evidence.
- **School side:** Settings → "Privacy notice and consent form for parents": the school (the data controller) answers a few questions and gets a printable notice in its own name plus a consent form with a separate, optional tick for each purpose (first aid and medicine, health information, photographs, messages). Parents see the notice in their portal.
- Sources used: the Data Protection Act, 2019 and the Data Protection (General) Regulations, 2021 (ODPC). Time limits in the text are the Regulations': access 7 days; correction, deletion, restriction and objection 14 days; portability 30 days. The Data Processing Terms follow regulation 24(2).

## ⚠ Hosting must change from what I recommended earlier
Regulation 26 of the Regulations says that processing personal data **for offering early childhood education and basic education under the Basic Education Act** must be done through a server and data centre **located in Kenya**, or with **at least one serving copy** stored in a data centre in Kenya. I earlier suggested hosted Supabase in Frankfurt with a documented transfer; that is **not enough** for school records. (Supabase's hosted regions do not include Africa.) Options, for the lawyer and you to choose between:
1. **Self-host the open-source Supabase stack (Postgres, auth, storage, functions) on infrastructure in a Kenyan data centre.** Same code, full control, simplest to defend. My recommendation.
2. Hosted Supabase as the main database plus a continuously updated serving copy in Kenya. More complex, and "serving copy" needs the lawyer's reading.
3. Postgres plus our own API on Kenyan infrastructure (more work, no new benefit over 1).
The current linked staging project is in Supabase region `eu-west-1` (Europe), not Kenya. The previous draft described this as Frankfurt; confirm the exact data-centre location with the provider. Other purposes listed in the same regulation may also apply to some modules (for example health), so have the lawyer confirm. The privacy page already says data is stored in the location entered in Business settings and that this is in Kenya for basic education: make that true before production.

## Every promise in the text, and what makes it true
| Promise (where) | Today (demo) | Needed before launch |
|---|---|---|
| Access by role; each school separate (privacy, DPA) | Yes, in the screens | Database-level isolation (row-level security) and automated cross-school tests |
| Passwords hashed, 8+ characters | Yes | Production login service (Supabase Auth) |
| Sessions end after inactivity | Yes | Keep in cloud login |
| Activity log of important actions | Yes, in the browser | Server-side log that users cannot edit |
| Health records: admin and nurse only; each opening logged | Yes, in the screens | Strict database rules; server-side log |
| Encrypted connections | n/a | HTTPS everywhere on the host |
| Backups, restore tested | Manual download only | Scheduled backups and a recorded restore test |
| Staff open school records only when needed, confidentiality | n/a | Written support-access procedure, access logged, staff contracts |
| Sub-processors listed and authorised | Empty | Fill in the list; sign agreements with each (hosting, SMS, payments) |
| Breach: tell the school within 48 hours; school tells ODPC within 72 hours | n/a | Written breach procedure and register. **Have the lawyer confirm the 48-hour processor deadline** (I took it from a law-firm summary, not the Act's text) |
| Pass data-subject requests to the school within 2 working days | n/a | **Owner decision** (my proposal); needs a request log |
| Delete data within N days after the agreement ends (default 90) | Backup/export only | A deletion job and a record that it ran |
| Return data on request in a common format | Backup file | Export tool for a school's complete data |
| No ad or analytics trackers | True | Keep it so. Fonts load from Google Fonts, which the notice discloses: **self-host the fonts** to remove that third-party request |

## Paperwork (not code)
Register with the Office of the Data Protection Commissioner and put the number in settings; a data protection impact assessment for children's and health data; agreements with each sub-processor; a data-subject-request procedure; a retention schedule; keep the signed parent consent forms (the school's job; the template helps).

## Gaps I found while writing this
- No failed-login lockout or rate limiting; no two-step verification for administrator accounts (so the text does not mention either; both should exist before launch).
- Cloud (Supabase) signup does not yet store the terms version; only demo mode does.
- Parental consent is on paper; only first-aid consent is recorded in the system (health profile). Digital consent records are a later feature.
- The public legal pages read the owner's details from Business settings in demo mode; in cloud mode they need a public settings row.

## Decisions for the owner
Refund policy; support hours and response times; liability and dispute-resolution wording (lawyer); retention days (default 90); the 2-working-day forwarding promise; who the data protection officer is.

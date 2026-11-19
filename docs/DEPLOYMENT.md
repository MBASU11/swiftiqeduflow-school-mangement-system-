# SwiftIQ EduFlow — deployment, backup and rollback

> Status: Supabase staging project `swiftIQeduflow` is linked and configured in
> `js/config/supabase.js`. Migrations through `202610260003` have been applied and recorded on staging.
> The repository test suite passes. This is not a production deployment: the current Supabase database
> region is `eu-west-1`. The owner has chosen to keep the database in Europe; obtain Kenyan legal advice on
> cross-border processing and safeguards before placing real school data in this project.

## 1. Two modes — never confuse them
| | Demo mode | Cloud mode |
|---|---|---|
| Turned on by | leaving `SUPABASE_URL` / `SUPABASE_ANON_KEY` empty in `js/config/supabase.js` | filling both in |
| Where data lives | the browser's localStorage only | your Supabase project |
| Passwords / permissions | checked in the browser — **anyone with the device can read or edit them** | checked by Supabase Auth, row-level security and database functions |
| Banner | a brown "DEMO MODE" bar is always shown | none |
| Use for | demos, training, trying the screens | real schools |

Never enter real learner or payment records in demo mode.

## Netlify static website
The repository includes `netlify.toml` and `scripts/build-netlify.mjs`. The build copies only the public
app shell, assets, CSS, and JavaScript into `dist/`; it does not publish documentation, tests, or SQL
migrations. Netlify applies HTTPS security headers and revalidation headers suitable for the app's
un-hashed assets and service worker. Connect the project folder/repository in Netlify and use the
configured build command and `dist` publish directory. After the first deploy:
1. Add the production site's exact HTTPS origin as the Supabase Auth Site URL and add the required auth redirect
   URLs (including the password-reset URL) in Supabase.
2. Test sign-in, email confirmation, password reset, sign-out, refresh/deep links, and service-worker updates
   using a non-production test school.
3. Keep learner and payment data out of the site until the cross-border legal review, production backup/restore,
   and operational checks below are complete.

## 2. Secrets
* `SUPABASE_ANON_KEY` is public by design; it is safe in `js/config/supabase.js` **only because row-level
  security protects every table**.
* The **service-role key and the database password must never be committed or placed in any file served to a browser.**
  They belong only in a trusted server (e.g. a Supabase Edge Function's secrets) for future payment/SMS callbacks.
* No migration in this repository contains a secret (checked by `tests/sql-security.test.mjs`).

## 3. Applying migrations (staging first)
Order matters:
```
202610060001_initial_backend.sql
202610130001_timetable_breaks_and_report_sharing.sql
202610140001_roles_and_team.sql
202610150001_parent_portal.sql
202610160001_subscriptions_and_capacity.sql
202610170001_bursar_pack.sql
202610180001_teacher_pack.sql
202610190001_new_packages.sql
202610200001_security_hardening.sql
202610210001_delete_school.sql
202610220001_kenyan_education_reference.sql
202610260001_fix_platform_invoice_numbering.sql
202610260002_combine_platform_settings_read_policy.sql
202610260003_fix_jsonb_object_length.sql
```
1. Create a **separate staging Supabase project**. Never rehearse on production.
2. Take a backup first (section 4) — even of an empty project, so you have the habit and the procedure.
3. Apply each file in order (Supabase SQL editor or `psql "$STAGING_DB_URL" -f <file>`), stopping at the first error.
   Several files *replace* functions/policies (`role_collection_access`, `parent_portal`, `enforce_role_write`,
   `school_records_select_approved`, `complete_school_setup`); read the diff against the previous version before applying.
4. Run the SQL checks: `npx supabase db query --linked --file supabase/tests/privileges_and_isolation.sql`
   or `psql "$STAGING_DB_URL" -f supabase/tests/privileges_and_isolation.sql`. Part A must print
   "PART A PASSED"; Part B must print "PART B … PASSED" and rolls back.
5. Run the repository tests: `node tests/run-all.mjs`.
6. Only after staging is green, repeat on production during a quiet period, with a fresh backup.

## 4. Backup and restore
* Turn on Supabase's daily backups (paid plans include point-in-time recovery — enable it for production).
* Manual dump: `pg_dump "$DB_URL" --format=custom --no-owner --file=eduflow-$(date +%F).dump`
* **Test the restore**, not just the backup: create a scratch project, `pg_restore --no-owner -d "$SCRATCH_DB_URL" <dump>`,
  sign in as a test school and confirm students, invoices and payments are present. Record the date you did this.
  *(Not yet done for this project.)*
* Before every production migration: dump, then keep the dump until the next successful backup cycle.

## 5. Creating the first platform (Super Admin) account — cloud mode
There is no default account anywhere. In Supabase → Authentication, create the user with a strong, unique
password, then (SQL editor, as owner):
```sql
insert into public.platform_admins (user_id) select id from auth.users where email = 'you@yourcompany.co.ke';
```
Enable MFA for that user (Supabase Auth → MFA) — the app does not yet have its own MFA screen.
In demo mode the first visitor to the platform console creates the administrator themselves; no password is pre-set.

## 6. Rollback
* `202610200001_security_hardening.sql` only changes who may run functions — to roll back, `grant execute` again
  (not recommended: it re-opens the audit-forgery hole it closes).
* Migrations 160001–190001 add tables/functions and replace some functions. Table additions are harmless if left in
  place. To roll back a *replaced* function, re-run the previous file's definition of it from git history.
* Anything destructive or unclear: restore from the pre-migration dump into a scratch project, compare, then decide.
  Never restore over production without a second dump of its current state.

## 7. Operations
* Watch Supabase → Logs (API, Postgres, Auth) and set an alert on error rate. The app shows people friendly
  messages and does not print passwords or tokens in them.
* Password reset needs Supabase Auth email set up (custom SMTP recommended for real volume) and the production site
  URL added to Auth → URL configuration → Site URL and Redirect URLs (include `https://your-site/?reset=1`).
* Payment, SMS and WhatsApp provider callbacks do not exist yet; when built they run as server functions holding
  their own secrets. Until then the app labels reminders as *queued*, never *delivered*.

## 8. Production release blockers
Do not put real learner or payment records in this staging project or publish it as a production service until these are resolved:
1. **Data location and legal review:** the linked Supabase database is in `eu-west-1` (Europe), not Kenya.
   The owner has chosen to retain the European region. Obtain legal advice on cross-border transfers and any
   data-localisation requirements, document safeguards, and do not use it for real school records until cleared.
2. **Production environment:** provision a separate production backend, rehearse the full migration and restore process,
   then configure and verify production-only client credentials. Never promote staging data or credentials by accident.
3. **Public web hosting:** deploy this directory to Netlify, attach a domain, and configure the Supabase Auth
   Site URL and exact redirect allow-list for that domain.
4. **Auth and operations:** configure production email delivery/custom SMTP, test signup/confirmation/password reset,
   enable MFA for platform administrators, establish backups and perform a documented restore test, and set up monitoring
   and incident response.
5. **Privacy/compliance:** complete legal review, fill the public legal pages and data-controller/subprocessor details,
   verify school consent and data-subject request processes, and complete required registrations/assessments.
6. **Feature scope:** confirm the published feature set against `README.md`; offline sync to cloud, real M-Pesa callbacks,
   automated SMS/WhatsApp/email delivery, and several optional modules are not production integrations.

## 9. Known backend feature gaps
1. Offline sync transport + `apply_sync_op` RPC — see `docs/OFFLINE_SYNC_CONTRACT.md`.
2. Bursar Phase Three tables/roles/functions — see "Not done" in `docs/PHASE3_REPORT.md`.
3. Live M-Pesa (Daraja) confirmation as a server function holding its own secrets, writing to the same payments/bank-transaction tables with unique transaction references.
4. SMS / WhatsApp / email delivery with provider callbacks, consent and opt-out.
5. Re-run `supabase/tests/privileges_and_isolation.sql` after every new migration and extend it to the new tables.

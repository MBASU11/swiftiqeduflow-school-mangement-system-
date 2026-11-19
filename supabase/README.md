# Supabase backend setup

The migration at `migrations/202610060001_initial_backend.sql` creates school registrations and memberships, admin roles, platform invoices/payments, tenant records, audit/history tables, transactional operations, and private document storage. `school_records` mirrors the app's current collection/record JSON format to support incremental migration. Row Level Security derives tenant access from the signed-in user's membership; clients do not choose a school ID for records.

## Create and configure the project

1. Create a Supabase project. Keep the database password and service-role key private.
2. Apply the migration with the Supabase SQL Editor or Supabase CLI.
3. Create the platform administrator as an Auth user. Grant the role using the Auth user's UUID:

   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = lower('admin@example.com')
   on conflict (user_id) do nothing;
   ```

   The local prototype password `12345` is not suitable for a real administrator.
4. Set the project URL and anon/publishable key in `js/config/supabase.js`. These client values are public; never add a service-role key or database password to frontend code.

## School signup

School signup calls Supabase Auth `signUp` with metadata fields `account_type: "school"`, `school_name`, `contact_name`, `phone`, `plan_id`, `plan_name`, `plan_modules` (`single` or `both`), and optional positive integer `student_count`. A database trigger creates the `pending` school and owner membership atomically. Pending customers can see their status and package invoices but cannot access school records or files. Approval remains a separate admin decision and is not automatically tied to payment.

## Connected app scope

With Supabase configured, the app uses Supabase for shared login/signup, admin approvals and billing, school setup, and the tenant modules currently exposed in the remote workspace: Dashboard, Academics, Students, Staff, Discipline, Attendance, Admissions, Assessments, Examinations/grading/report cards, Inventory, Library, Transport, Communication, Finance, Documents, Settings, Timetable, and Reports. Timetable entries are checked and inserted atomically to prevent class, teacher, or room conflicts. The local browser-storage mode remains available when Supabase configuration is blank. The workspace intentionally omits modules that still use local storage.

Sensitive multi-record operations run in database functions: school setup, exam and assessment score saves, attendance saves, admission conversion, payments, stock movements, library borrowing/return, transport assignment and cleanup, and current-year/default-grading selection. Student admission numbers are case-insensitively unique per school. Student invoice balances are derived from payment records; payment insertion is locked and rejected when it exceeds the remaining invoice balance.

## Documents and backups

Files are stored in the private `school-documents` bucket at `<school-uuid>/<document-id>/<file-name>`. The app stores only file metadata and the private object path in tenant records. Access policies require an approved school membership.

To move existing browser data, export a school backup from the local app. After the matching Supabase account is approved, import the JSON on the account-status page. Records are upserted in batches by collection and record ID, so retries are safe. Legacy file bodies in `documentFiles` are uploaded to the private bucket and linked to their metadata records. Import only a backup belonging to the school currently signed in.

Cloud backups and recovery should be managed through Supabase. The local Settings backup/reset controls apply only to browser-local mode. The migrations through `202610260003` have been applied to the linked staging project. The database isolation SQL checks and Supabase security advisor still need to be run with a valid database connection before any production launch.

## Second migration: timetable breaks/edit and shareable report cards

Apply `migrations/202610130001_timetable_breaks_and_report_sharing.sql` after the first migration. It adds timetable breaks and `update_timetable_entry`, plus `publish_report_card`, `revoke_published_report_card` and `get_shared_report_card`. The last one is callable by anonymous visitors but only returns the single report card whose unguessable token they hold; revoked links stop working immediately. Automatic bulk email/SMS delivery would need a server-side provider (for example an Edge Function with an SMS/email service) and is not included.

## Third migration: roles and team

Apply `migrations/202610140001_roles_and_team.sql` after the second. It adds the roles `accountant` and `registrar` (alongside `school_admin` and `teacher`), restricts reading and writing of school records per role (including inside the database functions), limits the audit log to administrators, and adds invitation-based team management (`create_school_invite`, `accept_school_invite`, `set_member_role`, `remove_school_member`, `list_school_team`). Existing owners keep the administrator role. If you use email confirmation, invited colleagues confirm their email, log in, and enter the invitation code once.
Storage-bucket file access (Documents) still follows the school-level rules; per-role file rules are not part of this migration.

## Fourth migration: subscriptions and strict student capacity

Apply `migrations/202610160001_subscriptions_and_capacity.sql` after the parent-portal migration. It adds `platform_catalogue`, `school_subscriptions`, `subscription_payments`, `platform_audit_log`, the trigger `school_records_capacity` (rejects any operation that would create more active students than paid limit + overflow, using the standard message, SQLSTATE `P0402`), and Super Admin functions. Schools without a subscription row are treated as legacy and are not limited. Payments only activate a subscription through `verify_subscription_payment`, which only a platform admin can call. Untested against a live project — try it in development first.

## Fifth migration: Bursar Pack

Apply `migrations/202610170001_bursar_pack.sql` after the subscriptions migration. It adds finance-role access to the new records, per-school document counters, `bursar_submit_payment` / `bursar_confirm_payment` (the server decides that only cash is confirmed on entry), and replaces `parent_portal()` so fees count only confirmed payments and show receipts. Written without a Postgres instance to test against — run it in a development project first.

## Sixth migration: Teacher Pack

Apply `migrations/202610180001_teacher_pack.sql` after the Bursar migration. It lets teachers write lesson plans, homework, materials, live lessons and attendance notices, adds `can_use_welfare()` so welfare notes are readable/writable only by the school administrator and people named in `welfareGrants`, and replaces `parent_portal()` again to include homework, shared feedback, materials and live lessons. Written without a Postgres instance to test against — run it in a development project first.

## School deletion and Kenyan education reference data

Continue migrations in filename order after Teacher Pack, package updates and security hardening:

1. `migrations/202610210001_delete_school.sql` adds the platform-admin-only `delete_school` function. School-owned rows cascade with the school; the platform audit event records the deletion.
2. `migrations/202610220001_kenyan_education_reference.sql` adds read-only reference tables for Kenya's 47 counties, pre-primary through Grade 12 stages, the three Senior School CBE pathways, the app's four CBC assessment levels, and Term 1–3 templates. Setup can optionally record a county and uses Kenyan school-stage categories; existing school profiles are backfilled where possible.
3. `migrations/202610260001_fix_platform_invoice_numbering.sql` fixes Super Admin invoice numbering by renaming the trigger's year variable so it cannot conflict with the counter table's `invoice_year` column.
4. `migrations/202610260002_combine_platform_settings_read_policy.sql` combines the administrator and school payment-settings read rules into one equivalent policy, avoiding a duplicate-policy performance warning.
5. `migrations/202610260003_fix_jsonb_object_length.sql` adds a safe JSON object member-count helper used by attendance and score-saving RPCs on PostgreSQL versions without the `jsonb_object_length` built-in.

County and school-type IDs are stored on `public.schools`; setup also keeps the profile JSON record used by the app. Reference tables are readable by anonymous and signed-in users, but writes are revoked. Term templates do not contain dates: each school must enter its own academic calendar. Subjects remain school-managed records so a school can assign them to the right grade. Full KICD learning-area lists and curriculum-design content are intentionally not fabricated or bundled; use the current [KICD CBC materials](https://kicd.ac.ke/cbc-materials/) as the source when a reviewed, grade- and pathway-specific catalogue is added.

These migrations are not applied to a project by this repository. No Supabase project is configured here; apply and test them in staging before production.

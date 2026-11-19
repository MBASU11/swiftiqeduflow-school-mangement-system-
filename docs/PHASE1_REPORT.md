# Phase One report — security and cloud readiness

## Audit findings
| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Built-in platform administrator `swiftiqenterprise@gmail.com` / `12345`, auto-created in demo mode | Critical (if demo build is ever exposed) | **Fixed** — removed; first-run creates the admin with their own password |
| 2 | Internal database helpers (`log_platform_event`, `school_limits`, `count_active_students`, …) and new client functions executable by `PUBLIC`/anonymous users — allowed audit-log forgery and reading another school's student counts | High (cloud) | **Fixed in `202610200001_security_hardening.sql`**; **not yet applied or run against a database** |
| 3 | Demo sessions never expired | Medium | **Fixed** — idle 60 min / 12 h cap (school); 20 min / 4 h cap (admin); reload no longer restarts the clock |
| 4 | Demo mode looked identical to a real deployment | Medium | **Fixed** — permanent "DEMO MODE" banner |
| 5 | No password reset in cloud mode | Medium | **Implemented** (request + set-new-password); **untested without a Supabase project** |
| 6 | Demo-mode password hashing is client-side SHA-256 ×1000 | Inherent | Documented: demo mode is not a security boundary. Real protection is cloud mode |
| 6b | Landing page claimed "Keeps working offline once loaded" but there is no service worker, so the app cannot load offline | Medium (misleading claim) | **Fixed** — claim removed; offline use is Phase Two |
| 7 | MFA for privileged accounts | — | **Not built**; use Supabase Auth MFA for the Super Admin for now |
| 8 | Monitoring / error logging | — | **Not built**; documented Supabase log monitoring only |
| 9 | Backup/restore test, staging migration run | — | **Not done** — no Supabase project available; procedure documented |

Good news from the audit: every table has RLS enabled; all SECURITY DEFINER functions pin `search_path`; no policy lets
the platform administrator read school records; no secrets appear in migrations.

## Tests (all run, results real)
`node tests/auth.test.mjs` 11/11 · `node tests/sql-security.test.mjs` 7/7 (and proven to FAIL 2 checks on the
pre-hardening migrations) · `node tests/capacity.test.mjs` · `node tests/bursar.test.mjs` · `node tests/teacher.test.mjs` all pass.
**Not run:** `supabase/tests/privileges_and_isolation.sql` (needs a staging database), any live-Supabase test.

## Continue from here
1. Create a staging Supabase project, fill `js/config/supabase.js`, follow `docs/DEPLOYMENT.md` §3–4.
2. Run `supabase/tests/privileges_and_isolation.sql`; fix any `FAIL`.
3. Test password reset end-to-end; enable MFA for the Super Admin.
4. Then Phase Two (offline attendance and marks).

# Phase 8: remaining modules (demo mode)

| Module | Status |
|---|---|
| Activities | **Done** (this section) |
| Health | **Done** (section below) |
| Hostel / Boarding | **Done** (section below) |

## Activities (clubs, sports, societies)
- **Activities:** name, category (club, sport, society, music & drama, service), coordinator, meeting day and time, venue, optional capacity. Archive instead of delete; reopen any time.
- **Members:** add current learners; capacity is enforced; roles (member, captain, leader, secretary); remove keeps history; rejoining reuses the record. A timetable clash with another of the learner's activities is warned, not blocked.
- **Sessions:** record attendance for a date (one session per date; saving again replaces it; no future dates; members only). Each member shows "attended X of Y sessions", counted only from the day they joined.
- **Achievements:** title, date, level (school to international), for the whole group or one member.
- **Principal dashboard:** "In activities" shows the share of current learners in at least one running activity.
- **Access:** administrators and teachers can manage; other roles do not see the module. The module is switched on in the package catalogue (`built` flag removed).
- Code: `activitiesLogic.js` (rules), `activitiesService.js` (storage), `features/activities/activities.js` (screens). Tests: `tests/activities.test.mjs`, `tests/browser/activities_check.py`.

## Limits
- Demo mode only; in cloud mode the screen says so.
- Not yet shown on a learner's profile, the report card or the parent portal.
- Activity fees and kit are not charged through Finance.

## Hostel / Boarding
- **Switch it on:** Settings has a school-level "Hostel / Boarding" switch (off by default); the Hostel menu entry appears once it is on.
- **Hostels and beds:** hostels (boys, girls, mixed) with a warden, rooms with a number of beds. One bed per learner; a room can never be over capacity; a girl cannot be put in a boys' hostel (and vice versa) when the learner's gender is recorded. Move between rooms, check out. A hostel with boarders cannot be archived; a room with learners cannot be removed.
- **Exeats / leave-outs:** request (type, dates, reason, who the learner goes with and a phone number; boarders only; overlapping requests refused) → approve or reject (reason required) → release (not before the leave date) → mark returned. Anyone still out after the return date shows as **overdue** on the Hostel page. Checking a learner out of boarding cancels pending exeats and is refused while they are out.
- **Who may decide:** administrators, and the **warden of that learner's own hostel**, matched by the teacher's email being the same as the signed-in account's. Other teachers can request but not approve, reject or release.
- **Roll call:** morning or evening, per hostel. A learner out on an exeat counts as accounted for; anyone else not ticked is listed as **unaccounted for**. Saving the same session again replaces it.
- Code: `hostelLogic.js` (rules), `hostelService.js` (storage), `features/hostel/hostel.js` (screens). Tests: `tests/hostel.test.mjs`, `tests/browser/hostel_check.py`.
- **Limits:** demo mode only; no boarding fees through Finance yet; no notification to parents on release or return (needs the SMS provider); a dedicated warden role is not built, so a warden is a teacher with Hostel access; roll-call history is stored but has no report screen yet.

## Also fixed in this phase
Forms in Activities and Hostel used to clear everything typed after a validation error. They now keep what was typed.

## Health (confidential)
- **Who:** administrators and the new **School nurse / Health** role (assign it under Team & access). Teachers, accountants, registrars, learners and parents have no access; nothing health-related appears in the parent or learner portal, on report cards, or on the principal's dashboard. Switch the module on in Settings ("Health"). Opening a learner's record is logged (who, when) and shown on their profile.
- **Learner profile:** allergies (with severity and reaction), conditions, emergency contact, doctor, blood group (optional), and whether a parent has consented to first aid and basic medication. "No known allergies" is different from "not recorded", and incomplete records show as a to-do list.
- **Sick bay:** record a visit (complaint, temperature, pulse, observations, action, medicine and dose, outcome). A learner sent home or referred needs the parent told first. Giving a medicine needs recorded parental consent (or a ticked phone-consent confirmation) and is **blocked on an allergy match** until someone confirms it is safe. Matching is deliberately loose and includes related medicines: a penicillin allergy flags amoxicillin and similar; a sulfa allergy flags Septrin and similar.
- **Standing medication:** name, dose, times of day, dates, instructions, and who authorised it (required). Today's doses show as given, due, overdue (30+ minutes late) or missed (with a reason). A dose can be recorded once.
- **Immunisation:** vaccine, date, dose number, next due. A vaccine shows overdue when its next dose date passed and no later dose was recorded.
- **Today view:** severe allergies, overdue doses, frequent visitors (3+ in 30 days), incomplete records, overdue immunisations, the week's visits.
- Code: `healthLogic.js` (rules), `healthService.js` (storage), `features/health/health.js` (screens). Tests: `tests/health.test.mjs`, `tests/browser/health_check.py`.

## Health: limits (read before real use)
- **Demo mode does not enforce secrecy in storage.** Access is enforced in the screens and by write checks; the data sits in the same browser. Real confidentiality needs the backend phase (database-level access rules), and this module should not hold real children's records until then.
- The allergy and medicine matching is a safety net, not a pharmacist: it knows penicillin-family and sulfa-family names only. Always check with the parent or doctor.
- Teachers are not shown allergy alerts for their class (a deliberate choice for privacy). Many schools want teachers to see severe allergies for their own learners; that is a policy decision to make with the school before building it.
- The nurse role exists in demo mode only; the cloud team roles (SQL) would need the same addition.
- No report or export screen yet; no age-based immunisation schedule; no parent notification (needs the SMS provider).

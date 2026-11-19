# CBC competency tracking (demo mode)

Where: **Academics → Competencies** (administrators and teachers) and **My workspace → Assessment → Competencies (CBC)** (teachers).

## What it does
- **Outcomes bank:** learning outcomes belong to a curriculum and subject and apply to one or more classes (Grade 4 Maths differs from Grade 5). Paste them one per line as `Strand | Sub-strand | Outcome` (strand and sub-strand optional). Nothing is saved if any line has a problem; duplicates are caught. Archive instead of delete: ratings already given are kept. The official KICD designs are not bundled: paste from your own curriculum design or scheme of work.
- **Rate:** pick class, subject, term and an outcome; every learner has four tap buttons: **EE** Exceeding, **ME** Meeting, **AE** Approaching, **BE** Below expectation. Re-tapping the same level does nothing; a changed level becomes the current one and the earlier rating stays as history. A new term starts afresh.
- **By learner:** all of one learner's outcomes by subject, "reached X of Y" (Meeting or above), and a **printable CBC progress report**.
- **Class overview:** per outcome how many are at each level and who is not yet rated; the share at Meeting or above; **learners needing support** (rated below Meeting).
- **Coverage** (Professional and above): which outcomes were taught, planned or not covered, from lesson plans (teachers tick the outcomes a lesson covers in the lesson plan form), plus scheme-of-work weeks done.
- **Report card:** a "Competencies (CBC)" table (counts at each level and "reached X of Y" per subject) appears for any learner with ratings in the exam's term, so it follows the approval workflow: parents and learners see it only after the report is published.
- **Student profile:** a Competencies tab with the current term's summary.

## Rules
- Teachers rate (and add outcomes) only for classes and subjects they are allocated to; administrators any. Other roles cannot reach it.
- Ratings for a class and term **freeze when its report is submitted** (like marks) and unfreeze if it is returned or reopened.
- Packages: CBC competency tracking is in every package; Curriculum coverage reports from Professional.

## Limits
- Demo mode only; cloud (Supabase) tables and rules come with the backend phase.
- The rating scale is the standard four levels (labels fixed); a custom scale is supported by the rules but has no editing screen.
- No learner or parent hand-in; parents see competencies only through the published report card.
- No export of the class overview; no per-strand summary or long-term trend yet.
- Tests: `tests/cbc.test.mjs`, `tests/browser/cbc_check.py`.

# Phase Three report — completing the Bursar Pack

## Built (demo mode; cloud versions wait for the backend phase)
| Brief item | Where | Notes |
|---|---|---|
| Installment plans, partial payments | **Installment plans** tab | 2–12 equal whole-shilling parts that always add up; payments fill the oldest installment first; reminders follow the next unpaid installment |
| Scholarships, sponsorships | **Charges & discounts → Scholarships and sponsorships** | needs approval; approved awards auto-apply to the next invoice; sponsorship builds an "owed by sponsor" balance; sponsor payments are verify-first |
| Payment allocations | **Payments & receipts → "not yet applied"** | one payment can be split over several invoices; auto = oldest due first; leftovers stay as credit |
| Student fee statements | **Fee statements** tab | dated ledger with running balance, opening balance, print and CSV |
| Credit notes, adjustments | **Credit notes** tab | approval workflow with history; the invoice itself is never edited; cannot credit more than the invoice is worth |
| Refunds | existing | now record when they were paid out, so statements and the cashbook date them correctly |
| Bank statement import & reconciliation | **Reconciliation** | unknown lines go to a persistent **review queue**; the bursar assigns each to a learner (one confirmed payment + receipt, duplicate-proof by reference) or marks it "not a fee payment" with a reason |
| Cashbook, expenses | **Cashbook** tab | receipts in; refunds, expenses out; running balance; per-account totals (Cash / M-Pesa / Bank); date and account filters; print, CSV |
| Configurable payment rules | **SwiftIQ Pay → Payment rules** | overpayment allowed/not, installment limits |
| Dashboard | **Bursar dashboard** | expected, collected, outstanding, collection %, overdue, pending, unmatched payments (count and amount), pending refunds/credit notes, daily transactions, trend, by class, by term |
| Audit | **Financial audit** tab | every finance change with who/when; approvals also keep their own history |
| Navigation | Finance tabs split into two labelled rows ("Bursar Pack") |

## Tests actually run
* `node tests/run-all.mjs` — **9 files pass**. New: `bursar3.test.mjs` (26 rule checks incl. a 300-family randomized check that a statement's closing balance always equals billed − credits − paid + refunded) and `bursar3-service.test.mjs` (10 end-to-end workflows on stored records).
* Mutation check: breaking three rules made four tests fail.
* Browser (Chromium): every new screen clicked through — credit note request → approve, plan preview → create, statement, cashbook, statement import → review queue → assign (receipt created), award → approve, payment rules, audit view. All earlier browser flows re-run clean.
* **Bugs found and fixed by testing:** import results disappeared after the screen refreshed; Finance had 19 unlabelled tabs.

## Not done / not proven
* **Cloud mode:** the new tabs are hidden when Supabase is configured. Before they can be shown, the backend phase must: add the five new collections (`creditNotes, awards, sponsorPayments, installmentPlans, bankTransactions`) to the SQL role table; accept `credit_note` in `next_document_number`; make `bursar_refresh_invoice`, `bursar_confirm_payment`, `bursar_submit_payment` and `parent_portal()` count split payments (allocations) and approved credit notes; add unique indexes on payment/bank-transaction references; enforce approver roles server-side. Until then the parent portal in cloud mode ignores credit notes.
* **Live M-Pesa/bank feeds: not built.** The review queue and duplicate protection are ready for a feed, but today lines arrive only from a statement file the bursar uploads (treated as an authorized feed).
* Approval is by the school administrator or the role chosen in the sibling-discount policy; **requester ≠ approver is not enforced**.
* Not built: debit notes, late-fee/interest rules, sponsor invoices (a document to send the sponsor), one statement per family (it is per learner), bank-account balances / opening-balance entry, payment method on the Expenses form (cashbook assumes cash).
* Awards are worked out on the fee structure's items only (not optional charges or transport).

## Continue from here
Phase Four (Teacher Pack completion: unified workspace, report-card preparation, resources, announcements, timetable/deadlines) then Phase Five (academic engine and report cards). Backend phases remain last.

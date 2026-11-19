# Offline sync — contract for the backend phase

The phone side is built and tested (`js/offline/`). In demo mode the "server" is the browser's own school
data (`localTransport.js`). **For cloud mode a second transport must be written with the same behaviour.**
Until then the Mobile register / Mobile marks screens are hidden in cloud mode, so nothing queues into a
server that does not exist.

## What the phone sends — one operation per record change
```json
{ "opId": "uuid", "kind": "attendance | assessmentScore | examScore",
  "key": "attendance|<classId>|<date>|<studentId>",
  "payload": { "classId": "…", "date": "2026-03-02", "studentId": "…", "status": "absent", "by": "Teacher name" },
  "baseVersion": 3, "deviceId": "dev-ab12cd" }
```
`baseVersion` is the version of that record the phone last saw (0 = it did not exist). Edits to one record before
syncing are folded into a single op that **keeps the original baseVersion**.

## What `transport.push(op)` must return
| Result | Meaning | Phone then |
|---|---|---|
| `{status:'applied', version}` | stored | marks it Synchronized |
| `{status:'duplicate', version}` | this `opId` was already applied | marks it Synchronized (never applied twice) |
| `{status:'conflict', server:{version,value,by,at}}` | record changed since `baseVersion` | shows the conflict; person picks Keep mine / Use server's |
| `{status:'rejected', reason}` | permanently refused | shows Failed with the reason; no automatic retry |
| *throws* (network/5xx) | transient | keeps it Pending, retries with back-off (5s→15m, 8 tries) |

## What the server must enforce (never trust the phone)
1. **Idempotency:** a table `sync_operations(op_id primary key, school_id, applied_version, applied_at)`; the same
   `opId` returns `duplicate`. Insert it in the SAME transaction as the data write.
2. **Versions:** every attendance/score row has an integer `version`. Apply only if `baseVersion` equals the row's
   current version (or the stored value is already identical); otherwise return `conflict` — never overwrite.
3. **Natural-key uniqueness:** unique constraints on (school, class, date, student) for attendance and
   (school, assessment, student) / (school, examination, subject, student) for scores, so races cannot create duplicates.
4. **Authorization identical to row-level security:** the caller's school, their role's write permission on the
   collection, and — for teachers — that the class is assigned to them. Reject, don't hide.
5. **Locked results:** refuse mark changes for published results/report cards.
6. **Audit:** record opId, deviceId, user, old and new value for every applied change.
7. Suggested shape: one RPC `apply_sync_op(op jsonb) returns jsonb` that does 1–6 in a single transaction and returns
   the result object above. Test it with the same cases as `tests/offline.test.mjs` ("Local transport rules").

## Also needed for cloud mode
* `withSnapshot` already caches rosters/records on the device; point its loader at the cloud read API.
* Remove the `offlineAvailable()` demo-only gate in `js/offline/offlineService.js` once the cloud transport passes its tests.
* Run `node scripts/generate-precache.mjs` before every deploy (the offline app copy is versioned from file contents).

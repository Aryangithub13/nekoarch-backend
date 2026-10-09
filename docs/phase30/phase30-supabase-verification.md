# Phase 30 addendum — local Supabase stack verification

This addendum closes the gap recorded in [phase30-verification.md](phase30-verification.md) ("Local Supabase stack (`test:supabase`) — Not run"). The Phase 30 release documents, evidence and the tag `backend-v1-phase30-complete` → `401a470` are unchanged; this work is on branch `phase30/supabase-verification` from that tag.

## Isolation

The suite ran against a **disposable** Supabase stack, not the shared developer stack. Full record: [evidence/supabase/environment.txt](evidence/supabase/environment.txt).

| Item | Disposable stack | Shared developer stack |
|---|---|---|
| Project id | `designflow-p30-verify` | `designflow` |
| Ports | API 55321, DB 55322 | API 54321, DB 54322 |
| Source | `git archive` of the committed `supabase/` config, migrations and seed into a scratch directory; only `project_id`/ports changed, optional services disabled | — |
| Migrations | 0001–0020 applied from empty by `supabase start` (sha256 identical to the committed files) | Still 0001–0019; no Phase 30 tables; containers unchanged |
| PostgREST | v16.2 replaced by v16.3 on the disposable REST container only (same repair as `scripts/ensure-local-postgrest.mjs`, names changed) | Untouched |

Selection uses `SUPABASE_WORKDIR=<scratch> npm run test:supabase`. The repository runner is unchanged and still refuses non-local URLs. Database: `supabase/postgres:17.6.1.167`; Auth `gotrue:v2.196.0`; CLI 2.117.0.

## New coverage

| File | Content |
|---|---|
| `test-support/revision-acceptance.ts` (new) | Four HTTP scenarios through actual Auth JWTs, PostgREST and the signed SQL functions: the primary flow (A → preflight → consent mismatch → execute → Khronos-valid, byte-identical-geometry candidate → comparison → wrong-candidate refusal → approve B → re-approve refused → restore as C); lock/geometry/interior/glazing refusals; reject, cancel, stale-base and simultaneous approvals (exactly one 201); idempotent replay plus 404 for another user and 401 anonymous on 9 routes |
| `apps/api/tests/supabase.live.test.ts` | Wires the suite in; adds a direct-SDK test (owner sees, other user gets `[]`, anon `42501` on operations, events and candidate artifacts; candidate blob select, operation update, appearance insert, unsigned `revision_operation_write` and `revision_operation_purge` → `42501`; foreign `revision_operation_read` refused; state unchanged); cleanup now protects projects that hold Phase 30 history |

## Results

| Gate | Result |
|---|---|
| `npm run test:supabase` (disposable stack, run 1) | 120 / 120, exit 0 |
| `npm run test:supabase` (same stack, run 2, recorded) | **120 / 120, exit 0** ([log](evidence/supabase/live-run.txt)), including all 5 Phase 30 tests |
| Request observer | 3 497 requests; 16 flagged, all intentional anonymous `401/42501` denials asserted by the tests (3 of them on Phase 30 tables); 0 server errors; no tokens recorded ([observer JSON](evidence/supabase/)) |
| `npm run check` after the change | exit 0: 77 files / 2 626 tests + 133 + 52 ([log](evidence/supabase/check.txt)) |

The run-1 observer file was written to the default `docs/phase16-evidence/` directory. It was moved out unmodified so Phase 16 evidence stays as released, and run 2 records into `docs/phase30/evidence/supabase/`.

## Still open

- Frontend adapter verification: blocked; the frontend repository is not on this machine.

To tear down the disposable stack: `npx supabase stop --no-backup --workdir <scratch>/p30-supabase` (it only addresses `designflow-p30-verify`).

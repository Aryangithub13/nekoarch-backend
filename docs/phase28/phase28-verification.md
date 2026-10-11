# Phase 28 verification record

Final release run: **run 2**, executed by `docs/phase28/verify-phase28.py` on 2026-10-08 in the Phase 28 worktree (branch `phase28/optimization-v1`).
Machine-readable record: `docs/phase28/evidence/final/verification.json`; per-gate logs in `docs/phase28/evidence/final/`.
This file is generated from that record.

## Frozen source

- Tested-source SHA-256 manifest digest: `16c02eb674a7e133c0715b5e7bb3a14b1951b355fbd91dc574e3865ad3d103d0` (442 files; per-file hashes in `evidence/final/tested-source-sha256.json`).
- The manifest and the protected directories (`docs/backend-repair-1-23/`, `docs/phase24/evidence/final/phase23/fixtures/`, `docs/phase26/evidence/`,
  `docs/phase27/evidence/`) were re-hashed before and after every gate. All 62 gates report `sourceUnchanged: true` and
  `untouchedDirectoriesUnchanged: true`; one manifest digest was observed for the whole run.
- Historical artifacts (migrations 0001–0017, `docs/phase23-evidence`, `docs/phase24`, `docs/phase24-audit-repair`, `docs/phase25`, `docs/phase26`,
  `docs/phase27`, `docs/backend-repair-1-23`) are byte-identical to `backend-v1-phase27-complete` (`90e5124`); the only new migration is 0018.
- The manifest was recomputed again after the run and before these docs were written: 0 files drifted.
- Total gate wall time: 2268 s.

## Result: 62 / 62 gates exit 0, no waived failure, no skip

| # | Gate | Exit | s | Measured evidence |
|---|------|------|---|-------------------|
| 1 | `git rev-parse 'backend-v1-phase24-complete^{commit}'` | 0 | 0.059 | `phase24-tag.txt` |
| 2 | `git rev-parse 'backend-v1-phase25-complete^{commit}'` | 0 | 0.068 | `phase25-tag.txt` |
| 3 | `git rev-parse 'backend-v1-phase26-complete^{commit}'` | 0 | 0.106 | `phase26-tag.txt` |
| 4 | `git rev-parse 'backend-v1-phase27-complete^{commit}'` | 0 | 0.078 | `phase27-tag.txt` |
| 5 | `git merge-base --is-ancestor 90e5124b78f966de70871802ae8ec8dc0ee99786 HEAD` | 0 | 0.074 | `phase27-baseline-ancestor.txt` |
| 6 | `node --import tsx docs/phase24-audit-repair/reproduce-audit.mts` | 0 | 1.139 | `phase24-audit-reproductions.txt` |
| 7 | `python3 scripts/test-phase23-runner.py` | 0 | 0.317 | `runner-controls.txt` |
| 8 | `npm run build` | 0 | 25.443 | `build.txt` |
| 9 | `npm run typecheck` | 0 | 32.031 | `typecheck.txt` |
| 10 | `npm run lint` | 0 | 6.662 | `lint.txt` |
| 11 | `npm run test:unit` | 0 | 104.466 | 2222 passed |
| 12 | `npm run test:generator` | 0 | 28.683 | 526 passed |
| 13 | `npm run test:blueprint` | 0 | 14.694 | 137 passed |
| 14 | `npm run test:blueprint-qa` | 0 | 29.038 | 198 passed |
| 15 | `npm run test:solver-v2` | 0 | 43.719 | 40 passed |
| 16 | `npm run test:parametric` | 0 | 35.646 | 36 passed |
| 17 | `npm run test:projects` | 0 | 36.047 | 23 passed |
| 18 | `npm run test:takeoff` | 0 | 31.172 | 23 passed |
| 19 | `npm run test:construction` | 0 | 23.241 | 34 passed |
| 20 | `npm run test:cost` | 0 | 26.499 | 39 passed |
| 21 | `npm run test:workflows` | 0 | 26.65 | 51 passed |
| 22 | `npm run test:interpretation` | 0 | 23.095 | 133 passed |
| 23 | `npm run test:conversations` | 0 | 25.095 | 52 passed |
| 24 | `npm run test:ai-orchestration` | 0 | 24.648 | 120 passed |
| 25 | `npm run test:integration` | 0 | 170.636 | 253 passed |
| 26 | `npm run test:bim` | 0 | 44.621 | 41 passed |
| 27 | `npm run test:structural` | 0 | 43.317 | 129 passed |
| 28 | `npm run test:environmental` | 0 | 38.845 | 112 passed |
| 29 | `npm run test:systems` | 0 | 37.523 | 47 passed |
| 30 | `npm run test:knowledge` | 0 | 43.533 | 34 passed |
| 31 | `npm run test:optimization` | 0 | 44.592 | 86 passed |
| 32 | `npm run test:supabase` | 0 | 117.596 | 110 passed |
| 33 | `npm run db:test` | 0 | 2.093 | 86/86 pgTAP (`rls.sql`) |
| 34 | `npm run check` | 0 | 323.804 | 2517 passed + 133 passed + 52 passed |
| 35 | `npm run benchmark:optimization` | 0 | 116.555 | `benchmark-optimization.txt` |
| 36 | `python3 docs/phase28/mutation-test.py` | 0 | 665.294 | 37/37 killed for intended reason, all restored, controls clean |
| 37 | `node --import tsx --input-type=module -e 'process.chdir("/tmp/designflow-phase28-verificati…` | 0 | 2.246 | `phase23-bim-fixtures.txt` |
| 38 | `/tmp/designflow-phase23-ifc/bin/python /home/aryan/Documents/Codex/2026-09-12/bu/outputs/de…` | 0 | 59.429 | 7 fixtures, 0 schema diagnostics |
| 39 | `/tmp/designflow-phase23-ifc/bin/python /home/aryan/Documents/Codex/2026-09-12/bu/outputs/de…` | 0 | 0.693 | `ifc-profiles.txt` |
| 40 | `python3 docs/phase28/verify-phase28.py --architecture /tmp/designflow-phase28-verification-…` | 0 | 0.188 | 7/7 IFC byte-identical, model+BIM equal |
| 41 | `sh -c 'git diff --exit-code 90e5124b78f966de70871802ae8ec8dc0ee99786 -- supabase/migrations…` | 0 | 0.06 | `historical-artifacts-unchanged.txt` |
| 42 | `sh -c '! grep -rnE "from '"'"'\.\./(ai|workflows)/" apps/api/src/structural apps/api/src/se…` | 0 | 0.031 | `ai-boundary.txt` |
| 43 | `sh -c '! grep -rnE "node:(http|https|net|dgram|child_process|fs|worker_threads)|fetch\(|XML…` | 0 | 0.028 | `environmental-offline-no-io.txt` |
| 44 | `sh -c '! grep -rnE "node:(http|https|net|dgram|child_process|fs|worker_threads)|fetch\(|XML…` | 0 | 0.033 | `systems-offline-no-io-no-clock.txt` |
| 45 | `sh -c '! grep -nE "from '"'"'\./(model|solar|shading|analysis)\.js'"'"'" apps/api/src/envir…` | 0 | 0.03 | `validator-independence.txt` |
| 46 | `sh -c '! grep -nE "from '"'"'\./(model|routing|egress|vertical|clash|analysis|units)\.js'"'…` | 0 | 0.029 | `systems-validator-independence.txt` |
| 47 | `sh -c '! grep -rnE "node:(http|https|net|dgram|child_process|fs|worker_threads)|fetch\(|XML…` | 0 | 0.034 | `knowledge-offline-no-io-no-clock.txt` |
| 48 | `node docs/phase27/validator-independence.mjs` | 0 | 0.091 | `knowledge-validator-independence.txt` |
| 49 | `sh -c '! grep -rnE "node:(http|https|net|dgram|child_process|fs)|fetch\(|XMLHttpRequest|pro…` | 0 | 0.034 | `optimization-offline-no-io-no-clock.txt` |
| 50 | `sh -c '! grep -nE "from '"'"'\./(domain|candidate|rank|study|pool|worker)\.js'"'"'" apps/ap…` | 0 | 0.03 | `optimization-validator-independence.txt` |
| 51 | `docker build -t designflow-api:phase28 .` | 0 | 1.993 | `docker-build.txt` |
| 52 | `node scripts/smoke-container.mjs designflow-api:phase28` | 0 | 2.8 | `docker-smoke.txt` |
| 53 | `docker run --rm --network none --entrypoint sh designflow-api:phase28 -c 'test "$(id -u)" !…` | 0 | 0.691 | `docker-runtime-contents.txt` |
| 54 | `docker run --rm -i --network none designflow-api:phase28 node --input-type=module < docs/ph…` | 0 | 1.693 | `docker-phase23-acceptance.txt` |
| 55 | `docker run --rm -i --network none designflow-api:phase28 node --input-type=module < docs/ph…` | 0 | 1.191 | `docker-phase24-acceptance.txt` |
| 56 | `docker run --rm -i --network none designflow-api:phase28 node --input-type=module < docs/ph…` | 0 | 1.041 | `docker-phase25-acceptance.txt` |
| 57 | `docker run --rm -i --network none designflow-api:phase28 node --input-type=module < docs/ph…` | 0 | 1.393 | `docker-phase26-acceptance.txt` |
| 58 | `docker run --rm -i --network none designflow-api:phase28 node --input-type=module < docs/ph…` | 0 | 1.192 | `docker-phase27-acceptance.txt` |
| 59 | `docker run --rm -i --network none designflow-api:phase28 node --input-type=module < docs/ph…` | 0 | 1.693 | compiled dist worker: PASS, 5 candidates, claims all 11 NOT_CLAIMED |
| 60 | `python3 docs/phase28/snapshot-local-db.py database-after-verification` | 0 | 4.051 | `database-snapshot.txt` |
| 61 | `python3 docs/phase28/verify-phase28.py --preserved` | 0 | 0.091 | 0 pre-existing rows missing; RLS everywhere; policies unchanged; only 0018 added |
| 62 | `git diff --check` | 0 | 0.042 | `diff-check.txt` |

Live Supabase receipt: `evidence/final/supabase-receipts/supabase-2026-10-08T12-20-34.514Z.json`. Gate 7 (`runner-controls`) proves the harness itself fails on a failed gate,
on source drift and on a missing executable.

## Superseded runs (archived, never promoted)

| Run | Archive | Outcome | Cause | Action |
|---|---|---|---|---|
| 1 | `evidence/failed-runs/release-run1-passed-evidence-overwritten-by-operator/` | 62/62 exit 0 on the same manifest `16c02eb6…` (full record in `harness-stdout-62-gates.log`) | after it finished, the operator ran `verify-phase28.py --help`; the harness does not parse `--help`, so a new run rewrote `verification.json` and the gate 1–6 logs before dying on SIGPIPE at gate 7 | evidence set mixed two invocations, so it was archived unpromoted; no source, DB or other evidence changed; run 2 executed from scratch on the unchanged freeze |

## Environment notes

- The IfcOpenShell venv `/tmp/designflow-phase23-ifc` had been cleared from `/tmp` twice during Phase 28 work and was recreated as documented in
  `docs/phase23-api.md` from the pinned `scripts/requirements-ifc.txt` (ifcopenshell 0.8.5).
- In this worktree `@embedded-postgres/linux-x64` had not run its `postinstall` (`libpq.so.5` symlinks missing, init exit 127);
  `node scripts/hydrate-symlinks.js` was run in that package once. No source change.
- Migration 0018 was applied to the local Supabase stack with `supabase migration up --local` after `evidence/database-before.json` was captured
  (`evidence/database-after-migration.json`: 0 rows missing, existing policies unchanged).
- A pre-release live-acceptance receipt was moved to `evidence/preliminary/supabase-receipts/`.

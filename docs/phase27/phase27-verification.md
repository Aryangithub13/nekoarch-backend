# Phase 27 verification record

Final release run: **run 3**, executed by `docs/phase27/verify-phase27.py` on 2026-10-08.
Machine-readable record: `docs/phase27/evidence/final/verification.json`; per-gate logs in `docs/phase27/evidence/final/`.

## Frozen source

- Tested-source SHA-256 manifest digest: `638c25948f6c5ca9003bb66b437bdb2fc23cd73840c77b33d21caecde852e792` (419 files; per-file hashes in `evidence/final/tested-source-sha256.json`).
- The manifest and the protected historical set (migrations 0001–0016, `docs/phase23-evidence`, `docs/phase24`, `docs/phase24-audit-repair`,
  `docs/phase25`, `docs/phase26`, `docs/backend-repair-1-23`) were re-hashed before and after every gate. All 57 gates report
  `sourceUnchanged: true` and `untouchedDirectoriesUnchanged: true`; one manifest digest was observed for the whole run.
- The manifest was recomputed again after the run and before these docs were written: 0 files drifted.
- Total gate wall time: 1839 s.

## Result: 57 / 57 gates exit 0, no waived failure, no skip

| # | Gate | Exit | s | Measured evidence |
|---|------|------|---|-------------------|
| 1 | `git rev-parse 'backend-v1-phase24-complete^{commit}'` | 0 | 0.025 | `phase24-tag.txt` |
| 2 | `git rev-parse 'backend-v1-phase25-complete^{commit}'` | 0 | 0.026 | `phase25-tag.txt` |
| 3 | `git rev-parse 'backend-v1-phase26-complete^{commit}'` | 0 | 0.025 | `phase26-tag.txt` |
| 4 | `git merge-base --is-ancestor 4d1f431b4eabcf7fdd3b9f88c3c4a5cdc3f3c7e7 HEAD` | 0 | 0.024 | `phase26-baseline-ancestor.txt` |
| 5 | `node --import tsx docs/phase24-audit-repair/reproduce-audit.mts` | 0 | 0.386 | `phase24-audit-reproductions.txt` |
| 6 | `python3 scripts/test-phase23-runner.py` | 0 | 0.136 | `runner-controls.txt` |
| 7 | `npm run build` | 0 | 16.821 | `build.txt` |
| 8 | `npm run typecheck` | 0 | 23.082 | `typecheck.txt` |
| 9 | `npm run lint` | 0 | 4.947 | `lint.txt` |
| 10 | `npm run test:unit` | 0 | 58.909 | 2151 passed |
| 11 | `npm run test:generator` | 0 | 16.168 | 526 passed |
| 12 | `npm run test:blueprint` | 0 | 7.451 | 137 passed |
| 13 | `npm run test:blueprint-qa` | 0 | 13.815 | 198 passed |
| 14 | `npm run test:solver-v2` | 0 | 29.447 | 40 passed |
| 15 | `npm run test:parametric` | 0 | 22.584 | 36 passed |
| 16 | `npm run test:projects` | 0 | 22.333 | 23 passed |
| 17 | `npm run test:takeoff` | 0 | 24.086 | 23 passed |
| 18 | `npm run test:construction` | 0 | 22.183 | 34 passed |
| 19 | `npm run test:cost` | 0 | 24.887 | 39 passed |
| 20 | `npm run test:workflows` | 0 | 25.289 | 51 passed |
| 21 | `npm run test:interpretation` | 0 | 20.778 | 133 passed |
| 22 | `npm run test:conversations` | 0 | 22.985 | 52 passed |
| 23 | `npm run test:ai-orchestration` | 0 | 22.933 | 120 passed |
| 24 | `npm run test:integration` | 0 | 119.135 | 238 passed |
| 25 | `npm run test:bim` | 0 | 30.449 | 41 passed |
| 26 | `npm run test:structural` | 0 | 28.797 | 129 passed |
| 27 | `npm run test:environmental` | 0 | 33.856 | 112 passed |
| 28 | `npm run test:systems` | 0 | 36.564 | 47 passed |
| 29 | `npm run test:knowledge` | 0 | 42.377 | 34 passed |
| 30 | `npm run test:supabase` | 0 | 106.61 | 104 passed |
| 31 | `npm run db:test` | 0 | 3.093 | 79/79 pgTAP (`rls.sql`) |
| 32 | `npm run check` | 0 | 261.33 | 2431 passed + 133 passed + 52 passed |
| 33 | `npm run benchmark:knowledge` | 0 | 21.231 | `benchmark-knowledge.txt` |
| 34 | `python3 docs/phase27/mutation-test.py` | 0 | 627.448 | 37/37 killed for intended reason, all restored, controls clean |
| 35 | `node --import tsx --input-type=module -e 'process.chdir("/tmp/designflow-phase27-verificat…` | 0 | 2.242 | `phase23-bim-fixtures.txt` |
| 36 | `/tmp/designflow-phase23-ifc/bin/python /home/aryan/Documents/Codex/2026-09-12/bu/outputs/d…` | 0 | 59.561 | 7 fixtures, 0 schema diagnostics |
| 37 | `/tmp/designflow-phase23-ifc/bin/python /home/aryan/Documents/Codex/2026-09-12/bu/outputs/d…` | 0 | 0.688 | `ifc-profiles.txt` |
| 38 | `python3 docs/phase27/verify-phase27.py --architecture /tmp/designflow-phase27-verification…` | 0 | 0.189 | 7/7 IFC byte-identical, model+BIM equal |
| 39 | `sh -c 'git diff --exit-code 4d1f431b4eabcf7fdd3b9f88c3c4a5cdc3f3c7e7 -- supabase/migration…` | 0 | 0.032 | `historical-artifacts-unchanged.txt` |
| 40 | `sh -c '! grep -rnE "from '"'"'\.\./(ai|workflows)/" apps/api/src/structural apps/api/src/s…` | 0 | 0.026 | `ai-boundary.txt` |
| 41 | `sh -c '! grep -rnE "node:(http|https|net|dgram|child_process|fs|worker_threads)|fetch\(|XM…` | 0 | 0.026 | `environmental-offline-no-io.txt` |
| 42 | `sh -c '! grep -rnE "node:(http|https|net|dgram|child_process|fs|worker_threads)|fetch\(|XM…` | 0 | 0.028 | `systems-offline-no-io-no-clock.txt` |
| 43 | `sh -c '! grep -nE "from '"'"'\./(model|solar|shading|analysis)\.js'"'"'" apps/api/src/envi…` | 0 | 0.026 | `validator-independence.txt` |
| 44 | `sh -c '! grep -nE "from '"'"'\./(model|routing|egress|vertical|clash|analysis|units)\.js'"…` | 0 | 0.028 | `systems-validator-independence.txt` |
| 45 | `sh -c '! grep -rnE "node:(http|https|net|dgram|child_process|fs|worker_threads)|fetch\(|XM…` | 0 | 0.026 | `knowledge-offline-no-io-no-clock.txt` |
| 46 | `node docs/phase27/validator-independence.mjs` | 0 | 0.087 | `knowledge-validator-independence.txt` |
| 47 | `docker build -t designflow-api:phase27 .` | 0 | 76.443 | `docker-build.txt` |
| 48 | `node scripts/smoke-container.mjs designflow-api:phase27` | 0 | 1.491 | `docker-smoke.txt` |
| 49 | `docker run --rm --network none --entrypoint sh designflow-api:phase27 -c 'test "$(id -u)" …` | 0 | 0.338 | `docker-runtime-contents.txt` |
| 50 | `docker run --rm -i --network none designflow-api:phase27 node --input-type=module < docs/p…` | 0 | 0.989 | `docker-phase23-acceptance.txt` |
| 51 | `docker run --rm -i --network none designflow-api:phase27 node --input-type=module < docs/p…` | 0 | 0.638 | `docker-phase24-acceptance.txt` |
| 52 | `docker run --rm -i --network none designflow-api:phase27 node --input-type=module < docs/p…` | 0 | 0.638 | `docker-phase25-acceptance.txt` |
| 53 | `docker run --rm -i --network none designflow-api:phase27 node --input-type=module < docs/p…` | 0 | 0.79 | `docker-phase26-acceptance.txt` |
| 54 | `docker run --rm -i --network none designflow-api:phase27 node --input-type=module < docs/p…` | 0 | 0.84 | `docker-phase27-acceptance.txt` |
| 55 | `python3 docs/phase27/snapshot-local-db.py database-after-verification` | 0 | 3.594 | `database-snapshot.txt` |
| 56 | `python3 docs/phase27/verify-phase27.py --preserved` | 0 | 0.087 | 0 pre-existing rows missing; RLS everywhere; policies unchanged; only 0017 added |
| 57 | `git diff --check` | 0 | 0.032 | `diff-check.txt` |

## Superseded runs (archived, never promoted)

| Run | Archive | Outcome | Root cause | Fix |
|---|---|---|---|---|
| 1 | `evidence/failed-runs/release-run1-route-telemetry-fk-list-rate-date/` | 53/57; `test:unit`, `test:integration`, `check` failed (4 tests) | (a) `/knowledge` route templates missing from `lib/sentry.ts` telemetry registry; (b) stale FK expectation: 0017 legitimately adds 5 FKs (34 → 39); (c) pre-existing Phase 5/7 test clock mix: fixtures inserted Postgres `current_date` (DB-local IST) while rate selection uses the UTC date, so between 00:00 and 05:30 IST the new version was "future" | (a) templates added; (b) count 39 **plus** exact pinned list of the five 0017 FKs; (c) explicit fixture date `2026-09-02` (newer than the 2026-09-01 seed, effective on every clock). Production rule unchanged; the future-version rule stays proven with an injected clock (`estimate-service.test.ts`). (c) reproduced deterministically by simulating DB date = UTC + 1 before fixing. |
| 2 | `evidence/failed-runs/release-run2-stopped-test-systems-script-scope/` | stopped by the operator at gate 8 (no failure) | review found an unrecorded change: Phase 27 had appended `knowledge.integration.test.ts` to the historical `test:systems` script | `test:systems` restored byte-identical to `backend-v1-phase26-complete`; the knowledge integration test stays covered by `test:knowledge` and `test:integration`; new freeze, full run 3 |

## Environment notes

- The IfcOpenShell venv `/tmp/designflow-phase23-ifc` was missing (tmp cleared) and was recreated exactly as documented in `docs/phase23-api.md`
  from the pinned `scripts/requirements-ifc.txt` (ifcopenshell 0.8.5, pytest 8.4.2).
- A live-acceptance receipt produced by the pre-release Phase 27 run (`supabase-2026-10-07T18-43-03.203Z.json`) was moved from
  `docs/phase16-evidence/` to `docs/phase27/evidence/preliminary/supabase-receipts/`; run 3's own receipt is in `evidence/final/supabase-receipts/`.

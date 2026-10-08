# Phase 29 verification record

Final release run: **run 1**, executed by `docs/phase29/verify-phase29.py` on 2026-10-08 in the Phase 29 worktree (branch `phase29/advanced-3d-scene-engine`).
Machine-readable record: `docs/phase29/evidence/final/verification.json`; per-gate logs in `docs/phase29/evidence/final/`.
This file is generated from that record.

## Frozen source

- Tested-source SHA-256 manifest digest: `3d4aad29b117577ff7e652d9fa19a98f38e3b8cdabb0e50dbc1d4744ee431381` (468 files; per-file hashes in `evidence/final/tested-source-sha256.json`).
- The manifest and the protected directories (`docs/backend-repair-1-23/`, `docs/phase24/evidence/final/phase23/fixtures/`, `docs/phase26/evidence/`,
  `docs/phase27/evidence/`, `docs/phase28/evidence/`) were re-hashed before and after every gate. All 70 gates report `sourceUnchanged: true` and
  `untouchedDirectoriesUnchanged: true`; one manifest digest was observed for the whole run.
- Historical artifacts (migrations 0001–0018, `docs/phase23-evidence`, `docs/phase24`, `docs/phase24-audit-repair`, `docs/phase25`, `docs/phase26`,
  `docs/phase27`, `docs/phase28`, `docs/backend-repair-1-23`) are byte-identical to `backend-v1-phase28-complete` (`7ca99df`); the only new migration is 0019.
- The manifest was recomputed again after the run and before these docs were written: 0 files drifted.
- The harness refuses unknown arguments (including `--help`) and refuses to start while `evidence/final` exists, so no attempt can be mixed or overwritten.
- Total gate wall time: 1977 s.

## Result: 70 / 70 gates exit 0, no waived failure, no skip

| # | Gate | Exit | s | Measured evidence |
|---|------|------|---|-------------------|
| 1 | `git rev-parse 'backend-v1-phase24-complete^{commit}'` | 0 | 0.034 | `phase24-tag.txt` |
| 2 | `git rev-parse 'backend-v1-phase25-complete^{commit}'` | 0 | 0.064 | `phase25-tag.txt` |
| 3 | `git rev-parse 'backend-v1-phase26-complete^{commit}'` | 0 | 0.039 | `phase26-tag.txt` |
| 4 | `git rev-parse 'backend-v1-phase27-complete^{commit}'` | 0 | 0.034 | `phase27-tag.txt` |
| 5 | `git rev-parse 'backend-v1-phase28-complete^{commit}'` | 0 | 0.032 | `phase28-tag.txt` |
| 6 | `git merge-base --is-ancestor 7ca99df6531cdda136e03a4236d68b6da2f5e0c6 HEAD` | 0 | 0.033 | `phase28-baseline-ancestor.txt` |
| 7 | `node --import tsx docs/phase24-audit-repair/reproduce-audit.mts` | 0 | 0.546 | `phase24-audit-reproductions.txt` |
| 8 | `python3 scripts/test-phase23-runner.py` | 0 | 0.194 | `runner-controls.txt` |
| 9 | `npm run build` | 0 | 39.139 | `build.txt` |
| 10 | `npm run typecheck` | 0 | 59.027 | `typecheck.txt` |
| 11 | `npm run lint` | 0 | 7.558 | `lint.txt` |
| 12 | `npm run test:unit` | 0 | 219.603 | 2250 passed |
| 13 | `npm run test:generator` | 0 | 44.41 | 526 passed |
| 14 | `npm run test:blueprint` | 0 | 9.863 | 137 passed |
| 15 | `npm run test:blueprint-qa` | 0 | 17.231 | 198 passed |
| 16 | `npm run test:solver-v2` | 0 | 35.016 | 40 passed |
| 17 | `npm run test:parametric` | 0 | 26.403 | 36 passed |
| 18 | `npm run test:projects` | 0 | 25.191 | 23 passed |
| 19 | `npm run test:takeoff` | 0 | 30.312 | 23 passed |
| 20 | `npm run test:construction` | 0 | 24.746 | 34 passed |
| 21 | `npm run test:cost` | 0 | 27.4 | 39 passed |
| 22 | `npm run test:workflows` | 0 | 28.405 | 51 passed |
| 23 | `npm run test:interpretation` | 0 | 24.543 | 133 passed |
| 24 | `npm run test:conversations` | 0 | 25.899 | 52 passed |
| 25 | `npm run test:ai-orchestration` | 0 | 25.647 | 120 passed |
| 26 | `npm run test:integration` | 0 | 156.891 | 264 passed |
| 27 | `npm run test:bim` | 0 | 37.986 | 41 passed |
| 28 | `npm run test:structural` | 0 | 33.313 | 129 passed |
| 29 | `npm run test:environmental` | 0 | 37.726 | 112 passed |
| 30 | `npm run test:systems` | 0 | 40.88 | 47 passed |
| 31 | `npm run test:knowledge` | 0 | 50.156 | 34 passed |
| 32 | `npm run test:optimization` | 0 | 47.348 | 86 passed |
| 33 | `npm run test:scene3d` | 0 | 39.877 | 39 passed |
| 34 | `npm run test:supabase` | 0 | 127.968 | 115 passed |
| 35 | `npm run db:test` | 0 | 2.796 | 96/96 pgTAP (`rls.sql`) |
| 36 | `npm run check` | 0 | 333.927 | 2556 passed + 133 passed + 52 passed |
| 37 | `npm run benchmark:scene` | 0 | 28.257 | `benchmark-scene.txt` |
| 38 | `python3 -B docs/phase29/mutation-test.py` | 0 | 285.384 | 31/31 killed for intended reason, all restored, controls clean |
| 39 | `node --import tsx --input-type=module -e 'process.chdir("/tmp/designflow-phase29-verificati…` | 0 | 2.348 | `phase23-bim-fixtures.txt` |
| 40 | `/tmp/designflow-phase23-ifc/bin/python /home/aryan/Documents/Codex/2026-09-12/bu/outputs/de…` | 0 | 61.131 | 7 fixtures, 0 schema diagnostics |
| 41 | `/tmp/designflow-phase23-ifc/bin/python /home/aryan/Documents/Codex/2026-09-12/bu/outputs/de…` | 0 | 0.744 | `ifc-profiles.txt` |
| 42 | `python3 -B docs/phase29/verify-phase29.py --architecture /tmp/designflow-phase29-verificati…` | 0 | 0.196 | 7/7 IFC byte-identical, model+BIM equal |
| 43 | `sh -c 'git diff --exit-code 7ca99df6531cdda136e03a4236d68b6da2f5e0c6 -- supabase/migrations…` | 0 | 0.046 | `historical-artifacts-unchanged.txt` |
| 44 | `sh -c '! grep -rnE "from '"'"'\.\./(ai|workflows)/" apps/api/src/structural apps/api/src/se…` | 0 | 0.035 | `ai-boundary.txt` |
| 45 | `sh -c '! grep -rnE "node:(http|https|net|dgram|child_process|fs|worker_threads)|fetch\(|XML…` | 0 | 0.036 | `environmental-offline-no-io.txt` |
| 46 | `sh -c '! grep -rnE "node:(http|https|net|dgram|child_process|fs|worker_threads)|fetch\(|XML…` | 0 | 0.032 | `systems-offline-no-io-no-clock.txt` |
| 47 | `sh -c '! grep -nE "from '"'"'\./(model|solar|shading|analysis)\.js'"'"'" apps/api/src/envir…` | 0 | 0.035 | `validator-independence.txt` |
| 48 | `sh -c '! grep -nE "from '"'"'\./(model|routing|egress|vertical|clash|analysis|units)\.js'"'…` | 0 | 0.036 | `systems-validator-independence.txt` |
| 49 | `sh -c '! grep -rnE "node:(http|https|net|dgram|child_process|fs|worker_threads)|fetch\(|XML…` | 0 | 0.036 | `knowledge-offline-no-io-no-clock.txt` |
| 50 | `node docs/phase27/validator-independence.mjs` | 0 | 0.092 | `knowledge-validator-independence.txt` |
| 51 | `sh -c '! grep -rnE "node:(http|https|net|dgram|child_process|fs)|fetch\(|XMLHttpRequest|pro…` | 0 | 0.036 | `optimization-offline-no-io-no-clock.txt` |
| 52 | `sh -c '! grep -nE "from '"'"'\./(domain|candidate|rank|study|pool|worker)\.js'"'"'" apps/ap…` | 0 | 0.034 | `optimization-validator-independence.txt` |
| 53 | `sh -c '! grep -rnE "node:(http|https|net|dgram|child_process|fs)|fetch\(|XMLHttpRequest|pro…` | 0 | 0.036 | `scene-offline-no-io-no-clock.txt` |
| 54 | `sh -c '! grep -nE "from '"'"'\./(compile|mesh|gltf|job|pool|worker)\.js'"'"'" apps/api/src/…` | 0 | 0.032 | `scene-validator-independence.txt` |
| 55 | `docker build -t designflow-api:phase29 .` | 0 | 1.752 | `docker-build.txt` |
| 56 | `node scripts/smoke-container.mjs designflow-api:phase29` | 0 | 2.751 | `docker-smoke.txt` |
| 57 | `docker run --rm --network none --entrypoint sh designflow-api:phase29 -c 'test "$(id -u)" !…` | 0 | 0.995 | `docker-runtime-contents.txt` |
| 58 | `docker run --rm -i --network none designflow-api:phase29 node --input-type=module < docs/ph…` | 0 | 1.295 | `docker-phase23-acceptance.txt` |
| 59 | `docker run --rm -i --network none designflow-api:phase29 node --input-type=module < docs/ph…` | 0 | 0.943 | `docker-phase24-acceptance.txt` |
| 60 | `docker run --rm -i --network none designflow-api:phase29 node --input-type=module < docs/ph…` | 0 | 0.693 | `docker-phase25-acceptance.txt` |
| 61 | `docker run --rm -i --network none designflow-api:phase29 node --input-type=module < docs/ph…` | 0 | 0.848 | `docker-phase26-acceptance.txt` |
| 62 | `docker run --rm -i --network none designflow-api:phase29 node --input-type=module < docs/ph…` | 0 | 0.897 | `docker-phase27-acceptance.txt` |
| 63 | `docker run --rm -i --network none designflow-api:phase29 node --input-type=module < docs/ph…` | 0 | 1.447 | `docker-phase28-acceptance.txt` |
| 64 | `docker run --rm -i --network none designflow-api:phase29 node --input-type=module < docs/ph…` | 0 | 1.043 | compiled dist scene worker: PASS, 48 objects, validation VALID, GLB sha256 `6e8a27b01c02…` (Node v22.23.3) |
| 65 | `node docs/phase29/render-previews.mjs docs/phase29/evidence/fixtures/setback.glb docs/phase…` | 0 | 0.744 | 7 PNG previews, 2246 triangles (independent @gltf-transform reader) |
| 66 | `node docs/phase29/render-previews.mjs docs/phase29/evidence/fixtures/L.glb docs/phase29/evi…` | 0 | 0.292 | 3 PNG previews, 992 triangles (independent @gltf-transform reader) |
| 67 | `node docs/phase29/render-previews.mjs docs/phase29/evidence/fixtures/maximum.glb docs/phase…` | 0 | 0.343 | 3 PNG previews, 4272 triangles (independent @gltf-transform reader) |
| 68 | `python3 -B docs/phase29/snapshot-local-db.py database-after-verification` | 0 | 4.505 | `database-snapshot.txt` |
| 69 | `python3 -B docs/phase29/verify-phase29.py --preserved` | 0 | 0.093 | 0 pre-existing rows missing; RLS everywhere; policies unchanged; only 0018 added |
| 70 | `git diff --check` | 0 | 0.036 | `diff-check.txt` |

Live Supabase receipt: `evidence/final/supabase-receipts/supabase-2026-10-08T17-41-57.647Z.json`. Gate 8 (`runner-controls`) proves the harness itself fails on a failed gate,
on source drift and on a missing executable.

## Superseded runs

None. Run 1 is the first and only frozen-source release run. Pre-freeze findings (two mutation survivors, validator and precision fixes) are recorded in
[phase29-report.md](phase29-report.md) and `evidence/preliminary/`.

## Environment notes

- `@embedded-postgres/linux-x64` in this worktree needed its `postinstall` symlinks (`node scripts/hydrate-symlinks.js`), as in Phase 28. No source change.
- The IfcOpenShell venv `/tmp/designflow-phase23-ifc` (ifcopenshell 0.8.5) was present.
- Migration 0019 was applied to the local Supabase stack with `supabase migration up --local` after `evidence/database-before.json` was captured
  (`evidence/database-after-migration.json`: 0 rows missing, existing policies unchanged).
- A pre-release live-acceptance receipt was moved to `evidence/preliminary/supabase-receipts/`.

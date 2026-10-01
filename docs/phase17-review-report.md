# Phase 17 review report

Starting checkpoint: `7a335acae6e2fe098d43172cb18a5366ce58ec5c`,
`backend-v1-phase16-complete`, clean working tree. Raw pre-flight facts are in
`phase17-evidence/baseline.json`. Changes remain uncommitted for human review.

## ROOT CAUSE CONFIRMED

There is no frontend implementation in this repository, so the exact cause of the
reported external UI observation is **not confirmed**. No claim is made that cache
invalidation or a viewer bug has been fixed in that external application.

Controlled evidence confirms two integration traps, separately:

- Different generated buildings share the local `model.id` value `blueprint`.
  The baseline 3-to-4-bedroom reproduction returned different geometry and the
  correct room counts with that same ID. It cannot serve as global model identity.
- A durable receipt deliberately retains its original commit/current-pointer
  snapshot. The HTTP regression accepts R1, accepts R2 with changed rooms, then
  retries R1's exact key/request: the original R1 body is replayed while owner GET
  correctly returns R2. A client treating the replayed snapshot as live current
  state can show an old building. Changing inputs under that key instead returns
  409, never the old model.

Backend acceptance now proves correct generation/current identity for the
external-frontend exception in the request. Investigation of the actual frontend
must still establish whether either trap, stale sent requirements, response
ordering, or another cause produced the observation. The precise external work
and required UI tests are in `phase17-frontend-integration.md`.

## DEFENSIVE HARDENING

The backend lacked durable normalized requirements and execution/content identity
on directly generated revisions. Phase 17 adds those and a bounded opt-in current
artifact view, preserving the already-correct generator, QA, durable replay,
revision CAS, ownership and HTTP no-store behavior.

Production changes:

- `apps/api/src/lib/generation-identity.ts`: versioned canonical SHA-256 input and
  model identity, using the existing canonical hash convention.
- `contracts/freshness.ts`, `contracts/projects.ts`: strict identities, historical
  unknown representation and typed current artifact states.
- `services/project-service.ts`: server execution UUID, normalized input capture,
  signed atomic identity persistence and bounded execution diagnostics.
- Project routes/repository: identity reads and opt-in `includeFreshness=true`.
- Workflow service/routes and durable idempotency: execution/reuse/result logging;
  workflow artifacts still resolve via immutable source revision IDs.
- `supabase/migrations/0011_generation_freshness.sql`: two nullable columns on
  existing revisions, database hash verification, private projections/helpers,
  and two bounded-lookup/identity indexes. No historical backfill or new tables.

`requirementsHash` identifies normalized millimetre requirements and solver
options plus generator/identity version, excluding seed. Seed remains explicit
and is included in the durable request fingerprint. `modelHash` identifies the
canonical authoritative building with execution provenance excluded; it is not a
claim of geometric equality under arbitrary entity relabeling. `generationId`
identifies actual generator execution; supplied and historical models do not
invent one. Revision ID identifies accepted immutable persistence; its parent is
the committed base. A new generation/revision need not have different geometry.

Existing derived artifacts stay attached to their original revision. The current
snapshot cannot select them for another revision and reports explicit absence.
Historical access remains intact. Clients must guard all asynchronous state
updates and refresh the project after commits/replays; no frontend exists here to
implement or validate visual cache or mesh lifecycle changes.

## Data preservation and security

The local stack was healthy. Only additive migration 0011 was applied. Before and
immediately after it: 269 projects, 284 revisions, 284 QA runs, 259 takeoffs,
166 construction calculations, 111 costs and 102 workflows. All 15 public-table
counts were unchanged, as was the digest of existing model bodies:
`d6e582efe1033a074205f08608c59829`.

Migrations 0001–0010 and all generator/calculation engines remain unchanged.
Existing signed writes, owner RLS, QA acceptance, receipt-before-CAS behavior and
history immutability are retained. New HTTP identity fields cannot be supplied by
clients. Database tests reject invalid signed hashes/seed/execution identity;
owner-only fields are absent from public project projections. Existing live test
cleanup applies only to its own generated test identities/data; protected
historical artifacts remain under the established retention rules. No reset was
performed, and no paid service or new infrastructure was introduced.

## Verification

Twenty new Vitest tests (7 pure identity tests and 13 PostgreSQL tests, including 8 shared HTTP cases also exercised live) and four new pgTAP assertions were added. The existing generator import-boundary allowlist adds only the new identity module, which uses the public normalization/version exports; the boundary assertion remains enforced.

Exact commands, exit codes, pass counts, timings and log paths are recorded in
`phase17-verification.json`. `phase17-example.json` is written only by the real
PostgreSQL acceptance sequence, with accepted revision/current identity, normalized
requirements, model/input hashes, QA and derived absence; it contains no secrets.
The completed gate results follow below.

## Limitations and next phase

External frontend diagnosis, actual displayed-state tests and viewer disposal
remain external. Pre-Phase-17 inputs/execution identities are unknown; old receipts
remain byte-shape compatible. Failed attempt traces are bounded logs, not a new
persistent job system. Canonical hashes retain authoritative entity IDs and
ordered polygon/dimension arrays. Explicit seed changes may converge. No
natural-language modification interpretation, new solver, drawing renderer or
3D compiler was added.

Next phase: **Phase 18 — Architectural AI / Requirement Interpreter**, converting
natural language into validated structured requirements before this generation
contract. Commit/tag `backend-v1-phase17-complete` requires separate human approval.

## Completed gates

All 22 requested gate invocations passed; no required tests were skipped. The final `check` included a fresh build, typecheck and lint after the historical-receipt compatibility refinement.

| Gate | Result |
| --- | --- |
| `npm run build` | PASS — exit 0 ([log](phase17-evidence/build.txt)) |
| `npm run typecheck` | PASS — exit 0 ([log](phase17-evidence/typecheck.txt)) |
| `npm run lint` | PASS — exit 0 ([log](phase17-evidence/lint.txt)) |
| `npm run test:unit` | Test Files  28 passed (28); Tests  1475 passed (1475) ([log](phase17-evidence/unit.txt)) |
| `npm run test:generator` | Test Files  8 passed (8); Tests  461 passed (461) ([log](phase17-evidence/generator.txt)) |
| `npm run test:blueprint` | Test Files  1 passed (1); Tests  137 passed (137) ([log](phase17-evidence/blueprint.txt)) |
| `npm run test:blueprint-qa` | Test Files  6 passed (6); Tests  177 passed (177) ([log](phase17-evidence/blueprint-qa.txt)) |
| `npm run test:projects` | Test Files  1 passed (1); Tests  23 passed (23) ([log](phase17-evidence/projects.txt)) |
| `npm run test:takeoff` | Test Files  2 passed (2); Tests  23 passed (23) ([log](phase17-evidence/takeoff.txt)) |
| `npm run test:construction` | Test Files  2 passed (2); Tests  34 passed (34) ([log](phase17-evidence/construction.txt)) |
| `npm run test:cost` | Test Files  2 passed (2); Tests  39 passed (39) ([log](phase17-evidence/cost.txt)) |
| `npm run test:workflows` | Test Files  2 passed (2); Tests  51 passed (51) ([log](phase17-evidence/workflows.txt)) |
| `npm run test:integration` | Test Files  10 passed (10); Tests  138 passed (138) ([log](phase17-evidence/integration-1.txt)) |
| `npm run test:integration` | Test Files  10 passed (10); Tests  138 passed (138) ([log](phase17-evidence/integration-2.txt)) |
| `npm run test:integration` | Test Files  10 passed (10); Tests  138 passed (138) ([log](phase17-evidence/integration-3.txt)) |
| `npm run test:supabase` | Test Files  1 passed (1); Tests  55 passed (55) ([log](phase17-evidence/supabase-1.txt)) |
| `npm run test:supabase` | Test Files  1 passed (1); Tests  55 passed (55) ([log](phase17-evidence/supabase-2.txt)) |
| `npm run check` | Test Files  39 passed (39); Tests  1615 passed (1615) ([log](phase17-evidence/check.txt)) |
| `npm run db:test` | All tests successful.; Files=1, Tests=48,  0 wallclock secs ( 0.03 usr +  0.00 sys =  0.03 CPU) ([log](phase17-evidence/db-rls.txt)) |
| `docker build -t designflow-api:phase17 .` | PASS — exit 0 ([log](phase17-evidence/docker.txt)) |
| `node scripts/smoke-container.mjs designflow-api:phase17` | Production container: non-root, liveness 200, failed-dependency readiness 503, SIGTERM exit 0. ([log](phase17-evidence/smoke.txt)) |
| `git diff --check` | PASS — exit 0 ([log](phase17-evidence/diff-check.txt)) |

Both live runs observed 1,657 HTTP requests each. Each recorded 12 expected
anonymous 401/42501 permission denials from negative security assertions, zero
unexpected upstream failures, and zero API errors. The observation summary and
raw sanitized evidence are retained; no retries or authentication changes were
used to obtain passing runs.

Docker smoke confirmed a non-root runtime, liveness HTTP 200, dependency failure
readiness HTTP 503, and clean SIGTERM exit 0. There are no frontend build/test
commands because there is no frontend package. The backend/browser-compatible
shared and generator typechecks are included in the existing gates.

The five-step real example changes 3 to 4 bedrooms, then changes the site from
9144 × 15240 mm to 12192 × 18288 mm (30 × 50 ft to 40 × 60 ft), returns to A,
and requests D with both the larger site and seed S2. D is not a seed-only
alternative to A. Every current pointer equals its
accepted revision; the return to A restores A's input/model hashes while retaining
a distinct execution and revision. Full UUIDs and hashes are in the example JSON.

| Step | Bedrooms | Site (mm) | Seed | Requirements hash prefix | Model hash prefix |
| --- | --- | --- | --- | --- | --- |
| A / R1 | 3 | 9144 × 15240 | S1 | `6baad624d395` | `9da74bd8be76` |
| B / R2 | 4 | 9144 × 15240 | S1 | `4d9916435b0e` | `81393654946d` |
| C / R3 | 4 | 12192 × 18288 | S1 | `b6909c0a38aa` | `aed7fc27b284` |
| A / R4 | 3 | 9144 × 15240 | S1 | `6baad624d395` | `9da74bd8be76` |
| D / R5 | 3 | 12192 × 18288 | S2 | `ac2497b2b621` | `72dfbd7cef99` |

The original Phase 17 implementation was left for manual review without an agent-created commit or tag. This follow-up began from clean existing checkpoint `bf3fa6b5d7d027932f9851f9c522655d39f64247` (`backend-v1-phase17-complete`); the seed-evidence corrections remain uncommitted and do not move that tag.


## Seed evidence investigation

The apparent inconsistency came from an incomplete comparison in the report:
the table omitted plot dimensions. Comparing every field of the complete stored
`normalizedRequirements` for A/R1 and D/R5 finds exactly these leaf differences:

| Field | A/R1 | D/R5 |
| --- | --- | --- |
| `seed` | S1 | S2 |
| `site.boundary[1].x` | 9144 | 12192 |
| `site.boundary[2].x` | 9144 | 12192 |
| `site.boundary[2].z` | 15240 | 18288 |
| `site.boundary[3].z` | 15240 | 18288 |

All other fields match: room counts and dimensions/preferences, floors,
relationships, setbacks, north, circulation, wall/floor/slab dimensions, doors,
windows and all solver options. Both use `maxCandidates: 32`,
`maxIterations: 20000`, generator version `precision-blueprint-v1`, and identity
version `generation-freshness-v1`. There are no other generation options outside
the normalized requirements for this endpoint; base revision and retry identity
belong to command/concurrency semantics, not the architectural hash.

`apps/api/src/lib/generation-identity.ts::requirementsHash` normalizes inputs and
removes the top-level seed before passing the remaining requirements plus generator
and identity versions to the existing recursively sorted SHA-256 hash. Migration
0011 independently uses `requirements - 'seed'` for the same database check.
The changed plot explains the different A/D hashes. No production hashing,
generator, idempotency, or database change is needed.

The strengthened shared HTTP test clones A's complete normalized input and changes
only `seed`. It proves full equality after omitting seed from both persisted
inputs, identical requirements hashes and versions, distinct seeds/execution IDs,
and independently checks model hashes without requiring a geometry difference.
It also retries with the original key and original base while changing only seed:
this must return 409 `IDEMPOTENCY_CONFLICT`. An identical retry still exactly
replays A. A successful new attempt then uses a fresh key and A's committed base.

The regenerated example retains A/B/C/A/D, adds an explicit `sequenceComparison`
explaining the plot difference, and includes a separate real `seedOnlyComparison`
with full normalized inputs, generation/revision IDs and hash/conflict evidence.
The isolated S1 and S2 runs both produce requirements hash
`6baad624d395ee5a9e27abc1a6d461cdc77adbcfed287dd8ed931195f3d08d61`.
Their generation IDs differ. In this fixture their model hashes differ
(`9da74bd8be76…` versus `24cca0eed37f…`); the assertion permits either result and
compares hashes against actual canonical models. Full IDs/hashes and both complete
normalized inputs are included in `seedOnlyComparison`.

The original-input field diff and recomputed A/D/seed-only hashes are saved in
`phase17-evidence/seed-audit/input-comparison.json`. Follow-up verification is
recorded separately in `phase17-verification.json` under `seedEvidenceFollowUp`;
the earlier full Phase 17 gate history is retained.


Seed-evidence follow-up validation:

| Gate | Result |
| --- | --- |
| Focused freshness unit + PostgreSQL tests | 20 passed ([log](phase17-evidence/seed-audit/focused.txt)) |
| `npm run check` | 1,615 passed; build, typecheck and lint passed ([log](phase17-evidence/seed-audit/check.txt)) |
| `git diff --check` | PASS ([log](phase17-evidence/seed-audit/diff-check.txt)) |

Only tests and documentation/evidence changed in this follow-up. Production
hashing, durable idempotency, generators and migrations are unchanged. No commit
or tag was created or moved.

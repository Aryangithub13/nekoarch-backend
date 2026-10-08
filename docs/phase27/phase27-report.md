# Phase 27 report — specialized architectural knowledge & engineering intelligence V1

## Classification

**PHASE 27 FULLY IMPLEMENTED AND VERIFIED WITHIN BOUNDED SCOPE**

Basis: final frozen-source release run 3. 57 / 57 gates exit 0, with no waived failure and no required skip. The frozen source (manifest `638c25948f6c5ca9003bb66b437bdb2fc23cd73840c77b33d21caecde852e792`, 419 files) and every protected historical directory were unchanged before and after every gate. Full record: [phase27-verification.md](phase27-verification.md).

This classifies the bounded implementation only. Every result is advisory. Compliance, certification and professional approval are `NOT_CLAIMED`.

## What was delivered

- `apps/api/src/knowledge/`:
  - `contracts.ts`: schemas, versions, limits, claims.
  - `units.ts`: exact rational units and ULP float bands.
  - `packs.ts`: two bundled, checksummed knowledge packs and semantic pack validation.
  - `facts.ts`: `project-facts-v1` extraction with the transitive upstream-consistency invariant.
  - `evaluate.ts`: scoping, applicability, a closed rule DSL with a status algebra (ALL / ANY / NOT, float-boundary policy K = 16).
  - `conflicts.ts`: bounded conflict detection.
  - `validate.ts`: independent model and result validators. They import none of the evaluator modules (checked by a static gate).
- Wiring:
  - `lib/knowledge-repository.ts` (DB codes P2701–P2703), `services/knowledge-service.ts` and `routes/knowledge.ts`.
  - Six owner-only routes under `/api/projects/:projectId/revisions/:revisionId/knowledge`: `GET /packs`, `POST /validate`, `POST /analyses`, `GET /analyses`, `GET /analyses/:analysisId[?require=current]` and `GET /status` ([phase27-api.md](phase27-api.md)).
  - Telemetry route templates in `lib/sentry.ts`.
- Migration `0017_specialized_knowledge_analyses.sql` only; 0001–0016 are byte-identical.
  - It adds an immutable, owner-only table bound to the accepted revision and optionally to structural (0014), environmental (0015) and systems (0016) analyses of the same revision.
  - Writes go through signed security-definer RPCs with idempotency receipts, and SQL recomputes `cost_hash`, `inputHash` and `factsHash`.
- Tests:
  - `knowledge.test.ts` (unit) and `knowledge.integration.test.ts` (embedded PostgreSQL: G1–G8, SQL forgery rejection, RLS, immutability, concurrency, the 503 case, checksum parity): 34 in total.
  - Live Supabase acceptance and pgTAP/RLS plan 79.
  - Compiled container acceptance.
- Tooling: `scripts/benchmark-knowledge.ts`, `mutation-test.py` (37 mutants), `validator-independence.mjs`, `verify-phase27.py`, `snapshot-local-db.py`.

## Verification summary (run 3)

| Area | Result |
|---|---|
| Build / typecheck / lint | exit 0 |
| `test:unit` | 2151 passed |
| `test:integration` (embedded PostgreSQL) | 238 passed |
| `test:knowledge` | 34 passed |
| Historical suites | generator 526, blueprint 137, blueprint-qa 198, solver-v2 40, parametric 36, projects 23, takeoff 23, construction 34, cost 39, workflows 51, interpretation 133, conversations 52, ai-orchestration 120, BIM 41, structural 129, environmental 112, systems 47 — all passed |
| `npm run check` | 2431 + 133 + 52 passed |
| Live local Supabase (`test:supabase`) | 104 passed |
| pgTAP / RLS (`db:test`) | 79 / 79 |
| Mutation (`mutation-test.py`) | **37 / 37 killed for the intended reason**, every file restored by sha256, clean controls before and after |
| Phase 23 IFC preservation | 7 / 7 fixtures byte-identical; model and BIM equal; IFC round-trip and profiles exit 0 |
| Phase 24 / 25 / 26 preservation | tags resolve, Phase 24 audit reproductions, Phase 25/26 offline and validator-independence gates, compiled Phase 23–26 container acceptances — all exit 0 |
| Validator independence and offline/no-I/O/no-clock (knowledge) | exit 0 |
| Docker | build, smoke, runtime contents, compiled Phase 27 offline acceptance — exit 0 |
| Database preservation | 0 pre-existing rows missing; RLS enabled everywhere; pre-existing policies unchanged; migration history = 0001–0016 + 0017 only |
| `git diff --check` | exit 0 |

## Benchmark (`benchmark:knowledge`, run 3)

| Case | Facts | Rules sel. | Results | Conflicts | Extract ms | Evaluate ms | Validate ms | Snapshot |
|---|---|---|---|---|---|---|---|---|
| small 1-storey, architecture only | 109 | 30 | 44 | 1 | 2.6 | 4.0 | 12.2 | 153 KB |
| L-shaped, architecture only | 95 | 30 | 41 | 1 | 0.7 | 1.1 | 5.0 | 142 KB |
| two-storey setback | 132 | 30 | 43 | 1 | 0.9 | 1.4 | 6.4 | 176 KB |
| maximum 24-room | 350 | 30 | 113 | 1 | 2.0 | 2.7 | 17.3 | 419 KB |
| wet two-storey + systems | 211 | 30 | 62 | 1 | 1.4 | 1.6 | 9.6 | 265 KB |
| G1 multi-discipline, both packs | 243 | 30 | 62 | 1 | 1.2 | 1.6 | 10.0 | 292 KB |
| eight packs (2 bundled + 6 × 64 synthetic) | 243 | 414 | 1865 | 647 | 1.1 | 54.4 | 246.5 | 3.95 MB |
| 1024 rules (4 × 256) | — | — | — | — | — | — | — | refused 422 in 0.5 ms |
| 2 × 128 contradictory rules | — | — | — | — | — | — | — | refused 422 in 17.6 ms |

The ~99.7 k conflict-pair probe takes 97 ms. Output size, not CPU, is the binding constraint.

## Frozen limits (`KNOWLEDGE_LIMITS`)

Input 16 KiB; 8 packs; 256 rules per pack; **512 rules selected**; pack 256 KiB; predicate depth 8; 64 nodes per rule; 16 children per ALL/ANY; 32 labels per selector; 20 000 facts; **6 000 subject results**; 100 000 conflict pairs; **1 000 conflicts**; 128 evidence entries per result; **8 MiB output**; 5 s calculation. Bold values were set from the benchmark (pre-freeze evidence: `evidence/benchmark-pre-freeze.json`). Anything over a limit gets a typed 422 before the work is done.

## Release history

Run 1 failed four tests; run 2 was stopped for a scope finding; run 3 passed. Root causes, categories and fixes are in [phase27-verification.md § Superseded runs](phase27-verification.md#superseded-runs-archived-never-promoted).

- **Phase 27 defect:** knowledge routes missing from the telemetry registry.
- **Stale expectation:** the foreign-key count. It's now pinned to the exact five 0017 foreign keys.
- **Pre-existing test clock bug (Phases 5/7):** a Postgres-local versus UTC date mix in two rate-version fixtures.
- **Harness scope finding:** an unrecorded edit to `test:systems`, reverted.

None of the fixes changed production behavior beyond adding the telemetry templates.

## Known limitations

- **Source ceiling.** Phase 27 inherits the Phase 23 BIM profile (≤ 2 storeys, ≤ 28 spaces, 1 stair, no columns). Larger revisions return 422 `KNOWLEDGE_SOURCE_UNSUPPORTED`.
- **Precision ceiling.** Results over `UPSTREAM_FLOAT` facts are exactly as precise as the stored double. Boundary artifacts like G1 #22 are possible and visible, and ambiguous comparisons within K = 16 ULP return `REVIEW_REQUIRED` (`FLOAT_BOUNDARY_AMBIGUITY`).
- **Bounded conflict detection.** It covers the same fact, overlapping scope, identical applicability and scalar normal form only. Semantic and compound-predicate conflicts are `NOT_EVALUATED`.
- **Label scope.** Matching is literal; there is no synonym ontology.
- **Bundled packs only.** No user, organization or uploaded packs; no cost facts; no LLM paraphrase layer (deferred to Phase 36).
- **Revision-bound service surface.** Analyses are bound to persisted accepted revisions. There is no public candidate-scoped (in-memory model) entry point. That is why Phase 28's optimization adapter remains `PHASE27_INTEGRATION_DEFERRED`.
- **Meaning of a result.** Every result is advisory. No result is compliance, certification or professional approval.

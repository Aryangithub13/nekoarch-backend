# Phase 27 source audit — specialized knowledge & rule evaluation

Status: **IMPLEMENTATION NOT STARTED.** This file is the audit only. No source, migration or test has been changed.

## 0. Baseline preflight (2026-10-07)

| Check | Result |
|---|---|
| `pwd` | `/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow` |
| Branch | `phase27/specialized-knowledge` |
| `git status --short` | empty: no tracked changes and no untracked files |
| `HEAD` | `4d1f431b4eabcf7fdd3b9f88c3c4a5cdc3f3c7e7` |
| `backend-v1-phase26-complete^{commit}` | `4d1f431b4eabcf7fdd3b9f88c3c4a5cdc3f3c7e7` (**matches**) |
| Commits after Phase 26 | **none** (`git log backend-v1-phase26-complete..HEAD` is empty) |
| Ponytail branches | `refactor/ponytail-safe-cleanup` and `refactor/ponytail-post-phase26` both point at `4d1f431`. They contain no commits, so no ponytail refactor is present in this baseline. |
| `docs/phase27/` | existed and was empty before this file |

Conclusion: the baseline is exactly the released Phase 26 checkpoint, and Phase 27 can start from it safely. Nothing was reset, rebased or rewritten.

Each source below is classified as one of:

- **REUSE**: imported unchanged.
- **EXTEND**: an additive, backward-compatible change.
- **REFERENCE**: a pattern to mirror, not imported.
- **DO_NOT_TOUCH**: only read.

## A. Canonical Building Model V2 (`packages/shared/src/building-v2`)

| Item | Actual schema / finding | Class |
|---|---|---|
| Units | Integer mm everywhere (`CoordinateMmSchema`, `LengthMmSchema`). `decimalRatio(value)` gives the exact `[bigint, bigint]` of a decimal string or of a JSON number's ECMAScript serialization. `roundRatio` rounds ties away from zero. | REUSE |
| Levels | `id, name, index, kind (storey/roof/datum), elevationMm, floorToFloorHeightMm \| null, boundary`. | REUSE (facts) |
| Spaces | `id, name, classification` (a **free label**, not an enum), `levelId, boundary, boundaryBasis, occupancy?` (optional integer; **generated models carry none**), `use?`, `specificationId?`. Generator labels include `circulation`, `corridor`, `stairwell`, `bedroom`, `bathroom`, `kitchen`, `living`, `study`, `dining`. | REUSE (facts) |
| Openings | `door` / `window` / `opening` with `offsetMm, widthMm, heightMm, sillMm, type`. A door's `operation` is hinged, sliding or unspecified. **There is no clear width separate from `widthMm`.** | REUSE (facts) |
| Stairs | One straight flight: `widthMm, riseMm, runMm, riserHeightsMm[], treadDepthMm, headroomMm?`, plus up to 2 landings. | REUSE (facts) |
| Site | `boundary`, `buildableBoundary?`, `northMilliDegrees`, `primaryEntryOpeningId?`, `setbacks[] {boundaryEdgeStart, minimumMm}`. A setback is a declared **requirement**, not a measured distance. | REUSE (facts); measured setback = UNSUPPORTED |
| Measurements | `polygonAreaMm2`, `footprintAreaMm2`, `grossFloorAreaMm2` and `wallMeasurements` return exact decimal strings (`.5` mm² possible). | REUSE |
| Geometry predicates | `ringContains`, `pointLocation`, `wallSpaceIds` and others are exact BigInt predicates. | REUSE |

Absent from the architecture, so the matching facts are **UNSUPPORTED** and are never inferred:

- occupant load on generated spaces;
- accessibility attributes;
- fire ratings, materials beyond a free `specification.material` label, and door clear width;
- measured setbacks;
- jurisdiction or occupancy classification.

## B. Blueprint / solver / QA (`packages/generator`, `packages/blueprint-qa`)

| Item | Finding | Class |
|---|---|---|
| `blueprint-qa` rule packs | `ArchitecturalRulePackSchema` is a **closed `kind` enum** of 9 rule kinds (minimum-space-area, minimum-space-span, minimum-door-width, maximum-riser-height, minimum-tread-depth, required-window, exterior-windows, reachable-spaces, column-free-spaces). The outcomes are `PASS / FAIL / NOT_APPLICABLE / NOT_EVALUATED`. `project-service` always runs `PRODUCT_DEFAULTS_RULE_PACK` (door ≥ 900, tread ≥ 280) as part of **revision acceptance QA**. | **REFERENCE**. Precedent for "rules are data, outcomes are bounded". |
| Same | It is part of the revision-acceptance gate, which every phase from 13 to 26 depends on. Changing its semantics would silently change which revisions are accepted. | **DO_NOT_TOUCH** |
| Generator / solver-v2 / parametric | Produce the revisions. Phase 27 only reads the accepted revision through BIM. | DO_NOT_TOUCH |

Decision: Phase 27 does **not** extend the QA rule kinds. Its DSL is a separate, versioned contract. A Phase 27 demo pack can restate the same thresholds, but as advisory rules. The QA gate stays authoritative for acceptance only.

## C. Phase 23 BIM (`apps/api/src/bim`, `services/bim-service.ts`)

| Item | Finding | Class |
|---|---|---|
| `readBim(repo, projectId, revisionId)` | Loads the revision, requires accepted QA, recomputes `modelHash`, projects BIM and validates it independently. Returns `{ model, validation, revision }`. Phases 24–26 all enter through it. | **REUSE** (sole architecture entry point) |
| Source profile (`sourceModel`) | **At most 2 storeys, ≤ 28 spaces (≤ 24 non-circulation), ≤ 200 walls/openings, ≤ 32 slabs, ≤ 1 stair, no columns**, orthogonal geometry. Anything else returns `BIM_UNSUPPORTED_MODEL`. | REUSE. Phase 27 inherits this ceiling and maps it to `KNOWLEDGE_SOURCE_UNSUPPORTED`. |
| `BimBindingSchema` | `projectId, revisionId, modelHash, generatorVersion, generationId, requirementsHash, parameterHash`, with `bimVersion = 'bim-semantic-v1'`. | **REUSE** (base of the knowledge binding) |
| `BimModel.quantities` | A full `QuantityTakeoffReport` (`quantity-takeoff-v1`), **recomputed deterministically from the revision inside BIM projection**. | **REUSE**: QUANTITY facts need no extra source id. |
| `bounded(value, bytes)` | Iterative preflight of JSON input. It rejects non-plain objects (so no prototype tricks), cycles, nonfinite numbers, depth > 24, > 150 000 nodes and oversize payloads. | **REUSE** for request and pack preflight |
| `digest` = `costHash` | Canonical sorted-key JSON plus SHA-256. It **matches SQL `project_private.cost_hash`**. | **REUSE** (input hash and pack checksum, both recomputable in SQL) |
| `semanticId`, `compare`, `sorted` | Deterministic ids and code-unit ordering. | REUSE |
| IFC export | Architectural profile only. | DO_NOT_TOUCH |

## D. Phase 24 structural (`apps/api/src/structural`)

| Item | Finding | Class |
|---|---|---|
| Snapshot | `structural-analysis-v1`. `binding = BimBinding + structuralModelVersion`. Read by explicit id through `StructuralRepository.read(projectId, revisionId, id)`, which is revision-scoped in SQL (another revision's analysis returns 404). | REUSE (read path) |
| Facts available | Member `kind` (COLUMN/BEAM) with exact `quantities.length / sectionArea / volume` (exact strings). Section `shape` RECTANGLE `{width, depth}` exact, or GENERIC (**no dimensions**). Support types; load-case and combination keys. Result sets hold displacements, reactions and station forces as **IEEE doubles** in kN, kN·m and mm. | REUSE (read-only) |
| Claims | `designVerification: NOT_EVALUATED`, `codeCompliance / certification / constructionSuitability: NOT_CLAIMED`. | REFERENCE |
| Not available | Capacity, utilisation, code checks, slab/foundation design. Any rule that needs them is **UNSUPPORTED**. | — |

## E. Phase 25 environmental (`apps/api/src/environmental`)

| Item | Finding | Class |
|---|---|---|
| Snapshot | `environmental-analysis-v1`, with an `environmentalModelVersion` binding. Explicit-id, revision-scoped read. | REUSE (read path) |
| Facts available | Zone `floorArea` (m², **double**), `height` (int mm), `volume`. `envelope.status` CLOSED/INCOMPLETE. `daylightIndicator.zones[] {windowArea, floorArea, ratio}` with metric `WINDOW_TO_FLOOR_AREA_RATIO` and `isDaylightMetric: false`. `thermal.cases[].total` (W, double) and per-type totals. `exposure` sunlit fractions. Per-section status enums. | REUSE (read-only) |
| Precision | Environmental quantities are **IEEE doubles**, not exact rationals. | See §J. Facts carry the stored double's exact decimal serialization and say so in provenance. |
| Not available | Comfort, HVAC load, energy rating, daylight metric. Rules that need them are **UNSUPPORTED**. | — |

## F. Phase 26 systems (`apps/api/src/systems`)

| Item | Finding | Class |
|---|---|---|
| Snapshot | `building-systems-analysis-v1`. Binding = BIM binding + `systemsModelVersion` + optional `structural` and `environmental` `{analysisId, inputHash, modelVersion}`. | REUSE (read path) |
| Life-safety facts | `lifeSafety.spaces[] {spaceId, reachable, distance (mm double), exitOpeningId, distinctExitsReachable, disjointExitRoutes, levelTransitions}`, `unreachableSpaceIds`, `egressAvailable`, `longest`, `deadEnds[].length`, and `widths.openings[] / stairs[]` (int mm). | REUSE |
| MEP facts | `networks[] {status, length, horizontalLength, verticalLength, bends}`. `drainage.slope {rise, run}` (integers, exact ratio). `airflow.total / segments[].velocity` (**exact strings**). Electrical `connected / demand` W and VA (**exact strings**). `coordination.clashes[] {type, severity}`, `penetrations[]` (all `REVIEW_REQUIRED`). | REUSE |
| Vertical transport | `elevators[] {status PROPOSED/REJECTED, shaft Rect (int), door.widthMm, verticalAccess, servedLevelIds}`. Engineering fields are `USER_PROVIDED/NOT_SPECIFIED` only. | REUSE |
| Trust pattern | Untrusted calculator, then an independent `validateSystemsResults`, then `SnapshotSchema.parse`, an output-byte budget, and a signed RPC write. `validate.ts` imports no calculator module. The release gate enforces this with a grep. | **REFERENCE** (copy the pattern 1:1) |
| Service/route/repository shape | `prepare → validate → run → validateResults → parse → sign → write`. Routes are `/validate`, `/analyses` (POST/GET), `/analyses/:id?require=current` and `/status`. GET never computes. | **REFERENCE** |
| Exact arithmetic | `systems/units.ts` defines a `Rational = [bigint, bigint]` type with `add/mul/div`, `fromNumber` (via `decimalRatio`) and `toExact`. | **REFERENCE**. Phase 27 needs its own small rational module, because importing systems internals couples phases and the Phase 26 gate keeps `units.js` out of its validator. |
| Claims | 10 `NOT_CLAIMED` keys. | REFERENCE |

## G. Quantity / construction / cost

| Item | Finding | Class |
|---|---|---|
| `quantity-takeoff` | `QuantityTakeoffReport.summary.totals[] {itemCode, quantity {value (exact decimal string), unit mm/mm2/mm3/each}, status}`. 45 item codes (`SPACE_FLOOR_AREA`, `GEOMETRIC_GROSS_FLOOR_AREA`, `DOOR_COUNT`, `STAIR_RISER_COUNT`, …). Already embedded in `BimModel.quantities`. | **REUSE** through BIM |
| Persisted takeoffs / construction / cost (0007–0009) | Separate revision-scoped artifacts, chained takeoff → construction → cost. Reading cost facts would need a new `costEstimateId` source, plus SQL verification against `project_revision_cost_estimates` and its chain. | **REFERENCE**. V1 proposal: **COST facts are UNSUPPORTED** (see open decision D2). |
| Money engine (`boq-cost`) | Exact decimals. Not touched (ponytail backlog). | DO_NOT_TOUCH |

## H. AI / interpretation / workflows (`apps/api/src/ai`, `apps/api/src/workflows`)

There are providers, an interpreter, a conversation planner and orchestration. **None is imported by Phase 27.** No provider abstraction is added. Phase 27 runs fully offline and never calls an LLM.

Class: **REFERENCE ONLY.**

## I. Persistence / RLS / test support

| Item | Finding | Class |
|---|---|---|
| Migrations | 0001–0016. The latest is `0016_building_systems_analyses.sql` (193 lines). | DO_NOT_TOUCH (0001–0016) |
| 0016 pattern | Immutable table with CHECKs that tie its columns to the snapshot. Owner-only `select` RLS and no client writes. `immutable_revision` trigger. `systems_write` is SECURITY DEFINER with: HMAC envelope (operation, input, context, 600 s expiry); ownership and accepted-QA checks; **binding recomputed in SQL** from `r.model_json`; upstream rows checked as the same revision with matching `input_hash` and model version; an advisory lock on `(revision, inputHash)` with a nondeterminism check; and idempotency receipts. `systems_read` handles get, list (keyset cursor on `created_at desc, id desc`) and status. | **REFERENCE**. 0017 mirrors it. |
| `idempotency_records.operation` CHECK | Re-declared by each phase migration. | **EXTEND** in 0017 (drop and re-add with the knowledge operation appended) |
| `Repository` interface (`lib/repository.ts`) | Optional `xxxRpc` per phase. Implemented in `lib/supabase.ts` and `test-support/pg-backend.ts`. | **EXTEND**: add `knowledgeRpc` in all three places |
| `app.ts` | Mounts phase routes in one scope. | **EXTEND** (one line) |
| `supabase/tests/rls.sql` | pgTAP `plan(72)`. | **EXTEND** (new assertions; bump the plan) |
| `supabase/tests/database.test.ts`, `apps/api/tests/supabase.live.test.ts` | Live DB coverage per phase. | **EXTEND** |
| `package.json` scripts | `test:unit` and `test:integration` list files explicitly. | **EXTEND** (`test:knowledge`, `benchmark:knowledge`, and add the new test files to the lists) |

## J. Exact arithmetic and units

- Existing primitives:
  - `decimalRatio` and `roundRatio` (shared, REUSE);
  - BigInt area helpers (shared, REUSE);
  - `systems/units.ts` Rational (REFERENCE);
  - `structural/units.ts` `UNITS` table, which is float-based (REFERENCE only);
  - `decimal.js`, which is a dependency but is not needed.
- Upstream fact precision is mixed, as the table shows.

| Source | Representation | Phase 27 handling |
|---|---|---|
| Architecture geometry, takeoff | integers / exact decimal strings | exact |
| Systems electrical, airflow | `exact` strings (`"n/d"` or decimal) | exact (parse the string, never `value`) |
| Systems distances / lengths, structural results, environmental areas / ratios | IEEE doubles stored in JSON | exact rational **of the stored decimal serialization**; provenance `derivation: STORED_DOUBLE_DECIMAL`. Phase 27 can't be more precise than its source and says so. |

- Rule thresholds are **decimal strings** in packs (for example `"1100"` or `"0.1"`), never floats. That keeps checksums identical between JS `costCanonical` and SQL `cost_hash`.
- The supported unit set is bounded: `mm, m, mm2, m2, mm3, m3, W, kW, VA, kVA, L/s, m3/s, m/s, 1, %, count`. Every conversion is an exact power-of-ten rational. Cross-dimension conversion is rejected.

## K. Gaps, risks and consequences

1. **Inherited source ceiling.** Phase 27 can only run on revisions inside the BIM profile (≤ 2 storeys, 1 stair, no columns). Multi-storey or high-rule-count fixtures stop at that ceiling. The benchmark scale comes from rules and packs, not building size.
2. **Classification is free text.** Rule scope by classification is exact string matching on explicit labels. Nothing is inferred from names or by synonym, and the matching rule (case-sensitive or not) must be fixed in the contract.
3. **No occupancy, accessibility, fire rating or jurisdiction data.** Rules on those facts return `INPUT_INCOMPLETE` or `UNSUPPORTED`. Phase 27 cannot "know codes"; it evaluates selected packs over available facts.
4. **Mixed precision** (§J) is handled by explicit provenance, not by pretending upstream doubles are exact.
5. **No existing knowledge or rule DSL** exists in `apps/api` (grep: no `knowledge` symbols). Phase 27 is a new module, `apps/api/src/knowledge/`.
6. **Validator independence.** The result validator must reimplement fact lookup, unit normalisation and predicate evaluation. It may import contracts, `@designflow/shared` and `digest` only. It gets a grep gate like Phase 26 (forbidding `./facts.js`, `./evaluate.js`, `./conflicts.js`, `./units.js`).

## L. Proposed module plan (mirrors Phase 26; to be fixed in `phase27-design.md`)

```
apps/api/src/knowledge/
  contracts.ts      versions, limits, zod: pack, rule AST, input, binding, facts, results, snapshot, DTOs
  packs.ts          built-in project-authored demo packs (synthetic thresholds, CC0) + catalog
  units.ts          bounded exact unit table + rational (evaluator side)
  facts.ts          project-facts-v1 extraction from BIM (+ embedded takeoff) and bound upstream snapshots
  evaluate.ts       applicability + predicate evaluation + explanations (knowledge-rule-evaluator-v1)
  conflicts.ts      knowledge-conflict-detector-v1 (interval/equality contradictions over identical fact+scope)
  validate.ts       independent model + result validators (no evaluator imports)
apps/api/src/lib/knowledge-repository.ts
apps/api/src/services/knowledge-service.ts
apps/api/src/routes/knowledge.ts
supabase/migrations/0017_specialized_knowledge_analyses.sql
test-support/knowledge-fixtures.ts, knowledge-acceptance.ts
apps/api/tests/knowledge.test.ts, knowledge.integration.test.ts
scripts/benchmark-knowledge.ts
docs/phase27/{design,api,report,verification}.md, evidence/**, verify-phase27.py, mutation-test.py
```

Proposed DSL operator set for V1 (each independently re-evaluable):

- `EXISTS`, `NOT_EXISTS`;
- `EQUAL`, `NOT_EQUAL`, `GT`, `GTE`, `LT`, `LTE`, `BETWEEN`;
- `COUNT` (with min/max), `RATIO` (fact ÷ fact vs threshold), `BOOLEAN`;
- `ALL`, `ANY`, `NOT`, `CONDITIONAL`;
- `SOURCE_STATUS`, `MANUAL_REVIEW_ONLY`.

`GEOMETRIC_WIDTH / DISTANCE / CLEARANCE` and `REACHABILITY` are **fact types** consumed by the comparison operators: opening and stair widths, egress distance, dead-end length, `reachable`, `distinctExitsReachable`. They are not new geometry operators, so Phase 27 adds no geometry engine. `RANGE` duplicates `BETWEEN` and is omitted. Facts are referenced by a closed `factType` enum plus a typed scope selector. There are **no property paths**, so a pack cannot traverse properties.

## M. Open decisions (need a human call before design freeze)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Packs: built-in only, or also **inline caller-supplied packs** in the request? | Accept inline packs in V1, using the same schema as built-in packs. The server computes the checksum and it must equal the declared one. Rule definitions are embedded in the snapshot, and SQL recomputes `cost_hash` per pack. This gives user and org packs without committing source documents, and makes conflict scenarios testable. |
| D2 | COST facts | **UNSUPPORTED** in V1. QUANTITY comes from the BIM-embedded takeoff. Adding cost needs a third source chain (0007–0009) for little value. |
| D3 | Status of rules in a detected conflict | Each conflicting rule gets `CONFLICTING_RULES`. Its isolated predicate outcome is kept in `explanation` but never promoted. |
| D4 | Pack catalog route | Authenticated and mounted under the revision path, like the other routes. No anonymous surface. |
| D5 | Classification matching | Case-sensitive exact match on the stored label. Systems lower-cases its circulation labels; knowledge rules list labels explicitly. |

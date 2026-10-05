# Phase 23 engineering report

Historical completion-pass report. The release-closure audit, final source snapshot, current verification results and authorized checkpoint are documented in [phase23-review-report.md](phase23-review-report.md). Original evidence is preserved in `phase23-evidence/superseded-preclosure.tar.gz`.

Verification date: 2026-10-05. Final classification is recorded in section 16 after all gates finish.

## 1. Starting checkpoint

Authoritative repository: `/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow`. Branch `main`; HEAD and `backend-v1-phase22-complete` both resolve to `7086209efd9e337a2c175b9bed1e562fde54ca68` (`Backend V1 Phase 22 complete`). Recent commits and historical release tags were inspected. The Phase 22 audit, design, review and preservation evidence were read.

The preceding implementation pass recorded a clean Phase 22 start. This continuation started with the expected uncommitted Phase 23 delta, not a clean tree. [Continuation baseline](phase23-evidence/continuation-baseline.json) records the independently observed status and file digests. Existing work and earlier failed-gate evidence were retained. No staging, commit, tag, push, deployment, reset, history rewrite, frontend access or Phase 24 implementation occurred.

## 2. Architecture assessment

Existing Building Model V2 provides accepted geometry, native element IDs, levels, opening hosts, slab holes and stairs. Earlier modules provide independent Blueprint QA, canonical hashes, immutable signed revisions, owner JWT/RLS isolation, Phase 13 quantity definitions, construction/cost provenance and bounded AI workflows. The [design matrix](phase23-design.md) records reuse decisions. All historical geometry engines remain authoritative and unchanged.

BIM uses deterministic on-demand projection. No migration, cache or durable artifact storage was needed for the measured supported workload. Retrieval does not rerun the architectural generator: it reads the accepted revision, checks its hash and acceptance evidence, audits its geometry, constructs BIM and validates the result.

## 3. BIM data model

`bim-semantic-v1`, property version 1, uses strict Zod contracts with one native geometry document, explicit millimetre units, typed source references, deterministic ordered elements, typed relationships, material definitions, native quantity references and immutable revision binding. IDs hash project + semantic role + source identity; revision IDs stay in snapshot provenance so unchanged components remain traceable.

Properties distinguish known, derived, assumed, unavailable and unevaluated values, with bounded keys, units and provenance. Engineering completeness is explicitly incomplete. Geometry references and hashes are checked against the authoritative source; client-authored property injection is unavailable. Limits include 2 MiB source preflight, 8 MiB BIM/export budgets, depth 24, 150,000 traversed values, 1,500 semantic elements and 6,000 relationships. The supported geometry profile adds stricter native component limits.

## 4. Semantic model

Implemented categories include project, optional site, building, level, space, exterior/interior wall, architectural opening, door/window fill, floor slab, roof, straight stair, landing, slab void and nonphysical group. Actual source dimensions, classifications, material specification labels and quantity associations are retained. Roof roles distinguish top and exposed lower coverage; no inaccessible roof is called a terrace.

Rooms and circulation retain their native boundary basis. Doors/windows describe known opening envelopes; leaf/frame/glazing assemblies are unavailable. Stair flight geometry and landing surfaces retain actual rise/run/tread and footprint data without invented underside thickness. Geometry and component collections remain bounded by the existing two-floor, 24-room architectural family.

## 5. Spatial relationships

Project → site when present → building → levels is explicit. Spaces and components belong to actual levels. Openings reference their real host walls; doors/windows fill those openings. Wall boundaries connect supported spaces. Stairs connect both storeys, own landings and reference slab voids by exact vertex equality. Groups collect envelopes, partitions and plates without creating extra solids.

The independent BIM verifier does not import the projector. It reconstructs expected inventory, parents, floors and graph edges from source; rejects duplicates, missing targets, wrong hosts, cycles, unsupported categories, inconsistent properties/materials and quantity mismatches; and returns machine-readable diagnostics. Shared canonical/property helpers retain identical vocabulary, while geometric source validity is independently audited by Blueprint QA.

## 6. IFC interoperability

Profile: `nekoarch-ifc4-architectural-v1`, targeting IFC4 ADD2 TC1 with STEP `FILE_SCHEMA(('IFC4'))`. IfcOpenShell documents IFC4 ADD2 TC1 parsing and geometry support in its [upstream repository](https://github.com/IfcOpenShell/IfcOpenShell); geometry reconstruction follows its [documented geometry API](https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html). Verification uses the pinned 0.8.5 release, independently of the current online documentation version.

The production TypeScript serializer exports IfcProject, IfcSite when provided, IfcBuilding, IfcBuildingStorey, IfcSpace, IfcWall, IfcSlab, IfcRoof, IfcOpeningElement, IfcDoor, IfcWindow, IfcStair, IfcStairFlight and IfcGroup. Schema-correct decomposition, containment, void/fill, space boundary, group, material, property and quantity relationships connect them.

Wall/slab prisms use swept solids; openings cut actual wall/slab hosts. Real L polygons remain concave. Surface representations preserve known room boundaries, door/window envelopes and stair/landing surfaces. Coordinates map native `(x,y,z)` to IFC `(x,-z,y)`; storey elevation is applied once. Length units are millimetres, exported areas square metres and volumes cubic metres. Deterministic compressed GlobalIds are separate from native IDs and model hashes. Custom property sets use `NekoArch_Provenance_v1` and `NekoArch_NativeQuantities_v1`, without inventing standardized Psets.

## 7. IFC verification

Seven generated fixtures cover V1, V2, single-floor L, two-floor setback, modified west wing, maximum 24 rooms and a specified material containing Unicode/apostrophe text. Each passes architectural/BIM QA before export. Independent IfcOpenShell EXPRESS validation and OpenCASCADE reconstruction compare source bounds, wall net volumes after opening deductions, slab volumes after voids, storey transforms, door/window dimensions and surface area, room area, stair/landing surface geometry, hosts/fills, spatial decomposition, stable IDs, material associations and native quantities.

All fixtures have zero schema diagnostics. Corrupted GlobalIds, missing IfcProject and incorrect length units are rejected. Missing-project/unit controls use independent parsed entities; duplicate GUID rejection uses the external EXPRESS validator. [Raw results](phase23-evidence/ifc-verification.json) and [command output](phase23-evidence/ifc-roundtrip.txt) retain counts, timings, parser memory and information loss. These are schema/geometry round-trips, not reimports into the native generator or an IFC software certification.

A supplemental [exact profile audit](phase23-evidence/ifc-profile-verification.json) compares independently parsed slab/roof outline edges and every void against native polygons. This also rejects mirrored L notches that would preserve a bounding box and net volume. Reproduce it with `/tmp/designflow-phase23-ifc/bin/python docs/phase23-evidence/verify-ifc-profiles.py`.

## 8. Quantity integration

Projection and validation reuse Phase 13 `calculateQuantityTakeoff`; no replacement quantity algorithm is introduced. IFC exports the exact native quantity basis with unit conversion. For the setback fixture: floor plates total 422.5 m² gross, subtract a 4.2 m² stair void, and retain 418.3 m² net; 150 mm thickness gives 62.745 m³. The lower plate is 234 m²; the upper is 188.5 m² gross and 184.3 m² net. Exported quantities and reconstructed geometry reconcile with these values.

Wall segment-prism junction limitations, finish coverage gaps and differing room/slab/floor-area definitions remain explicit. Conceptual construction recipes do not become authoritative material specifications.

## 9. Revision behavior

The bounded diff classifies added, removed, replaced, modified geometry, modified property and unchanged elements. It compares deterministic source roles rather than names. A changed geometry-addressed wall interval produces removed/added identities; role continuity is retained where native IDs remain stable. There is no speculative topology matching or engineering consequence prediction.

PostgreSQL/Supabase acceptance generates an approved building, edits west-wing width, creates a new immutable revision, compares BIM snapshots and re-fetches the old snapshot byte-for-byte. Cross-project comparisons are rejected. The production container separately checks a compiled edit/diff and unchanged prior snapshot. Stale stored model hashes and failed acceptance evidence fail closed.

## 10. Security

Every BIM operation authenticates, consumes the existing read quota and uses the caller's owner-scoped repository. Revision/project associations are checked explicitly. Database acceptance exercises JWT ownership and RLS, authenticated cross-owner 404s, unauthenticated 401s, cross-project revision rejection, strict query schemas, pagination, read-only behavior and private IFC responses. A dedicated quota test confirms exhaustion happens before repeated BIM work.

Artifacts use fixed UUID-derived filenames, bounded in-memory output and no arbitrary filesystem paths. No shared cache, public artifact links, storage credentials, executable user JSON or privileged AI mutation paths are exposed. Existing error redaction and `Cache-Control: no-store` are inherited. Phase 20 and Phase 21 contracts remain unchanged.

## 11. Tests and production verification

| Command | Exit | Passed tests | Seconds | Evidence |
|---|---:|---:|---:|---|
| `npm run build` | 0 | — | 13.649 | [log](phase23-evidence/build.txt) |
| `npm run typecheck` | 0 | — | 24.077 | [log](phase23-evidence/typecheck.txt) |
| `npm run lint` | 0 | — | 4.221 | [log](phase23-evidence/lint.txt) |
| `npm run test:unit` | 0 | 1838 | 55.200 | [log](phase23-evidence/test-unit.txt) |
| `npm run test:generator` | 0 | 526 | 17.304 | [log](phase23-evidence/test-generator.txt) |
| `npm run test:blueprint` | 0 | 137 | 7.681 | [log](phase23-evidence/test-blueprint.txt) |
| `npm run test:blueprint-qa` | 0 | 177 | 14.329 | [log](phase23-evidence/test-blueprint-qa.txt) |
| `npm run test:solver-v2` | 0 | 40 | 27.163 | [log](phase23-evidence/test-solver-v2.txt) |
| `npm run test:parametric` | 0 | 36 | 19.853 | [log](phase23-evidence/test-parametric.txt) |
| `npm run test:projects` | 0 | 23 | 18.739 | [log](phase23-evidence/test-projects.txt) |
| `npm run test:takeoff` | 0 | 23 | 21.512 | [log](phase23-evidence/test-takeoff.txt) |
| `npm run test:construction` | 0 | 34 | 18.891 | [log](phase23-evidence/test-construction.txt) |
| `npm run test:cost` | 0 | 39 | 22.263 | [log](phase23-evidence/test-cost.txt) |
| `npm run test:workflows` | 0 | 51 | 22.425 | [log](phase23-evidence/test-workflows.txt) |
| `npm run test:interpretation` | 0 | 133 | 19.140 | [log](phase23-evidence/test-interpretation.txt) |
| `npm run test:conversations` | 0 | 52 | 21.343 | [log](phase23-evidence/test-conversations.txt) |
| `npm run test:ai-orchestration` | 0 | 120 | 24.606 | [log](phase23-evidence/test-ai-orchestration.txt) |
| `npm run test:integration` | 0 | 189 | 70.579 | [log](phase23-evidence/test-integration.txt) |
| `npm run test:bim` | 0 | 33 | 25.340 | [log](phase23-evidence/test-bim.txt) |
| `npm run test:supabase` | 0 | 86 | 82.785 | [log](phase23-evidence/test-supabase.txt) |
| `npm run db:test` | 0 | 51 | 1.942 | [log](phase23-evidence/db-test.txt) |
| `npm run check` | 0 | 2029 / 133 / 52 | 197.198 | [log](phase23-evidence/check.txt) |

The final aggregate `check` includes the entire test suite plus build/typecheck/lint and separate interpretation/conversation runs. Counts from overlapping commands are not additive unique totals. PostgreSQL suites use actual isolated databases; Supabase tests use the local authenticated stack. Earlier typecheck/lint/check failures are retained in `phase23-evidence/superseded-initial-gates`; the repaired tests retain their assertions.

The first continuation live-Supabase run failed because PostgREST was stopped: its old fixed Docker address conflicted with the local mail container after Docker restart. The SQL/RLS gate passed independently. Reconnected only the stateless REST endpoint using its existing `rest` alias and an automatically assigned address, then restarted the same v16.3 image. Database, credentials, image and other services were unchanged. The failed log is retained under `superseded-rest-unavailable`; [recovery evidence](phase23-evidence/local-rest-recovery.json) and the [retry record](phase23-evidence/supabase-retry.json) identify the exact rerun.

Additional successful commands: `node --import tsx scripts/benchmark-bim.ts`; `PATH=/tmp/designflow-phase23-ifc/bin:$PATH npm run test:ifc`; `docker build -t designflow-api:phase23 .`; `node scripts/smoke-container.mjs designflow-api:phase23`; and `docker run --rm -i --network none designflow-api:phase23 node --input-type=module < docs/phase23-evidence/compiled-acceptance.mjs`. Exact command evidence is in [supplementary verification](phase23-evidence/supplementary-verification.json).

The container runs as non-root, returns liveness 200, detects missing dependencies with readiness 503 and exits cleanly on SIGTERM. Compiled BIM validation/export and a real parametric revision diff pass with networking disabled. Production Node is v22.23.3; host benchmark Node is v22.22.2. The image identifier is recorded in [docker-image.txt](phase23-evidence/docker-image.txt). No deployment occurred.

## 12. Benchmarks

| Fixture | Elements | Projection | Edge construction | Validation | IFC + validation | Self-diff | Export bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| v1 | 56 | 112.36 | 3.42 | 79.69 | 88.57 | 9.78 | 347930 |
| v2 | 56 | 46.60 | 1.18 | 59.22 | 60.15 | 9.01 | 347776 |
| L | 50 | 28.43 | 0.54 | 36.81 | 58.24 | 8.30 | 331655 |
| setback | 87 | 81.01 | 1.05 | 84.33 | 98.32 | 17.81 | 588102 |
| maximum-24 | 200 | 144.00 | 2.79 | 217.15 | 260.44 | 65.14 | 1391866 |
| modified | 87 | 63.03 | 1.03 | 90.61 | 100.83 | 21.98 | 588244 |
| specified-material | 56 | 37.14 | 0.61 | 37.25 | 47.29 | 8.20 | 348322 |

Times are milliseconds; IFC time includes export-time validation. Relationship-edge construction is a measured subset of projection, not a separate geometry algorithm. The benchmark uses one sample per fixture, with warm-up/order effects and concurrent verification load; it is not a throughput/SLA or speedup claim. Diff timings compare identical snapshots; changed-revision correctness is checked separately. Generation occurs before the timed BIM stages. Independent parser round-trip times include EXPRESS, geometry and corruption controls.

Highest sampled Node process peak RSS was 200327168 bytes (191.0 MiB); independent parser process peak RSS was 329342976 bytes (314.1 MiB). These are process observations, not per-request allocation. Full measurements: [benchmark.json](phase23-evidence/benchmark.json) and [IFC verification](phase23-evidence/ifc-verification.json).

## 13. Source and data preservation

All 156 protected source files match the Phase 22 tag byte-for-byte, including 12 historical migrations, package lock, shared/generator/QA/quantity/construction/cost code and fixtures, and canonical generation identity code. [Source preservation](phase23-evidence/source-preservation.json) records both hashes. [Tested source manifest](phase23-evidence/tested-source-sha256.json) binds gates to the delivered implementation; each runner row records whether source stayed unchanged.

Every original public-table row digest was preserved against both the initial Phase 23 baseline and this continuation baseline. Initial Phase 23 counts were **721 projects and 794 revisions**; continuation started with 755 projects and 833 revisions. Final counts are **789 projects and 872 revisions**. Migration history, RLS flags and policy digests are unchanged. [Data preservation](phase23-evidence/data-preservation.json) records all table comparisons.

Local acceptance records are retained according to the existing test suite's behavior, using isolated test identities and Phase 23 fixture titles. Snapshots store counts/digests, not raw building data or credentials. No production database was reset and no historical migration, accepted revision or original project row was replaced.

## 14. Files changed

The [complete changed-file inventory](phase23-evidence/changed-files.json) includes production files, tests, scripts, documentation and every evidence artifact. Runtime additions are the seven `apps/api/src/bim` modules, `routes/bim.ts`, `services/bim-service.ts`, and the route registration in `app.ts`. Test additions are BIM unit/integration/shared acceptance and a typed repository helper, with registration in the existing live Supabase suite. Root script registration adds BIM tests, IFC verification and benchmarking.

The [second source review](phase23-review.md) records actual inspected paths and resolved findings. Continuation fixes cover typed mocks, lint, relationship filtering, gate failure exit status/source manifests and stronger external IFC/material controls. No tracked historical production engine or migration changed.

## 15. Remaining limitations

Supported architecture remains bounded orthogonal V1/V2 and Phase 22 L/setback geometry, at most two floors and 24 occupied rooms. Legacy planar models lacking architectural heights, arbitrary freeform components, enclosed courtyard holes, structural frames and MEP networks are unsupported. Materials may carry accepted labels but no fabricated strength, fire, acoustic, thermal or manufacturer certification.

Door/window envelopes, room boundary faces and stair/landing surfaces are not detailed construction assemblies. Unknown site survey/georeferencing is omitted. Wall prism junctions are not Boolean-unioned. BIM's engineering completeness is deliberately incomplete. IFC4x3, arbitrary IFC profiles and universal vendor interoperability are not claimed. Native generator reimport is outside this export profile.

Conversational BIM retrieval remains pending under the brief's explicit read-only-service fallback; no broad natural-language BIM coverage is claimed. Existing advisory providers remain operational without paid services. Any future structural/MEP integration must define and validate new typed data and provenance.

## 16. Final classification

**FULLY IMPLEMENTED AND VERIFIED**

The classification covers the defined architectural BIM/IFC subset and the brief's permitted conversational fallback. It does not mean engineering completeness, construction certification or approval to deploy.

## 17. Release readiness

All required gates for the documented bounded Phase 23 profile passed. Recommend `backend-v1-phase23-complete` after user review and release approval. Changes remain unstaged and uncommitted on `main`; the release tag has not been created.

After the user reviews and approves the recorded delta, proposed commands are:

```bash
git add apps/api/src/app.ts apps/api/src/bim apps/api/src/routes/bim.ts apps/api/src/services/bim-service.ts apps/api/tests/bim.test.ts apps/api/tests/bim.integration.test.ts apps/api/tests/supabase.live.test.ts test-support/bim-acceptance.ts test-support/bim-repository.ts package.json scripts/benchmark-bim.ts scripts/requirements-ifc.txt scripts/verify-ifc.py scripts/verify-phase23.py docs/phase23-design.md docs/phase23-api.md docs/phase23-review.md docs/phase23-report.md docs/phase23-evidence
git diff --cached --check
git commit -m "Backend V1 Phase 23 complete"
git tag backend-v1-phase23-complete
```

These commands were not executed. Older-path Supabase receipt files listed in the inventory are retained test evidence and can be reviewed separately. No push or deployment is proposed automatically.

## 18. Phase 24 readiness

The semantic BIM foundation supplies deterministic source-backed elements, typed relationships, units, quantity references, immutable revisions, diffs, secure retrieval and independently verified IFC export. It can support a later reviewed structural integration. It supplies no structural analysis, load-bearing inference, MEP design or construction approval. Phase 24 was not begun.

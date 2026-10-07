# Phase 24 design — structural engineering integration

## 1. Scope

Phase 24 adds a bounded **linear-static 3D frame** structural layer on top of accepted Phase 12 revisions and the Phase 23 BIM projection. It is deliberately frame-only:

| Supported | Not supported in Phase 24 (truthful rejection) |
|---|---|
| Columns and beams placed by explicit user mapping onto architectural wall geometry | Shell/plate analysis of walls or slabs; slab panels; area loads (`STRUCTURAL_SOURCE_UNSUPPORTED`) |
| User-provided materials (E, ν, density) and sections | Strength/grade, design checks, code combinations, certification |
| Point and uniform member loads, self-weight | Wind, seismic, temperature, settlement, moving loads, P-Δ, nonlinear, dynamics |
| FIXED / PINNED / ROLLER / CUSTOM supports | Springs, member releases, eccentric offsets, rigid diaphragms |
| Project-defined load combinations (linear superposition) | IS/ACI/AISC/ASCE/Eurocode profiles |

Layering is strict and each layer is a different type:

```
accepted revision ─► BIM projection (Phase 23, unchanged)
   ─► explicit structural input (POST body)  ─► structural semantic model (model.ts)
   ─► independent semantic validation (validate.ts)
   ─► solver-neutral analysis model (analysis.ts)  ─► solver adapter (frame-solver.ts)
   ─► raw output (untrusted)  ─► output schema/reference validation  ─► result DTO + combinations
   ─► independent result validation (equilibrium, references, provenance)
   ─► immutable revision-bound snapshot (migration 0014)
```

## 2. Versions

| Constant | Value | Meaning |
|---|---|---|
| `STRUCTURAL_INPUT_VERSION` | `structural-input-v1` | request contract |
| `STRUCTURAL_MODEL_VERSION` | `structural-model-v1` | semantic model contract and identity namespace |
| `STRUCTURAL_ANALYSIS_MODEL_VERSION` | `structural-analysis-model-v1` | solver-neutral contract |
| `STRUCTURAL_ANALYSIS_VERSION` | `structural-analysis-v1` | persisted snapshot/result contract |
| `STRUCTURAL_ADAPTER_VERSION` | `structural-adapter-v1` | adapter interface |
| solver | `nekoarch-reference-frame-3d` `1.0.0` | reference solver |
| mapping rules | `COLUMN_AT_WALL_END/1`, `BEAM_ALONG_WALL/1` | geometric derivation rules |

All versions are literals in the zod schemas and in the input hash, so a future change cannot silently reinterpret a stored snapshot. `bim-semantic-v1` and the IFC profile are unchanged.

## 3. Binding

Every model/snapshot carries the Phase 23 `BimBinding` produced by the existing `readBim` (`projectId, revisionId, modelHash, generatorVersion, generationId, requirementsHash, parameterHash`) plus `bimVersion: 'bim-semantic-v1'` and `structuralModelVersion`. The write RPC recomputes `modelHash` from the stored revision with the Phase 17 SQL functions (`cost_hash` + `canonical_building`) and compares generation identity fields, so a snapshot cannot be attached to a revision whose geometry differs.

## 4. Identities

`str-` + first 40 hex of `sha256(JSON[projectId, 'structural-model-v1', role, ...source])`:

| Object | Identity components |
|---|---|
| node | `node`, x, y, z (integer mm) |
| member | `member`, kind, rule, `walls`, wall id, wall end (columns) or null, storey (level id) |
| analysis segment | `segment`, member id, start node id, end node id |
| material / section / load case / combination | kind, request key |
| load | `load`, case key, load key |
| support | `support`, node id |

Display names never enter identity. BIM IDs are not replaced; members carry `source.bimElementId` (`semanticId(projectId,'wall',wallId)`) and the native wall id.

## 5. Architecture → structure mapping

Nothing is automatic: each structural member exists only because the input names a rule and a source wall.

| Rule | Geometry (integer mm, global axes) | Requirements |
|---|---|---|
| `COLUMN_AT_WALL_END/1` | vertical line at the wall's `start` or `end` (x, z) from `level.elevationMm` to `level.elevationMm + level.floorToFloorHeightMm` | wall `pathReference = centerline`; level `floorToFloorHeightMm` not null |
| `BEAM_ALONG_WALL/1` | the wall centerline at `y = level.elevationMm + level.floorToFloorHeightMm` (storey-top reference plane) | same |

Each member records `mapping: { rule, ruleVersion: 1, provenance: 'EXPLICIT_USER_MAPPING', assumptionStatus: 'ASSUMED', assumptions }`. The storey-top plane and centerline axis are analytical idealisations, recorded as assumptions; the wall's architectural height (e.g. 2850 mm) is not reinterpreted. The architectural model and BIM are read-only inputs.

## 6. Semantic model (`structural-model-v1`)

- `nodes`: id, `{x,y,z}` mm, `levelId` (level whose elevation equals y, else null), `source: { derivation: 'MEMBER_ENDPOINT', memberIds }`.
- `members`: id, requestKey, kind `COLUMN|BEAM`, start/end node ids, materialId, sectionId, `orientation: 'REFERENCE_VECTOR_V1'`, levelId, source, mapping, structural quantities (`length` mm, `sectionArea` mm², `volume` m³, `mass` kg or `NOT_EVALUATED`).
- `materials`: category `CONCRETE|STRUCTURAL_STEEL|MASONRY|TIMBER|UNKNOWN`; each property `{ value, unit, provenance: 'USER_PROVIDED' }` or `{ value: null, unit, provenance: 'NOT_SPECIFIED' }`; optional `architecturalSpecificationId`/`bimMaterialId` for traceability only.
- `sections`: `RECTANGLE` (width along local z, depth along local y; A, Iy, Iz exact; J by the Roark rectangle approximation, provenance `DERIVED_FROM_SECTION_DIMENSIONS`) or `GENERIC` (A, Iy, Iz, J `USER_PROVIDED`).
- `supports`, `loadCases`, `combinations`, `constants.gravity`, `assumptions`, `topology`, `claims`.

Model-wide assumptions: `LINEAR_ELASTIC`, `SMALL_DISPLACEMENT`, `EULER_BERNOULLI_NO_SHEAR_DEFORMATION`, `RIGID_JOINTS`, `NO_RIGID_DIAPHRAGM`, `SLABS_AND_WALL_PANELS_NOT_MODELLED`, `NO_SECOND_ORDER_EFFECTS`.

`claims` is fixed: `designVerification: NOT_EVALUATED`, `codeCompliance: NOT_CLAIMED`, `certification: NOT_CLAIMED`, `constructionSuitability: NOT_CLAIMED`.

## 7. Engineering materials

Only properties required by linear frame analysis exist: elastic modulus (MPa), Poisson ratio (0 ≤ ν < 0.5), density (kg/m³). Strength/grade is not represented because design is not evaluated. Provenance in v1: `USER_PROVIDED` or `NOT_SPECIFIED`; there is no engineering library or project default, and material names / BIM material labels never populate values. Missing E or ν on a used material → `STRUCTURAL_MATERIAL_MISSING`; missing density with self-weight requested → `STRUCTURAL_MATERIAL_MISSING`; missing density otherwise → mass `NOT_EVALUATED`.

## 8. Units

Every engineering number in the contracts is `{ value, unit }` with a literal unit, or lives under a declared unit header. Conversions go only through `structural/units.ts`, which records each unit's dimension and power-of-ten factor to SI and refuses cross-dimension conversion at compile time (typed unit parameters) and at run time. Internal analysis units are N, mm, N·mm, MPa (= N/mm²), rad. Reported results: displacement mm, rotation rad, force kN, moment kN·m. Mass → force uses standard gravity 9.80665 m/s² (a defined constant) acting in −Y.

## 9. Loads, cases, combinations

- Load case: key, category `DEAD|LIVE|USER_DEFINED`, `selfWeight: boolean`, loads, `source: 'USER_PROVIDED'`, `version: 1`.
- Load: key, `application`: `POINT` (member end node; kN) | `MEMBER_DISTRIBUTED` (uniform over the full member, per unit member length; kN/m) | `AREA` (recognised and rejected as unsupported); `direction` `GLOBAL_X|GLOBAL_Y|GLOBAL_Z`; signed magnitude; provenance `USER_PROVIDED`.
- Self-weight: generated per member as uniform −Y `ρ·g·A` only when requested; per-case status `INCLUDED|NOT_REQUESTED`.
- Combination: key, `profile: 'PROJECT_DEFINED'`, `codeCompliance: 'NOT_CLAIMED'`, terms `{ loadCaseId, factor, provenance: 'USER_PROVIDED' }`; factor finite, non-zero, |f| ≤ 10; a case appears at most once. Results are the linear superposition of validated case results (`method: 'LINEAR_SUPERPOSITION'`, valid because the analysis is linear).

## 10. Supports and topology

Support types: `FIXED` (all 6 DOF), `PINNED` (UX, UY, UZ), `ROLLER` (UY), `CUSTOM` (explicit DOF list). Supports target a member end node and are `USER_PROVIDED`; `autoSupports: { rule: 'BASE_OF_COLUMNS_AT_LOWEST_ELEVATION', type }` creates supports with provenance `ASSUMED`. Topology checks (builder and, separately, the validator): unknown references, zero length, duplicate members (same node pair), overlapping collinear members, duplicate supports, nodes lying inside other members (members are split there into analysis segments), members on different axes whose axes cross strictly inside both spans with no node at the crossing (rejected as ambiguous; audit repair A03), every connected component must contain a support, dangling unsupported member ends reported as warnings. Room adjacency is never used.

## 11. Analysis model and adapter

The solver-neutral model lists nodes (mm), segments (E, G, A, Iy, Iz, J, local-axis reference), restraints and per-case nodal/member loads (N, N/mm, global) with declared units; it is hashed (`analysisModelHash`). Adapter contract:

```ts
interface StructuralSolverAdapter {
  metadata: { name; version; adapterVersion; settings };
  capabilities: { analysisTypes; elementFormulations; loadTypes; maxDof };
  validateInput(model): string[];          // capability/limit diagnostics
  analyze(model, { deadline }): unknown;    // raw output, untrusted
}
```

Reference solver: direct stiffness method, 12-DOF Euler-Bernoulli 3D frame element, consistent fixed-end forces for uniform loads, reverse Cuthill–McKee node ordering, skyline LDLᵀ factorisation shared by all load cases, relative pivot threshold 1e-9 (`STRUCTURAL_SYSTEM_UNSTABLE`), relative residual check 1e-8 (`STRUCTURAL_SOLVER_FAILED`), deadline checks (`STRUCTURAL_ANALYSIS_TIMEOUT`). Local axes: x = start→end; reference global +Y, or global +X for vertical members; z = x × ref, y = z × x.

## 12. Results

Raw output (N, mm, N·mm, rad) is validated for solver identity, input hash, counts, finite values and shape before use. Result sets (each load case and combination) contain node displacements, support reactions (kN, kN·m) and member internal forces at stations 0, ¼, ½, ¾, 1 of each analysis segment (local N, Vy, Vz, T, My, Mz on the positive cut face). Extremes between stations are not reported.

## 13. Independent validation

`validate.ts` never imports `model.ts`, `analysis.ts` or the solver. It re-derives member geometry, node set, identities, supports, loads and combinations from the architectural source and the input; checks unit literals, finite values, binding and versions; recomputes connectivity with union-find; and for results checks reference completeness, units header, binding/hash/solver identity, and global force and moment equilibrium of every result set from the *semantic* loads (resultants at member midpoints, self-weight ρ·g·A·L) against reported reactions. Tolerances: |ΣF| ≤ 1e-6·max(1, Σ|F|) kN, |ΣM| ≤ 1e-6·max(1, Σ|r||F|) kN·m.

**Audit repair (validators v2, see `docs/phase24-audit-repair/REPAIR-REPORT.md`).** Equilibrium cannot determine an indeterminate elastic response, so `structural-result-validator-v2` additionally checks, per segment and result set: every station (not only the ends) against the uniform member load, with tolerances from trusted scales (1e-6 × Σ|applied load| kN, × model extent for kN·m); constitutive compatibility, i.e. six closed-form integrals of the station diagram with the member's own E, G, A, Iy, Iz, J that must reproduce the relative end displacements and rotations (1e-6 relative to the largest term); zero reactions on unrestrained DOFs; and combinations equal to the superposition of their cases. `validateRawOutput` checks the discarded J-end half of each raw 12-vector by element statics. `structural-model-validator-v2` adds segment-pair crossing detection and full section (shape, dimensions, derivation method, key) and mass-status agreement. Fully restrained systems (zero free DOFs) are analysed; derived per-case member-load expansion is preflighted against `EXPANDED_MEMBER_LOADS` = 6000 in the builder (`STRUCTURAL_RESOURCE_LIMIT`).

## 14. Staleness

Snapshots are bound to one revision. On read, an analysis is `CURRENT` iff its revision is the project's current revision, else `STALE`. `GET .../structural/status` for revision R lists R's analyses and the latest analyses of other revisions as `STALE` for R; `requiresNewAnalysis` is true when R has none. Results are never reused across revisions (equivalence is not claimed even for identical geometry). `?require=current` makes a read fail with `409 STRUCTURAL_RESULT_STALE`.

## 15. API

Under `/api/projects/:projectId/revisions/:revisionId/structural`: `POST /validate`, `POST /analyses`, `GET /analyses`, `GET /analyses/:analysisId`, `GET /status`. Details in `phase24-api.md`.

## 16. Database (`0014_structural_analyses.sql`)

`public.project_revision_structural_analyses`: one row holds metadata and the full snapshot, so metadata cannot exist without results. Revision FK + accepted-QA FK, versions, model/input/analysis-model hashes, solver identity, `status = 'VALIDATED'`, `snapshot_json` (≤ 10 MB, column/JSON consistency checks), `unique(project_revision_id, input_hash)`, immutable trigger, owner-only RLS select, no direct client writes. `structural_write` (signed envelope, ownership, accepted QA, recomputed modelHash and generation identity, idempotency receipt, advisory lock; concurrent identical requests converge on one row) and `structural_read` (`get`/`list`/`status`). The idempotency operation check gains the analysis route. Historical migrations are untouched.

## 17. Limits

| Limit | Value | Basis |
|---|---|---|
| input bytes | 524 288 | route body limit; a full native frame input is far smaller |
| materials / sections | 32 / 64 | |
| members | 800 | BIM profile ≤ 200 walls ⇒ ≤ 200 beams + ≤ 400 wall-end columns |
| supports | 800 | |
| load cases / loads per case / total loads | 8 / 1000 / 2000 | |
| combinations / terms | 16 / 8 | |
| analysis segments | 4000 | |
| skyline entries | 4 000 000 (32 MB) | checked before allocation |
| solver deadline | 10 000 ms | |
| output bytes | 9 000 000 | below the 10 MB DB check |
| magnitudes | point ≤ 1e5 kN, line ≤ 1e4 kN/m, E 1–1e6 MPa, density 1–30 000 kg/m³, section dims 1–10 000 mm | |

## 18. Security and quotas

Every route authenticates (`requestContext(..., true)`); ownership is enforced by the owner-scoped revision read and again inside SECURITY DEFINER RPCs (project owner, revision ∈ project, analysis ∈ revision; otherwise 404). Both POSTs are in the `generate` quota bucket; GETs use `read`. Errors use the existing redacted envelope. Route templates join the Sentry allowlist. Logs carry request ID, analysis ID, solver identity, status, duration and counts only.

## 19. AI and conversation boundary

No AI provider, conversation tool or workflow step can create structural inputs or analyses. Phase 20/21 code is unchanged.

## 20. Testing

Unit (`structural.test.ts`): units, schemas, identities, mapping, materials, loads, cases, combinations, supports, topology, adapter, analytical fixtures (simply supported beam, cantilever, axial column, two-span continuous beam, pinned portal frame by statics, biaxially loaded cantilever column), output validation, binding, determinism, adversarial fixtures, limits, all native fixture families. Integration (`structural.integration.test.ts` + shared `structural-acceptance.ts`, also run against local Supabase): DB constraints, RLS, signature forgery, upgrade from 0013, concurrency, API, authorization, quotas, idempotency, staleness across an actual west-wing edit.

## 21. Compatibility

No change to Building Model V2, BIM, IFC, takeoff, freshness DTOs, historical migrations or identities. Existing tests change only where they enumerate the public table inventory and registered route templates.

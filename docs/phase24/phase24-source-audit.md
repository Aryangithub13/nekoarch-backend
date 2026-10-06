# Phase 24 source audit

Audited source: `208d56c264f4425022831c8d78d27fd9e4e023b6` (`codex/phases-1-23-audit-repair`), branched to `phase24/structural-engineering` with no source change. All 339 tracked source files byte-match `docs/backend-repair-1-23/evidence/final/tested-source-sha256.json`, so the repair run's final gates (build, typecheck, lint, every `test:*` suite, `test:supabase`, `db:test`, `check`, BIM benchmark, IfcOpenShell round-trip, Docker build/smoke/acceptance; all exit 0) are the Phase 24 baseline. `docs/backend-repair-1-23/` is untracked repair evidence owned by the repair run; Phase 24 does not modify or commit it.

## Startup gate

| Check | Result |
|---|---|
| Phase 23 checkpoint | tag `backend-v1-phase23-complete` → `da5f3ca`; `main` → `ddf08f8` |
| Repair state | 7 repair commits on top of `main`; D01–D21 and R01–R06 all carry verdicts (19 fixed+verified, 2 already fixed, 3 intentional, 2 documented product limitations, 1 environment issue) |
| Active repair work | none; final runner completed with `sourceUnchanged: true` for every gate |
| Decision | proceed on a dedicated branch from the repair head; no history rewrite, no tag movement |

## Existing contracts

| Area | Source | Facts relevant to Phase 24 | Classification |
|---|---|---|---|
| Building Model V2 | `packages/shared/src/building-v2/*` | Integer millimetres (`CoordinateMmSchema`, ±100 km); `x-right-y-up-z-depth`; walls are centerline segments with nullable thickness/height/base offset; levels carry `elevationMm` and nullable `floorToFloorHeightMm`; slabs carry footprints and thickness; `columns` exist in the shape but are never generated and are rejected by BIM | REUSE (read only) |
| Unit helpers | `building-v2/units.ts` | Exact decimal → mm conversion for display units only; no force/stress/mass units exist | REFERENCE (engineering units are a separate module) |
| BIM projection | `apps/api/src/bim/{core,project}.ts` | `bim-semantic-v1`; bounded profile (≤2 storeys, ≤200 walls, orthogonal geometry, **no columns**); runs independent blueprint QA; deterministic `semanticId(projectId, role, sourceId)`; binding = project/revision/modelHash/generation/requirements/parameter hashes | REUSE (`readBim`, `semanticId`, `digest`) |
| BIM validator | `apps/api/src/bim/validate.ts` | Independent of the builder; re-derives inventory from source | REFERENCE (pattern for structural validator) |
| BIM properties | `bim/properties.ts` | Physical elements carry `engineering: not_evaluated`; materials are labels only (`specified`/`unspecified`) | DO_NOT_TOUCH (structural data never alters `bim-semantic-v1`) |
| IFC | `bim/ifc.ts` | `nekoarch-ifc4-architectural-v1`, architectural only | DO_NOT_TOUCH |
| Revisions | `0006_projects.sql`, `project-repository.ts` | Immutable revisions + accepted QA anchor; `projects.current_revision_id`; `project_private.immutable_revision()` trigger | REUSE |
| Identity | `lib/generation-identity.ts`, `0011` | `modelHash = sha256(canonical{identityVersion, canonicalBuilding(model)})`; PostgreSQL recomputes it with `project_private.cost_hash` + `canonical_building` | REUSE (DB-side revision binding) |
| Quantities | `packages/quantity-takeoff` | Authoritative architectural takeoff | REUSE via BIM; structural quantities (member length, section area, volume, mass) are a separate explicit definition |
| Persisted artifacts | `0007` takeoffs, `0008`, `0009` | Immutable table, owner-only RLS select, HMAC-signed `SECURITY DEFINER` write RPC, receipt + advisory lock convergence, keyset pagination | REUSE pattern |
| Idempotency | `lib/idempotency.ts` `durableCommand`, `idempotency_records` operation check (last set in `0010`) | Receipt in the same transaction as the artifact | EXTEND (new operation added by a new migration) |
| Freshness | `contracts/freshness.ts`, `0011` | Strict `{takeoff, construction, cost}` DTO | DO_NOT_TOUCH (structural staleness is a separate endpoint) |
| HTTP | `app.ts`, `routes/*` | Fastify; `requestContext(request, backend, true)` authenticates then consumes quota; `parseRequest` → `VALIDATION_ERROR`; `ApiError` envelope with request ID; route templates under `/api/projects/:projectId/revisions/:revisionId/...` | REUSE |
| Quotas | `lib/http-protection.ts` | `generate` bucket is an explicit route list; other POST = `write`, GET = `read` | EXTEND (structural POSTs join `generate`) |
| Telemetry | `lib/sentry.ts` | Explicit route-template allowlist; `hardening.test.ts` enumerates every registered route | EXTEND (add structural templates) |
| Test infrastructure | `test-support/postgres.ts`, `pg-backend.ts` | Embedded PostgreSQL with all migrations + real RLS roles; `scripts/test-local-supabase.mjs` + `supabase.live.test.ts` run acceptance suites against the local Supabase stack; pgTAP in `supabase/tests/rls.sql` | REUSE/EXTEND |
| Inventory tests | `supabase/tests/rls.sql`, `supabase/tests/database.test.ts` | Pin exactly sixteen public tables | EXTEND (deliberately 17) |
| Runtime | `Dockerfile` | Copies all of `apps/api/src`; non-root `node`; `npm prune --omit=dev` | REUSE (no change needed) |
| AI/conversations | `apps/api/src/ai/*` | Providers only propose native architectural edits | DO_NOT_TOUCH (no structural authority) |
| Workflows | `apps/api/src/workflows/registry.ts` | D15: registry intentionally excludes BIM/IFC | DO_NOT_TOUCH |

## Existing solver-related code

The only "solver" is the Phase 19 layout solver (`packages/generator/src/solver-v2`), an architectural space-planning search. There is no structural, finite-element or linear-algebra code and no numerical dependency in the lockfile. Phase 24 therefore needs its own bounded reference analysis path.

## Structural-like existing elements

| Element | Native status | Phase 24 consequence |
|---|---|---|
| Walls | Orthogonal centerline segments, thickness/height known in generated models | May supply analytical axes *only* through an explicit mapping rule; never automatically load-bearing |
| Slabs / roofs | Footprints are on wall outer faces (slab edge x=1000 vs wall centerline x=1100) and mostly L-shaped | Not represented as analysis panels in Phase 24 (no shell model; area loads unsupported) |
| Columns | Schema field exists; never generated; BIM rejects any column (D10) | Native columns cannot be a structural source in the bounded profile |
| Specifications / materials | Labels only (`"Masonry"`) | Never used to infer strength, stiffness or density |

Observed geometry in the setback L fixture: wall heights are 2850 mm against 3000 mm storey heights (slab underside), and level-1 setback walls (x = 9400) do not stack on level-0 walls (x = 9900). A structural model built from walls therefore needs an explicit analytical idealisation (storey-top reference plane) and topological checks for transfer conditions; room adjacency cannot be used.

## Inherited constraints

- Phase 22/23: parametric edits create new immutable revisions; BIM identities are role/source based and must not change.
- Repair: migration `0013` is the latest; historical migrations are byte-frozen; readiness requires `PROJECT_COMMIT_SECRET`.
- Resource limits are explicit constants checked before expensive allocation (`BIM_LIMITS`, `bounded()` iterative preflight).

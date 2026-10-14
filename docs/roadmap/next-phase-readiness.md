# NekoArch Next-Phase Readiness

| Field | Value |
|---|---|
| Revision | **r3, 2026-10-13: PR #16 update (§9).** r2 text is unchanged except where marked *[r3]*. **r2, 2026-10-13.** Re-based on the authoritative roadmap. r1 (`4fb5919`) recommended a "Phase 39 slice 1: AI capability foundation"; that recommendation is **withdrawn** (§1.2) |
| Authoritative roadmap | [`docs/sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md`](../sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md) (sha256 `0ebc4479…3a03`), cited as ROADMAP Lnnn |
| Baseline | r2: `phase31/development` @ `ea2b5d0c0533e7e3f682b42a029fef7c0b3f5359`. *[r3]* Re-inspected at `d0cd38bc043d692b87b4a73204d1f7e2cb7600fc` (PR #16 merged); see §9 |
| Date of inspection | 2026-10-13 |
| Inputs | [authoritative-roadmap-reconciliation.md](authoritative-roadmap-reconciliation.md) r2 (§4.3, §7); [post-audit-risk-register.md](post-audit-risk-register.md) r2 |
| Status | **Recommendation only; nothing is authorized.** Acceptance criteria are labelled **ROADMAP** (quoted or condensed from the roadmap, with line) or **PROPOSED** (a measurable test added here; not roadmap text) |

## 1. Recommendation

### 1.1 Next step

**Next implementation step: a B37 completion slice. Then B39.** *[r3] Unchanged after PR #16. The sequence is: finish B37, implement and verify B39, then begin B40 (§9.2).*

**Why:**
1. **B39 is the next new roadmap phase** (ROADMAP §C L446; §I S7 L728), and its gate is explicit:
   > "Execute one supported request for each of six modules using real backend adapters; show common revision IDs and invariant locks; feed resulting changes to shared **B37 manifest** and affected-cost/engineering freshness checks." (L297)
2. **The B37 manifest does not exist yet.**
   - B37 requires a "Unified Project Manifest v2" (L257).
   - It also requires formal invalidation states `current, stale, pending, blocked, not_applicable, verified` (L251).
   - The baseline has `project-overview-v1` and `dependency-graph-v1`, whose states differ (R23).
3. **§I rule 4 (L736):** "B37 dependency propagation prevents changes from leaking across BIM, structure, MEP, quantities, cost and reports; until then block unsupported impact or mark outputs stale."
4. **The B37 completion slice is small and low-risk:**
   - derived on read;
   - no provider, credential or spend;
   - no migration expected (PROPOSED; to be confirmed by its scope document).
5. **B39, B40 and B41 all consume the B37 manifest** (L297, L311, L330 "durable conversation links to … current accepted/candidate revision"). Building it once avoids three incompatible variants.

**Alternative (owner choice):** start B39 now and treat `project-overview-v1` + `dependency-graph-v1` as the "B37 manifest" for its gate. The roadmap wording (L257 "Evolve the Phase-29 overview into a Unified Project Manifest v2") does not support this, so it would be an owner waiver. Record it if chosen.

### 1.2 Withdrawn from r1

| r1 recommendation | Roadmap evidence | New owner |
|---|---|---|
| "Phase 39 slice 1: AI capability foundation" (capability descriptor registry, versioned prompts, golden evaluation, privacy floors) | B39 is six specialist workflows that **reuse deterministic engines** and forbid "LLM invented dimensions" (L292). The capability registry, per-operation schema checks, provider evaluation and privacy/region routing are **B43** (L357–371) | **B43** (groundwork may be done earlier as a separate, approved slice; §6) |
| "Phase 40 = audit, may run in parallel with 39" | B40 = Autonomous Large-Scale Project Integration, which consumes B39 (L300–315) | B40 is sequential after B39. Audit work maps to release slice S0 (L721) and B46 |

### 1.3 Why not another phase first

| Candidate | Why not next | Evidence |
|---|---|---|
| Finish B36 (solver kinds, remote, fan-out/fan-in, cache, sweeper) | Needs owner decisions D1–D7 and validated solvers (none exist). B39 can proceed with typed `requires_review` / `unsupported` statuses for the Structural module | R18; ROADMAP L242, L293 |
| Finish B38 (sections/elevations, PDF/DXF) | Not a B39 prerequisite. A PDF/DXF dependency needs an owner decision | R24 |
| B31 malware scanning, B32 sweeper | Required for production uploads and jobs (S3, S4). Not a code prerequisite of B37/B39 | R25, R26 |
| B40, B42, B43 | Depend on B39 (L311, L735) or on B43's routing/evaluation stack | ROADMAP §I |
| B44 | Touches every owner-scoped RLS policy and RPC (`0006`–`0027`) | — |
| B45, B46 | B45 precedes B46 (L737). B46 needs a deployed backend (L427) | — |

## 2. Decisions required before implementation begins

| # | Decision | Recommended default (PROPOSED) |
|---|---|---|
| D-1 | Adopt this reconciliation (r2) and carry `docs/sources/` and `docs/roadmap/` into `phase31/development` through a docs-only PR | Yes |
| D-2 | B37 completion slice first (§1.1), or the waiver alternative | B37 completion first |
| D-3 | Merge `phase37/read-cap` (`0bf1c89`) before extending B37 (R14) | Yes, after review and CI |
| D-4 | For B39: confirm the module order in §5.2 and the interior meaning (finishes and furnishings as specifications on V2 spaces, per L289) | As in §5.2 |
| D-5 | Release-only gates, not blocking development: hosted check (R03), Supabase acceptance for `0026`/`0027` (R04; *[r3]* now `0026`–`0028`), staging proof (R28) | Schedule with an authorized operator |

## 3. Pre-implementation checklist (PROPOSED)

1. Base the branch on `phase31/development` @ `ea2b5d0` or later, never on `main` (R22).
2. Read the roadmap's B37/B39 sections, §D rows 13–17 and 23 (L478–488), §E (L509–585) and §I (L717–738).
3. Write `docs/phase37/phase37-completion-scope.md` before code, as the B37/B38 sessions did. Mark each criterion ROADMAP or PROPOSED.
4. Preserve all historical tags, migrations and paths. Labels such as "phase36-conversational-ai" are kept (C3).

## 4. B37 completion slice

### 4.1 Scope (ROADMAP L248–262, condensed)

- Unified Project Manifest v2.
- Formal invalidation semantics with reason codes and source/target revision identity.
- Per-discipline freshness.
- "Every module resolves one coherent accepted/candidate revision".
- Machine-readable `diff`, `lineage`, `source`, `units`, coordinate system, `completeness`, `last_verified` and `missing_reason` metadata.

### 4.2 Acceptance criteria

| ID | Criterion | Basis | Measured by (PROPOSED) |
|---|---|---|---|
| M1 | Manifest v2 exposes: project and revision identity; canonical building/site and coordinate frame; editable vs derived artifacts; capability/configuration; module availability; per-discipline freshness; verification status; access policy | **ROADMAP** L257 | Zod contract; integration test per field family |
| M2 | Invalidation states `current, stale, pending, blocked, not_applicable, verified`, each with reason codes and source/target revision identity | **ROADMAP** L251 | Contract test. A documented, tested mapping from `dependency-graph-v1` states; `UNVERIFIED` stays fail-closed (never mapped to `verified` or `current`) |
| M3 | One coherent revision per manifest: no module mixes accepted revision N with candidate N+1 | **ROADMAP** L258; scenario 17 (L747) | Test that commits a revision during manifest assembly and expects a refusal or consistent output (reuse the Phase 37 two-round consistency check) |
| M4 | Gate: any accepted targeted edit identifies all dependent outputs needing regeneration, revalidation or stale labelling; no lost model↔3D linkage | **ROADMAP** L262 | Exterior-appearance edit fixture (B30): every derived artifact of the base is reported stale with a reason; scene artifacts are linked by revision and model hash |
| M5 | Additive only: `project-overview-v1`, `dependency-graph-v1`, Phase 38 documents and evidence responses unchanged | **ROADMAP** A4 L51; §D upgrade workflow L504 | Existing `overview`, `dependency-graph*`, `documents*`, `evidence*` tests unchanged |
| M6 | Bounded reads (no more than 8 in flight per request, as in `0bf1c89`) and a time budget | PROPOSED (R14) | In-flight counter test |
| M7 | Engineering flags unchanged; the manifest never upgrades `REQUIRES_SOLVER`, `NO_VALIDATED_SOLVER`, `NOT_CLAIMED` | **ROADMAP** A4 L50; H L710 | Byte-identical assessment fields in the manifest fixture |
| M8 | Release gates: build, typecheck, lint, full suite on Node 22.22.0 and 22.23.3, container smoke, `npm audit --omit=dev --audit-level=high`, route catalog and OpenAPI drift | **ROADMAP** §K L788 (tests); PROPOSED commands | CI on the PR head |
| M9 | Phase tag and staging proof | **ROADMAP** §K L788 | Owner-authorized; recorded as pending if not done (R28) |

### 4.3 Migration

None expected: the manifest is derived on read from existing owner-scoped reads (PROPOSED). If the scope document finds that a persisted manifest is required, that is a new migration needing owner approval (next free number: `0028`; *[r3]* `0028` is now taken by PR #16, so the next free number is `0029`; see §9.3).

## 5. B39 (after B37 completion)

### 5.1 Scope (ROADMAP L285–297)

- One typed specialist request envelope covering: project and base revision, scope and locks, references, output configuration, provenance, quote and budget, jobs, dependency impacts, and the immutable candidate/approval lifecycle.
- Six modules: Interior, Exterior, Blueprint, Structural, Materials, Budget.
- Reuse of B6/B10/B19/B22/B24–B28 engines and the B30 guards.
- Typed statuses: `unsupported`, `requires_review`, `degraded_provider`, `stale_dependency`, `partial`.

**Gate (L297):** see §1.1. Scenarios 33–38 and 46 (L763–768, L779).

### 5.2 Module readiness on the baseline (VERIFIED components; order PROPOSED)

| Order | Module | Existing engine | Gap | Expected status vocabulary |
|---|---|---|---|---|
| 1 | Blueprint | B10/B19/B22 generators; B11 QA; B34 verifier | Envelope adapter. Limited to 2 floors and 24 rooms (`BLUEPRINT_LIMITS`) | `unsupported` above 2 floors |
| 2 | Materials | B13 takeoff; B14 recipes | Envelope adapter; substitution provenance | `partial` when a recipe is missing |
| 3 | Budget | B15 BOQ | Rates are synthetic or user-supplied only (R13). "Absence of rates is not represented as zero" (L768) | `partial` / `requires_review` |
| 4 | Exterior | B30 exterior appearance (`APPEARANCE_MODIFY`, 4 façades) | Massing "only where supported" (L289): unsupported | `unsupported` for geometry changes |
| 5 | Structural | B24 bounded frame solver; B35 blockers | No validated solver (R12, R18) | `requires_review` / `unsupported`. Never certified (L290) |
| 6 | Interior | **No interior operation exists.** The conversational design records "no operation for … interior finishes" (`docs/phase36-conversational-ai/phase36-report.md` §6) | New typed operation over V2 space specifications | `unsupported` until implemented |

### 5.3 Migration requirements (evidence-based; not authorized)

| Need | Evidence | Migration |
|---|---|---|
| Persist an interior-finish (or other new) specialist operation as a revision operation | `0020_revision_operations.sql:9` `kind text check (kind in ('APPEARANCE_MODIFY','RESTORE'))` | A forward migration re-creating the check as a superset (`0028`, if first; *[r3]* `0029` at the earliest, and only with schema evidence; see §9.3) |
| Run specialists as durable or gateway jobs | `0022_durable_jobs.sql:8` and `0025_compute_gateway.sql:10` constrain `kind` with SQL `check` lists | A forward superset migration |
| Synchronous, derived-on-read modules (Blueprint, Materials, Budget reading existing artifacts) | Existing routes and tables | None expected |

Each migration needs: owner approval, a migration-replay pin (`supabase/tests/database.test.ts`), a local Supabase receipt, and no hosted application without authorization.

## 6. Later, separately approved: B43 groundwork (relocated from r1)

These items remain valid technical findings (R05–R10). Under the roadmap they belong to **B43** (L357–371) and B41. They can be scheduled as a distinct, approved slice. They are **not** part of the next step:
- the capability registry;
- versioned prompts;
- privacy floors;
- per-operation schema checks;
- offline golden evaluation;
- spend ledger.

## 7. Two-account allocation (PROPOSED)

| | Account A | Account B |
|---|---|---|
| Work | B37 completion slice (code) | B39 **scope document only**: envelope contract against §E (L509–585); module inventory (§5.2); migration plan (§5.3). No code |
| Branch | `phase37/manifest-v2` from `phase31/development` | `phase39/scope` from `phase31/development` |
| Owns | `apps/api/src/{graph,services/dependency-graph-service.ts,services/overview-service.ts,contracts/dependency-graph.ts}` plus new manifest files; generated `docs/modernization/*.json`; `lib/http-protection.ts`; Sentry allowlist | `docs/phase39/**` only |
| Migrations | None | None (it plans `0028`, *[r3]* now `0029`; does not write it) |
| Order | Merge after CI and owner review | Docs PR any time. B39 implementation starts after A merges |

Not recommended in parallel: B39 code before the manifest v2 contract exists (shared contract), and anything touching RLS (B44).

## 8. What remains unverified before implementation

- The B31–B34 quote provenance (C9) and B01–B04 Git evidence: these do not block.
- Hosted database state, Supabase acceptance for `0026`/`0027` (*[r3]* and `0028`), staging proof: these block release, not development.
- Frontend contract conformance (the frontend repository was not inspected).
- Whether the owner waives the B37 manifest v2 requirement for B39 (D-2).

## 9. r3 update: PR #16 and the B39 scope correction (2026-10-13)

### 9.1 What changed on the development branch (VERIFIED)

- **PR #16 merged.** `phase31/development` moved from `ea2b5d0` to `d0cd38b` (merge of PR #16, tested head `99fe815`). It was labelled "Phase 39" and was planned before this roadmap reached the development branch.
- **Classification under the roadmap:**
  - **B43 groundwork:** capability-typed routing over the Phase 21 policy, and `PROVIDER_OUTPUT_UNSAFE`. This is the r1 "AI capability foundation" that §1.2 relocated to B43, delivered in part.
  - **B41/B43 groundwork:** consumption of brief fields and reference metadata.
  - **Reusable for B39:** partial, advisory Interior/Exterior concepts. They are **not** the B39 modules.
  - **Supporting persistence:** migration `0028_design_concepts.sql`.
- **Full record:** [phase39-scope.md §0](../phase39/phase39-scope.md#0-classification-under-the-authoritative-roadmap-correction-r2).
- **B39 stays NI (not implemented).** Missing: the Blueprint, Structural, Materials and Budget specialists; the shared typed request envelope; the typed statuses `unsupported` / `requires_review` / `degraded_provider` / `stale_dependency` / `partial`; the candidate/approval lifecycle; B37 manifest and freshness integration; and the L297 gate.
- **CI** (both green; **CI passing does not complete a phase**):

  | Run | Commit | Node 22.22.0 and 22.23.3 | Container smoke |
  |---|---|---|---|
  | 38434523761 | `99fe815` | 104/104 files, 3,021/3,021 tests each | Passed |
  | 38436385119 | `d0cd38b` | 104/104 files, 3,021/3,021 tests each | Passed |

### 9.2 Sequence (unchanged by PR #16)

1. **B37 completion** (§4): Unified Project Manifest v2, invalidation states, per-discipline freshness. Risk R23 is still P0 for B39. *Owner alternative:* a recorded waiver (D-2).
2. **B39: implement and verify** (§5) against ROADMAP L297.
   - Reuse from PR #16 where it fits: the output guard, the persistence and charge-protection pattern, and the advisory Interior/Exterior content as a sub-output.
   - The modules themselves must reuse the deterministic engines and B30 guards (L292).
   - Decision D-6 below.
3. **B40** only after B39's gate is met: B40 "consume[s] the six tested specialist operations delivered at B39" (L311; §I rule 3, L735).
4. **B43 routing work** stays a separately approved slice (§6). PR #16 does not complete it.

### 9.3 Migration numbering

- `0028` is taken by `0028_design_concepts.sql`. The next free number is **`0029`**.
- **No `0029` is approved or automatic.** It is a possibility only if a scope document shows schema evidence. Examples are the `0020` revision-operation `kind` check (§5.3) or the `0022` / `0025` job-kind checks.
- Like every migration it needs owner approval, a migration-replay pin, a local Supabase receipt, and no hosted application without authorization.

### 9.4 Release gates (separate from development; none has passed)

| Gate | Scope | Evidence on record |
|---|---|---|
| Local Supabase acceptance | Migrations `0026`, `0027`, `0028` | **None.** The `supabase-acceptance` job is `workflow_dispatch`-only and was skipped in runs 38434523761 and 38436385119 |
| Hosted migration-history verification | Read-only, by an authorized operator (R03) | **None.** Hosted state is REPORTED at `0017`; `0018`–`0028` are unverified |
| Staging proof of at least one live user workflow | ROADMAP L788 | **None** |
| Phase tag | ROADMAP L788 | **None.** No tag contains `d0cd38b`, and no B39 tag is appropriate while B39 is not implemented |

### 9.5 Decisions

- **D-1 (proposed by the documentation PR that adds this section).** Carry `docs/sources/`, `docs/roadmap/` and the linked AI audit into `phase31/development` byte for byte. Blob ids equal those on `main` @ `5472193`. Owner merge is required.
- **D-6 (new).** Accept the §9.1 classification of PR #16, and state whether B39 should reuse the design-concept routes as an advisory sub-output or supersede them with the specialist envelope.
- **D-7 (new; proposed, not implemented).** Optional runtime clarification in discovery, so a client cannot mistake `INTERIOR_DESIGN_CONCEPT` / `EXTERIOR_DESIGN_CONCEPT` (`AVAILABLE`, `advisory: true`) for the B39 F49/F50 modules.
  - **The change:** an additive field on each `aiCapabilities` entry, `{ maturity: 'ADVISORY_PRECURSOR', specialistModule: null }`, and on the `DESIGN_CONCEPTS` service, `{ roadmapStatus: 'NOT_B39_SPECIALIST' }`.
  - **What it touches:** an API-contract change requiring regenerated OpenAPI and updated discovery tests.
  - **Interim:** [the design-concept API reference](../phase39/phase39-api.md#frontend-guidance-what-discovery-does-and-does-not-mean) gives documentation-only frontend guidance.

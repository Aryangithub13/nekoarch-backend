# Phase 30 report — selective revision & regeneration engine

**Final status: PHASE 30 FULLY IMPLEMENTED AND VERIFIED WITHIN SUPPORTED SCOPE.** The supported scope is exterior wall finish appearance, restore, compare, approve, reject and cancel. Two verification items outside the backend are recorded under section L: frontend adapter verification is blocked, and the local Supabase stack run was not authorized.

## A. Executive summary

A user can now ask in natural language, for example *"Redesign the exterior … glass-inspired façade. Keep the exact floor plans, rooms, stairs, structure, dimensions and interior unchanged"*. NekoArch then:
1. **Interprets** the change and the preservation requests deterministically.
2. **Plans** exactly which canonical exterior walls (with BIM ids) may change and what is locked, reused or blocked, with a truthful zero-external-cost quote.
3. **Executes**, after explicit consent, a bounded worker job. The job compiles the unchanged Phase 29 scene, applies a material-only pass and independently proves that every geometry byte is unchanged.
4. **Stores** a clearly unaccepted candidate and serves a comparison for review.
5. **Commits**, only on explicit approval of that exact candidate, an immutable new revision. It goes through the existing `project_write` path inside one SQL transaction, with stale-base protection.

Any accepted design can be restored as another new revision. Accepted revisions are never edited. Geometry, interior and physical-glazing requests are refused or clarified, never silently reinterpreted.

## B. Source baseline

| Item | Value |
|---|---|
| Phase 29 release | `backend-v1-phase29-complete` → `c7e4bc0` (ancestor of the base) |
| Modernization | `backend-v1-modernization-phases-1-29` → `7ce84fc`; follow-ups → `a8a0861` |
| Phase 30 base | `bb17949` (code + evidence; newest preserved checkpoint) |
| Branch / worktree | `phase30/selective-revision` / `designflow-phase30` |
| Protected artifacts | Migrations 0001–0019, Phase 23–29 evidence and all historical tags are untouched ([evidence/tags-before.txt](evidence/tags-before.txt)). The default `designflow` worktree (Phase 27) was not used. |

Details: [phase30-source-audit.md](phase30-source-audit.md).

## C. Implementation results

**Domain (`apps/api/src/revision/`):**

| File | Role |
|---|---|
| `contracts.ts` | Zod contracts for the intent, scopes, locks, impacts, preflight, quote, appearance, candidate manifest, validation and comparison |
| `interpret.ts` | Deterministic revision grammar |
| `plan.ts` | Deterministic impact planner and preflight (no compile) |
| `appearance.ts` | Façade orientation and the material-only GLB pass |
| `verify.ts` | Independent validator |
| `job.ts`, `worker.ts`, `pool.ts` | Bounded execution |

**Persistence:** `supabase/migrations/0020_revision_operations.sql`.
- **Tables:** operations, candidate artifacts and blobs, revision appearances, operation events.
- **Database-level guards:** RLS; a transition trigger; immutability guards; signed `revision_operation_write` / `revision_operation_read` `SECURITY DEFINER` functions; the purge function.
- **Idempotency:** the operation whitelist is extended for the new routes.

**Service and routes:**
- `services/revision-service.ts`: preflight, execute, approve, reject/cancel, comparison.
- `routes/revisions.ts`: 13 routes.
- `lib/revision-repository.ts`: typed RPC boundary and error mapping.

**Integration (additive):**
- Capability discovery: `SELECTIVE_REVISION`, `APPEARANCE_VARIANT_3D_MODEL`.
- Project overview: `appearance` and `lineage`.
- Conversation tool `PLAN_REVISION`.
- Sentry safe-route templates and rate-limit groups; CORS unchanged.
- OpenAPI and route catalog regenerated (81 → 94 routes).

**Refactor (behaviour-preserving):** `project-service.ts` now exports `revisionQaReport`/`storedRevisionQaReport`, so approval re-runs exactly the QA derivation of `saveProjectRevision`. `routes/scene.ts` exports its asset sender.

**Algorithms:**
- **Façade facing:** a probe point at thickness/2 + 1 mm, compass by `NORTH_FROM_MINUS_Z_CLOCKWISE_TO_PLUS_X`.
- **Exact-byte geometry lock:** the BIN chunk is copied verbatim and verified identical.
- **Semantic model lock in SQL:** the canonical model hash must be equal at commit.
- **Cumulative appearance:** later assignments win.

## D. Supported revision operations

| User can | How |
|---|---|
| Change exterior wall finish (all façades, specific façades N/E/S/W when north is known and a multiple of 90°, chosen storeys) | Text or structured request. 4 presets with bounded colour/roughness/metallic overrides; opaque. Corner fills follow their walls. |
| Preserve | Floor plans, rooms, stairs, structure, openings, walls, interior, dimensions/geometry (all held by the system model and geometry locks); storeys (excluded from targets); exterior appearance (conflicts are blocked) |
| Review | Preflight (targets, exclusions, locks, impacts, verifications, quote) and candidate GLB/manifest (labelled unaccepted). The comparison carries hashes, changed and preserved objects, material from → to, engineering freshness and blockers. |
| Approve / reject / cancel | Approve names the reviewed candidate hash; atomic commit with stale-base conflict |
| Restore | Any accepted revision's model and appearance, as a new revision |
| Ask in chat | `PLAN_REVISION` previews the preflight read-only |

## E. Scope and engineering limitations

**Unsupported (typed refusals):**
- Interior/room finishes (`INTERIOR_FINISH_NOT_SUPPORTED`): interior wall solids are shared between rooms and face-level materials are not modeled.
- Any geometry change to openings, walls, rooms, structure or storeys (`GEOMETRY_MODIFICATION_NOT_SUPPORTED`, or `BLOCKED_BY_LOCK` when combined with a conflicting preservation). Full geometry regeneration remains the existing requirements/conversation path.

**Clarified, never guessed:**
- Physical glazing ("glass façade") → asks whether a visual appearance or a geometry change is meant.
- Ambiguous floor numbering ("first floor") and unknown storeys → clarification question.
- Façade-specific edits without a known north → clarification question.

**Finishes are visual only.** Glazing, curtain-wall, thermal, structural, product and photorealism properties are `NOT_CLAIMED`. Visual appearance is not an input of any engineering engine, so existing results are reported `SOURCE_EQUIVALENT` (not recomputed, not re-verified).

**Profile and rendering.**
- Inherits the Phase 23/29 profile: ≤ 2 storeys, orthogonal geometry, one straight stair, no columns.
- The Phase 29 accepted-scene routes still compile placeholder appearances. A revision's appearance scene is served by the separate `/appearance` routes.

**Execution.**
- Bounded and synchronous (≤ 20 s, 1 worker, queue 4). There is no durable job progress or restart recovery (Phase 32). An interrupted execute leaves the operation `AWAITING_CONSENT`, which is retryable.
- Generative AI alternatives and scoped AI regeneration are not advertised: no provider capability exists (Phases 39/43).

## F. Independent validation

`verify.ts` re-derives targets independently and requires:
- a byte-identical BIN chunk;
- identical nodes, accessors, buffer views and mesh structure;
- untouched base materials;
- variant factors equal to the finish;
- changed material indices only on the derived targets;
- target source, BIM and level identities equal to the base scene;
- binding and hash consistency;
- a Phase 29-valid base.

**SQL re-checks** candidate bindings (model hash recomputed from the stored base, appearance hash, scene source, SHA of the bytes, `VALID` validation with the exact-byte lock) and the model lock at commit.

**Mutation evidence:** 22/22 mutants killed for the intended reason; equivalent mutants are documented ([phase30-verification.md](phase30-verification.md)). The Khronos validator reports 0 errors and 0 warnings on candidates.

**Preservation proof:** BIM element ids are identical, the BIM diff is all `UNCHANGED`, and the blueprint collections are deep-equal across A → B.

## G. API and frontend compatibility

The 13 routes are documented in [phase30-api.md](phase30-api.md) and the OpenAPI document; all request bodies and JSON responses are typed. The routes are additive; Phase 1–29 routes and contracts are unchanged (route-catalog test plus the full regression suite).

| Frontend area | Backend readiness |
|---|---|
| **F30** Revision & Regeneration | Live backend contracts: preflight, consent/execute, candidate preview, comparison, approve/reject/cancel, restore, validation evidence |
| **F31** Overview | `appearance` + `lineage` |
| **F25/F26/F27** | `PLAN_REVISION` tool, structured operations, base revision binding |
| **F29** | Discovery advertises only the verified operations |
| **F41–F48** | Candidate and appearance GLBs with stable scene/BIM ids |
| **F49/F50** | Exterior appearance supported; interior refused truthfully |

**Real frontend adapter verification: BLOCKED** (repository not on this machine). No frontend code was read or modified, and live integration is not claimed.

## H. Security and database integrity

- **Ownership:** RLS on all 5 new tables; owner checks in every definer function; 404 for foreign resources; no grant on candidate bytes.
- **Signed writes:** an HMAC envelope over the user, the route template, the exact input and the context.
- **State machine** enforced by trigger, with immutable identity columns, immutable committed artifacts/appearances and audit events.
- **Approval transaction:** one transaction with a project-row lock → stale-base check → model-lock check → `project_write` (its own CAS/QA/audit) → appearance → operation `COMMITTED`.
- **Duplicates and limits:** idempotency receipts in API shape; unique `committed_revision_id`; per-project limits (5 active, 60/hour); 24 h expiry and a purge that never touches committed artifacts.
- **Recovery:** a failed or interrupted execute stores nothing. A failed approve rolls back entirely. Rollback of the whole phase means not applying 0020 (additive). Once applied, the new tables can be dropped only if no revision depends on them; appearance revisions are ordinary accepted revisions and stay valid without the layer.

## I. Testing and benchmarks

Final `npm run check`: **77 files / 2 626 tests + 133 + 52, exit 0, no skips** (baseline 75 / 2 568).

| Suite | Result |
|---|---|
| Phase 30 unit | 44 |
| Phase 30 integration | 14 |
| Mutation | 22/22 |

Benchmarks: [evidence/benchmark.json](evidence/benchmark.json), summarized in the verification doc. Key medians: preflight 138 ms, execute 356 ms, approve 187 ms; appearance pass ≤ 5.2 ms and validation ≤ 5.6 ms on the largest fixture; the candidate GLB is only 252 bytes larger than the base.

## J. Git and release checkpoint

The base, final commit, tag and tag verification are recorded in [evidence/checkpoint.txt](evidence/checkpoint.txt). The tree is clean after commit. Nothing was pushed, deployed or charged.

## K. Remaining roadmap dependencies (not started)

| Item | Phase |
|---|---|
| Reference uploads | 31 |
| Durable jobs, progress, restart recovery for revision execution | 32 |
| Per-user budgets/settings | 33 |
| Complex/large/high-rise building verification and supertall | 34–35 |
| Cloud compute | 36 |
| Unified multidisciplinary dependency graph (beyond the bounded Phase 30 impact model) | 37 |
| Documentation exports | 38 |
| Interior/exterior AI modules, generative alternatives, provider routing | 39, 43 |
| Collaboration/review branches | 44 |
| Desktop delivery/LOD and end-to-end benchmark | 45–46 |
| Physical façade/glazing editing with engineering re-validation | Future geometry-editing work (outside Phase 30's scope) |

## L. Final phase status

**PHASE 30 FULLY IMPLEMENTED AND VERIFIED WITHIN SUPPORTED SCOPE.**

Supported by:
- all 16 mandatory scenarios passing on real PostgreSQL, through authenticated HTTP or unit tests where noted;
- 22/22 mutants killed;
- a full regression suite with exit 0;
- unchanged historical artifacts.

Explicitly not covered:
- **Frontend adapter verification:** blocked, the repository is absent.
- **The local Supabase stack run:** not authorized, because it would change shared developer state.

No Phase 31–46 work was started.

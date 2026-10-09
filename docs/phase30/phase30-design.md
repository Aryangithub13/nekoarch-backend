# Phase 30 design — selective revision & regeneration engine

## 1. Principle

A revision operation never edits an accepted revision. It produces a **candidate** that is independently validated and explicitly approved, then committed through the existing immutable `project_write` path as a **new** accepted revision. Visual appearance is a **separate, versioned design layer** bound to a revision. It is never written into Building Model V2, whose `specifications` are architectural facts consumed by quantity and cost engines.

## 2. Supported operation matrix (V1)

| Operation | Status | Notes |
|---|---|---|
| `APPEARANCE_MODIFY`: exterior wall finish | **AVAILABLE** | Presets with bounded colour/roughness/metallic overrides. Target: exterior walls (and their corner fills), optionally by façade (N/E/S/W, when north is known and a multiple of 90°) and by level. |
| `RESTORE` | **AVAILABLE** | Restores a prior accepted revision's model **and** appearance as a new revision. |
| Compare, approve, reject, cancel | **AVAILABLE** | On candidates. |
| Interior/room finish | **UNSUPPORTED** (typed refusal `INTERIOR_FINISH_NOT_SUPPORTED`) | Interior wall solids are shared by two rooms; face-level materials are not modeled. |
| Opening, wall, room, structure or storey geometry changes | **UNSUPPORTED** (typed refusal). With a conflicting lock → `BLOCKED_BY_LOCK`. | The planner still reports the dependencies such a change would invalidate: BIM, quantities, cost, structural, environmental, systems, knowledge, scene. Geometry regeneration remains the existing requirements/conversation path. |
| Physical glazing / curtain wall | **NEEDS_CLARIFICATION** → appearance-only or unsupported | A "glass-inspired" finish is appearance; "glass façade" without an appearance qualifier is ambiguous. |
| Generate alternative / scoped regenerate via AI provider | **Not advertised** | No provider capability exists. Alternatives are separate appearance candidates from the same base. |

## 3. Contracts (`apps/api/src/revision/contracts.ts`)

| Concept | Representation |
|---|---|
| `RevisionIntent` | Parsed request: operation, appearance target/finish, preservation scopes, requested change classes, ambiguities, unsupported items, source text |
| `ScopeTarget` | `EXTERIOR_WALLS{facades, levelIds}` → resolved to canonical wall ids, scene object ids and BIM ids |
| `PreservationLock` | `{ scope, granularity: SEMANTIC_MODEL \| GEOMETRY \| DERIVED_ARTIFACT \| EXACT_BYTES, origin: SYSTEM \| USER }` |
| `DependencyImpact` | Per artifact family: `REGENERATE \| REUSE_SOURCE_EQUIVALENT \| INVALIDATED \| NOT_AFFECTED \| BLOCKED` |
| `PreflightResult` | Intent, base, targets, excluded, locks, impacts, verifications, blockers, questions, quote |
| `ExecutionQuote` | `LOCAL_DETERMINISTIC`, external cost 0 (no provider), data transfer `NONE`, bounded resource estimate |
| `Appearance` | `appearance-v1 { assignments[≤8]: { target, finish } }`, cumulative over the base's appearance |
| `CandidateArtifact` | Candidate GLB plus a manifest wrapping the unchanged Phase 29 base manifest and an appearance layer |
| `RevisionValidation` | Independent validator result, including the geometry-lock evidence |
| `ArtifactDiff` | Comparison payload (§9) |
| `RevisionApproval` / `RevisionCommit` / `RevisionRestore` | Approve request (preflightHash + candidateHash); commit result (operation + new revision) |
| `RevisionAuditEvent` | Rows of `project_revision_operation_events` |

## 4. State machine (persisted, enforced by a SQL trigger)

```text
preflight ─► AWAITING_CONSENT ─execute─► CANDIDATE_READY ─approve─► COMMITTED
          ├► NEEDS_CLARIFICATION (terminal)     │                 └► STALE_BASE (base moved)
          ├► UNSUPPORTED        (terminal)      ├─reject─► REJECTED
          └► BLOCKED_BY_LOCK    (terminal)      └─cancel─► CANCELLED
AWAITING_CONSENT ─► FAILED | VALIDATION_FAILED | STALE_BASE | CANCELLED
non-terminal + expires_at passed ─► EXPIRED   (on any action, or by purge)
```

Omitted states, with justification:
- `DRAFT`, `PREFLIGHT_READY`: a preflight is computed and stored atomically, so "ready" = `AWAITING_CONSENT`.
- `QUEUED`, `RUNNING`, `VALIDATING`: execution is one bounded synchronous worker run (≤ 20 s). Compile and validation complete before any database write, so an interrupted request leaves the operation in `AWAITING_CONSENT`, safely retryable. Durable progress is Phase 32.
- `APPROVED`: approval and commit are one transaction; the approval is recorded on the `COMMITTED` row and in the audit events.
- `BUDGET_EXCEEDED`: there is no external spend. Resource exhaustion surfaces as typed errors (`REVISION_LIMIT_EXCEEDED` 429, pool `SCENE_QUEUE_FULL` 503) and creates no state.

## 5. Preservation locks

Every `APPEARANCE_MODIFY` carries system locks that cannot be removed:

| Lock | Granularity | Enforcement |
|---|---|---|
| Whole building model | `SEMANTIC_MODEL` | SQL at approve: the committed model's canonical hash equals the base model's hash, or the commit is refused. |
| All scene geometry | `EXACT_BYTES` | The validator requires the candidate GLB BIN chunk to be **byte-identical** to the Phase 29 base BIN chunk. |
| Non-target objects | `GEOMETRY` + material | The validator requires unchanged primitive material indices and identical node/mesh/accessor JSON. |
| Engineering artifacts | `DERIVED_ARTIFACT` | Appearance is not an input of any engine; base artifacts are reported `REUSE_SOURCE_EQUIVALENT`, never recomputed or relabelled as verified. |

User preservation phrases (floor plans, structure, stairs, openings, walls, rooms, interior, building dimensions, a level) become `USER` locks:
- Locks on geometry scopes are compatible with appearance edits.
- A level lock excludes that level's façades from the targets; the exclusion is reported.
- A lock on exterior appearance, or on the same façade, conflicts → `BLOCKED_BY_LOCK`.
- A requested geometry change combined with a lock on the same scope → `BLOCKED_BY_LOCK`, with the conflict reported.

## 6. Appearance execution

**Worker job** (`revision/job.ts`):
1. `runSceneJob` (unchanged Phase 29 compile plus independent validator) on the base model.
2. `applyAppearance`: rewrites only the GLB JSON chunk, appending variant materials (`extras.provenance = 'APPEARANCE_VARIANT'`) and re-pointing the material index of target primitives. It copies the BIN chunk verbatim.
3. `verifyAppearance` (`revision/verify.ts`): an independent reader that **derives the target set itself** from the model and appearance (own façade-orientation code) and checks:
   - container validity;
   - a byte-identical BIN chunk;
   - identical non-material JSON;
   - a materials prefix plus the appended variants with exact factors;
   - changed indices = derived targets exactly;
   - manifest bindings/hashes;
   - at least one target (an objectively different artifact);
   - candidate SHA.

**Pool:** a separate pool (size 1, queue 4, 20 s, 512 MiB) with its own worker. Malformed, unvalidated or hash-inconsistent output is a worker failure.

**Façade rule.** A wall's exterior side is the side whose probe point (thickness/2 + 1 mm from the centreline) is outside every space of that level. Its facing is converted to a compass label using the site north convention. A corner fill is a target if any targeted exterior wall on its level ends at it.

## 7. Persistence (migration `0020_revision_operations.sql`)

| Table | Content |
|---|---|
| `project_revision_operations` | Owner via project; base revision FK; kind; status; request/intent/preflight JSON + `preflight_hash` (recomputed in SQL); appearance JSON + hash; restore source; candidate hash; validation; failure; committed revision (unique); timestamps; `expires_at` (24 h) |
| `project_revision_candidate_artifacts` | One per operation: manifest JSON, GLB `bytea` (≤ 16 MiB), SHA verified in SQL |
| `project_revision_appearances` | One per revision: appearance JSON + hash, operation, artifact |
| `project_revision_operation_events` | Audit |

**Invariants in SQL:**
- RLS: owner select on metadata, no grant on bytes.
- Writes only through signed `SECURITY DEFINER` `revision_operation_write`.
- A transition trigger enforces the §4 graph.
- Identity columns are immutable.
- Committed artifacts and appearances are immutable.
- Candidate bytes are deletable only when the operation is not committed (purge).
- Limits: ≤ 5 active operations per project; ≤ 60 created per project per hour.

**Approve** is one transaction:
1. Lock the operation row.
2. Check status `CANDIDATE_READY`, not expired, and matching hashes.
3. Base must be current, otherwise `STALE_BASE` is recorded and a conflict returned.
4. Committed model canonical hash = base hash (appearance) or source hash (restore).
5. Call `project_write('revision', …)`, which does its own CAS, QA gate and audit.
6. Insert the appearance row for the new revision.
7. Set the operation to `COMMITTED` and add an event, with an idempotency receipt.

## 8. API (all under the owner's project; full list in [phase30-api.md](phase30-api.md))

- `POST /api/projects/:projectId/revision-operations` — preflight; `GET` lists operations.
- `GET /revision-operations/:operationId`; `POST /execute | /approve | /reject | /cancel`.
- `GET /comparison`, `GET /validation`, `GET /candidate/manifest`, `GET /candidate/glb` (gzip/304 as for Phase 29 assets).
- `GET /revisions/:revisionId/appearance` (+ `/glb`) — the accepted revision's design layer.

## 9. Comparison

The comparison reports:
- base / candidate / operation ids;
- allowed vs actual change scopes;
- changed and preserved scene objects (with source and BIM ids);
- model hash (equal), BIN SHA (equal), GLB SHAs (different);
- a material summary (from → to);
- quantity/cost: `SOURCE_EQUIVALENT` (the base artifact ids, not recomputed) or `NOT_EVALUATED` when none exist;
- engineering freshness per engine;
- validation and blockers;
- claims: `physicalGlazing`, `materialPerformance` and `thermal` are `NOT_CLAIMED`.

## 10. Threat model (summary)

| Threat | Control |
|---|---|
| Cross-tenant read or approve | RLS + owner checks in every definer function; 404 for foreign resources |
| Forged candidate or binding | Hashes recomputed in SQL from the stored base revision; signed envelopes |
| Validator bypass | SQL accepts only `VALID` validation with the validator version, and recomputes the artifact SHA |
| Geometry change smuggled through "appearance" | Canonical model hash equality checked at approve |
| Replay / duplicate commit | Idempotency receipts; unique `committed_revision_id`; terminal states |
| Stale approval | Base CAS in the operation function and again in `project_write` |
| Resource exhaustion | Per-project limits, bounded pool and queue, size caps, expiry and purge |
| Hidden data transfer | No external provider is used; the quote states `NONE` |

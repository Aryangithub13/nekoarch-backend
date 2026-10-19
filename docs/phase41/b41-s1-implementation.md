# B41 slice S1: grounded instruction resolution

**Status:** implemented and locally verified as a **vertical slice**. **B41 is not complete** (§5).

**Branch:** `phases-40-46`. Plan of record: [b40-b46-implementation-plan.md](../roadmap/b40-b46-implementation-plan.md).

## 1. Roadmap traceability (ROADMAP L318–335)

| Requirement | S1 delivers |
|---|---|
| Parse "change only…", "preserve…", "except…", "undo…", "try another exterior", "reuse the previous floor plan" with explicit target extraction and clarification (L322) | A finite, deterministic grammar (`instructions/grammar.ts`) for each of these forms. "Only" → hard locks on everything a finish edit must not touch. Keep clauses → Phase 30 scopes. "Except" → exclusions. "Undo" → the parent revision. "Reuse the previous floor plan" → `PARTIAL_RESTORE_NOT_SUPPORTED`. |
| References to rooms, revisions, façade, rejected proposals; grounding in stable source IDs (L323, L333) | `instructions/ground.ts` grounds storeys, room types, exact space names, numbers, ordinals, quantifiers and compass directions in model element ids. Several matches for a singular reference give `AMBIGUOUS` with the candidates; no match gives `NOT_FOUND`. |
| Distinguish edit existing / regenerate visual derivative / derive alternative / recompute engineering / restore / compare / new project (L324) | `intent`: those seven, plus `UNRECOGNIZED`. Each resolved intent gives a typed `handoff` to the existing route that previews or performs it. |
| Confirm and enforce hard locks; scope expansion only through new consent; a structured plan without hallucinated execution (L325) | A stated lock that forbids the edit is a `LOCK_CONFLICT`, never overridden. The output is a B40 `changeSetDraft` with `executed: false`. Executing it still needs the B40 plan hash and consent. |
| "Restore and compare are typed actions; 'the second-floor south room' must resolve to stable IDs or ask" (L333) | Restore and compare hand off to the RESTORE preflight and the B34 diff. Storey phrases follow §2. |
| **Gate:** multi-turn refinement of only the selected interior, without resetting the project (L335) | **Met for interior finish edits:** the integration test runs two turns, resolve → B40 plan → execute, then resolve on the new revision. Exactly one element changes across both turns, and the first turn's finish survives the second. |

## 2. Grounding rules (what is never guessed)

**Storeys.** "First floor" names the ground storey in some conventions and the storey above it in others. When both storeys exist the reference is `AMBIGUOUS` with both offered; when only one reading exists it is `EXACT`, and the basis says which reading was used. "Ground" means the lowest storey; "upper/top/upstairs" means the highest storey above it. A level name ("Floor 1") matches exactly.

**Compass directions.** These use the space's area centroid along recorded site north. The convention is `NORTH_FROM_MINUS_Z_CLOCKWISE_TO_PLUS_X`, as in the environmental service. Two candidates within 500 mm of each other along that direction are not distinguished. With no recorded north, the resolver asks. Directions give relative position only, never exposure or daylight.

**Finishes.** Only catalog finishes count, with listed synonyms only ("timber" → `engineered-timber`). Non-catalog materials (marble, oak…) give `FINISH_NOT_IN_CATALOG`. A finish that fits several surfaces ("white") gives a question.

**Refusals.**
- Geometry wording (enlarge, move, remove…) gives `ELEMENT_GEOMETRY_NOT_SUPPORTED` → the Blueprint specialist.
- Exterior wording gives `EXTERIOR_EDIT_NOT_RESOLVED_HERE` → the Exterior specialist, which owns the Phase 30 façade grammar.
- Render, panorama, image or video gives `NO_RENDER_PROVIDER`.

## 3. API

`POST /api/projects/:projectId/revisions/:revisionId/instructions/resolve`, with body `{ text }` (1–1,000 characters, strict).

- **Behaviour:** owner-only (another user → 404, anonymous → 401). It stores nothing and returns 200 `InstructionResolution`.
- **Determinism:** the same text on the same revision gives the same `textHash` and the same resolution.
- **Discovery:** `INSTRUCTION_RESOLUTION` (`DERIVED_ON_READ`). The conversation tool's `services` maximum is raised from 32 to 48, which is additive.

## 4. Verification

| Suite | Result |
|---|---|
| `instructions.test.ts` | 12/12: intents, finish pairing, storey readings, compass by centroid and the no-north refusal, "only" locks, ambiguity, "except", conflicts, typed refusals, restore/compare/recompute handoffs, keep-clause splitting |
| `instructions.integration.test.ts` | 2/2 on PostgreSQL: the two-turn gate scenario plus undo → RESTORE preflight with nothing applied; clarification, determinism, owner-only, strict body |
| Modernization / OpenAPI | Pass after regeneration |

## 5. Outstanding B41 work

- Conversation persistence of resolved targets. B36 turns remain the conversation store; wiring this resolver into `runTurn` is the next slice.
- Message streaming and reconnect semantics.
- Consented project memory and retrieval, with retention controls.
- Provider-assisted parsing (there is none: `languageModel: NONE`).
- Wings, elevations, and named or rejected proposals as reference targets.
- Exterior and geometry resolution in this grammar.
- Live Supabase, CI and staging.

# B42 slice S1: feasibility ladder for ambitious designs

**Status:** implemented and locally verified as a **vertical slice**. **B42 is not complete** (§4).

**Branch:** `phases-40-46`. Plan of record: [b40-b46-implementation-plan.md](../roadmap/b40-b46-implementation-plan.md).

## 1. Roadmap traceability (ROADMAP L338–352)

| Requirement | S1 delivers |
|---|---|
| Surface infeasible constraints; segregate fantasy/concept visuals from engineering-verified alternatives (L342) | Each stated constraint is classified as one of:<br>• `WITHIN_ENGINE_SCOPE`;<br>• `EXCEEDS_ENGINE_LIMIT`, citing the enforced `limitId` and value from `MODEL_LIMITS` or `MAX_REQUESTED_ROOMS`;<br>• `CONCEPT_ONLY`, for eight typed features the model cannot represent;<br>• `REQUIRES_PROFESSIONAL_REVIEW`, for representable lengths whose feasibility rests on domains with no validated solver.<br>`separation` keeps concept-only items apart from assessed ones. |
| Propose alternatives **for consent**, never silent substitutions (L343) | `AS_REQUESTED`, `BOUNDED_GENERATION`, `SUPPLIED_MODEL_ASSESSMENT` and `CONCEPT_ONLY`, each with `keeps`, `givesUp`, `requiresConsent: true`, `applied: false` and a typed handoff to the existing route. |
| Explain which real constraints prevented a geometry (L348) | Every refusal names its enforcement: for example `GENERATION_MAX_FLOORS = 2`, `BUILDING_MODEL_MAX_LEVELS = 256`, or "rings have straight edges". |
| Staged ladder: concept → bounded geometry → separately verified engineering → professional review, with artifacts, gaps and acceptance criteria (L349) | `ladder`: four stages, each with a status, artifacts, gaps and acceptance criteria. Professional review is always `NOT_PERFORMED`. |
| **Gate:** concept and construction claims stay distinct; conflict resolution does not void locks (L352) | `claims`: buildability, engineering feasibility and code compliance are `NOT_CLAIMED`. With a `baseRevisionId`, an alternative that regenerates geometry is `BLOCKED_BY_LOCK` under a geometry lock, and the lock is listed. |

## 2. Rules

- **Only explicit numbers with units are read** from text: storeys, rooms, a height ("250 m tall"), a span, a cantilever. Adjectives such as "tall" or "huge" are never turned into values. Declared values override the text.
- **No engineering threshold is invented.** A 12 m cantilever is not called safe or unsafe. It is representable, its unverified domains are listed (`GRAVITY_LOADS`, `MEMBER_DESIGN`, …), and it is `REQUIRES_PROFESSIONAL_REVIEW`.
- **Feet are converted** at the exact factor of 304.8 mm, rounded to the integer millimetre.

## 3. API and verification

`POST /api/projects/:projectId/feasibility/assessments`, with body `{ text?, declared?, baseRevisionId?, preserve? }` (strict; text or at least one declared value is required).

**Behaviour:**
- owner-only (404 for another user, 401 anonymous);
- a base revision must belong to the project;
- read only, returning 200 `FeasibilityAssessment` with a deterministic `inputHash`;
- discovery: `FEASIBILITY_ASSESSMENT` (`DERIVED_ON_READ`).

**Tests:**
- `feasibility.test.ts`, 6/6: text reading, scope, limits and give-ups, the model maximum, lock blocking, determinism and precedence;
- `feasibility.integration.test.ts`, 1/1 on PostgreSQL: owner-only, cross-project base refusal, nothing stored.

## 4. Outstanding B42 work

- Generated alternative geometry (bounded generation runs on its own route, after consent).
- Ranking alternatives by measured trade-offs.
- Prompt and reference provenance records persisted beside concept sets.
- Design families.
- Any engineering feasibility evaluation: no validated solvers.
- Live Supabase, CI and staging.

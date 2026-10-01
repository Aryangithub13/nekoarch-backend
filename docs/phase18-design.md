# Phase 18 — Architectural requirement interpretation

## Baseline and authority

Resumed existing uncommitted Phase 18 work at `1c60e0ed4f49f6422d20df5d8cef134a9e0c82af`, preserving the Phase 17 seed-evidence correction. Phase 17 checkpoint: `backend-v1-phase17-complete` at `bf3fa6b5d7d027932f9851f9c522655d39f64247`. The working tree was **not clean** at inspection. Work initially stopped under the brief's clean-tree rule; the user then authorized repairing the dirty work and completing the report. The original clean-start assertion cannot be independently verified and has been corrected in the evidence. A snapshot of all 19 existing changed/untracked files was saved to `/tmp/designflow-phase18-before-repair.tar.gz` before editing. No reset, automatic commit, or tag.

Language is untrusted intent. The interpreter cannot generate walls, openings, room/slab polygons, stairs, structural dimensions, QA results, takeoff, or cost. Its only engine dependencies are public input types, normalization, and shared unit conversion. A static import test enforces this boundary. Generation, Building Model V2 validation, independent QA, immutable commits, Phase 17 identity and CAS remain unchanged.

## Inspected native contract

`packages/generator/src/blueprint/input.ts` exports `BlueprintRequirementsSchema`, `BlueprintRequirements` (input), `NormalizedBlueprintRequirements` (output), `normalizeBlueprintRequirements`, `BLUEPRINT_VERSION`, and `BLUEPRINT_LIMITS` through the package root. Normalization sorts room type/level groups, relationships and setbacks and supplies stairs for two floors. The Phase 17 hash is computed separately from these normalized requirements, never from text.

Actual fields:

| Field | Existing contract |
| --- | --- |
| site | boundary ring; optional buildableBoundary and referenceOrigin (datum/buildingOrigin); required nullable northMilliDegrees; setbacks default [] with boundaryEdgeStart/minimumMm |
| floors | 1 or 2; default 1 |
| rooms | 1–24 groups, at most 24 total rooms; type bedroom/bathroom/living/kitchen/dining/study; count 1–24; optional level 0/1; minWidthMm/minDepthMm default 1800; optional minAreaMm2, preferredWidthMm/preferredDepthMm, positionPreference front/rear |
| relationships | max 48; from/to type and ordinal (default 1), hard/soft strength, adjacent/connected/passage kind (default adjacent) |
| circulationWidthMm | default 1200 |
| floorToFloorHeightMm | 2400–6000; default 3000 |
| exteriorWallThicknessMm/interiorWallThicknessMm | even integers up to 1000; defaults 200/100 |
| slabThicknessMm | 50–500; default 150 |
| door | widthMm 900, heightMm 2100, jambMm 100 defaults |
| windows | enabled true, widthMm/heightMm 1200, sillMm 900 defaults |
| stair | optional widthMm/riserCount/treadDepthMm/landingDepthMm; normalization supplies 1000/16/280/1200 for two floors |
| seed | 1–128 characters; default blueprint-default |
| solver | maxCandidates 1–128 (default 32), maxIterations 1–20000 (default 20000) |

Lengths are positive integer mm, generally bounded at 60000. Validation also rejects duplicate room groups, invalid floor references, duplicate/self/nonresolving relationships, invalid setbacks, one-floor stairs and openings exceeding clear storey height. Solver capability is narrower than the model schema: Phase 18 uses rectangular sites only.

## Implemented boundary and API

Use a strict bounded intent schema with scalar plot dimensions, counts, floor allocation, kitchen preference, explicit modification dimensions, and typed unsupported features. Convert deterministically into the existing native input. Provider output never contains coordinates. The converter creates only a rectangular **site input boundary** at the local origin from validated width/depth; this is not generated building geometry. Native `structuredRequirements.site.boundary` necessarily contains those site coordinates. Tests distinguish the coordinate-free provider intent from this required native input.

Use a stateless owner-only POST `/api/projects/:projectId/requirements/interpret`. Keep text and typed clarification answers in the client, resubmitting the original brief with a previous interpretation ID and bounded explicit answers. Reparse and revalidate every request. The ID is diagnostic, not trusted state or a DB lookup. No interpretation persistence, migration, durable mutation or interpretation idempotency receipt is needed. Generation remains a separate explicit call with the existing durable idempotency framework.

No external adapter in this phase: a free bounded parser and injectable provider interface/fakes prove provider independence with zero credentials and zero inference network calls. Optional providers can be implemented later behind the same validation and budget boundary. No new infrastructure or SDK.

## Request and output contracts

`NaturalLanguageDesignRequestSchema` is strict. It accepts:

- `text`: 1–4000 characters after NFKC normalization and trimming, also bounded before normalization; unsafe control characters are rejected.
- Optional `locale`: `en`, `en-IN`, `hi`, `hi-IN`, or `hi-Latn`. Locale never silently supplies measurement units.
- `unitsHint`: `AUTO` (default), `mm`, `cm`, `m`, `ft`, or `in`.
- `baseRevisionId`: nullable UUID, default null; an explicit current revision is required for modifications.
- Optional `clarification`: a previous interpretation UUID and at most eight unique typed answers. Supported answer fields are `site.dimensions`, `site.unit`, `floors`, `bedrooms`, and `kitchen.minimumDimensions`. Other questions require revising the brief. Resubmit the original text and the complete current set of answers; no server conversation memory is retained.

The route uses a 24,576-byte body limit, reduced if the existing small-body configuration is lower. A client cannot choose providers, models, API keys, system prompts, schemas, owner/project IDs, geometry or QA results through the request body.

`IntentCandidateSchema` is a separate extraction representation with a deterministic conversion to the inspected native input. Its only dimensional data is scalar site width/depth/unit and optional kitchen minimum dimensions. Counts cover bedrooms, their floor allocation, floors, bathrooms, living, dining, study and parking. It also carries kitchen open/closed preference, one kitchen relationship target/kind/strength, seed, no-stairs and preservation/increase-kitchen intent, inferred-field names, typed contradictions and unsupported-feature codes. All objects reject unknown keys. It has no polygons, coordinates, revision IDs, code, URLs, tools or QA output.

Every response includes a fresh diagnostic `interpretationId`, interpreter/provider/model versions, language classification, base revision, candidate intent, assumptions, questions, warnings, unsupported requirements and field provenance. `structuredRequirements` is present only for `READY`; all other statuses contain null. There is no invented numerical confidence score. A `READY` result has passed both extraction validation and the unchanged native schema, but does not promise that the bounded solver will find a feasible plan.

## Validation and conversion

The order is provider call → bounded JSON encoding/parsing → strict local intent schema → explicit clarification overrides → deterministic semantics → native normalization/validation → result-schema validation. Responses are limited to 16,384 bytes. Provider strings and objects follow the same checks. Unknown fields, malformed JSON and oversized output produce `AI_PROVIDER_INVALID_RESPONSE`.

Semantic checks cover positive site dimensions up to 60,000 mm per side, one/two floors, supported positive room counts and the 24-room native limit, total versus floor allocations, no-stairs/two-floor conflicts, duplicate contradictory statements, incomplete kitchen dimensions and relationship targets. Necessary size/area bounds reject obviously impossible new briefs; this is input validation, not a layout solver. A total-bedroom clarification cannot erase conflicting ground/upper-floor counts. Revisions of unsupported modifications require a complete new brief.

All conversion uses shared `toMillimetres`: exact rational conversion followed by the established half-away-from-zero integer rounding. Examples include 30 ft = 9144 mm, 50 ft = 15240 mm, and 9.0005 m = 9001 mm. Equivalent normalized input yields the Phase 17 `requirementsHash`. That hash intentionally excludes the execution seed; seed remains separately recorded in generation identity and generation idempotency. Seed spelling/case is preserved.

## Fallback grammar, defaults and provenance

The free parser supports common rectangular plot dimensions, numeric/selected English number words, BHK expressions, bedroom totals and ground/upstairs counts, one/two floors, bathroom/living/dining/study counts, open/closed kitchens, one kitchen-to-living/dining relationship, parking presence/count, and explicit seeds. Its finite Hinglish vocabulary includes `ka plot hai`, `neeche`, `ground floor me`, `upar`, `ek`, `do`, `teen`, `chahiye`, and `kitchen open rakhna`. It is not a general multilingual model. Unknown vocabulary, negated/ranged/conditional room counts and multiple relationship targets are explicitly unsupported.

Documented product defaults: one floor if no floor count/allocation implies another; one bathroom, one living room and one kitchen for a residential brief unless supported explicit counts apply; all remaining native defaults listed above. Room counts are hard requirements. Kitchen relationships preserve hard/soft strength; `prefer`/`preferably`/`would like` produce soft preferences. An open kitchen maps to a direct connection, normally to living if no target was specified. That target is disclosed as inferred and a warning explains that the engine still builds distinct rooms and walls, so it is not a wall-free open-plan implementation.

`USER_EXPLICIT`, `USER_INFERRED`, `PRODUCT_DEFAULT` and `UNRESOLVED` are machine-readable sources. The assumptions ledger includes defaults and inferences, including summing per-floor bedroom counts and assigning remaining bedrooms to the other floor. Explicit clarification answers replace inferred provenance for the corrected field. Unknown orientation remains `northMilliDegrees: null`; no regional/site dimensions or units are fabricated.

Parking is a preserved hard intent with `DEFERRED` disposition and `appliedToGeometry: false`; parking is not solved. Daylight and ventilation are deferred soft preferences. Every deferred result warns the frontend to review these before generation. Spiral stairs, curved roofs, irregular sites, orientation requests, engineering compliance and unrecognized constraints block generation input. If critical input is also missing, clarification takes precedence while the unsupported list remains visible. Supported candidate fields remain available for correction, but non-ready results carry no native generation input.

## Provider abstraction, budgets and failures

`ArchitecturalInterpreterProvider` contains server-owned kind/model/path and capabilities: structured output, JSON-schema support, multilingual support, maximum input length, timeout, free/metered cost class and tool-mode support (false). Selection is a server option, never request-controlled. The fallback is `fallback` / `bounded-parser-v1`; tests also inject independent fake providers and compare normalized outputs. No production external adapter, vendor SDK, external prompt, embedding, AI worker or model credential is needed.

Configuration is `AI_INTERPRETER_MODE=fallback|disabled` (default fallback), timeout 1–30,000 ms (default 5000), and output-token cap 128–4096 (default 2048). Effective timeout is also bounded by the provider capability (fallback: 1000 ms). There is one call per interpretation, zero retries, zero hidden provider switching, and AbortSignal cancellation on timeout. Metered adapters added later must honor the supplied output-token cap and abort signal, constrain output where supported, and add a source-controlled versioned extraction prompt. Synchronous malicious adapter code cannot be preempted by a JavaScript timer; adapters are trusted server code, while their responses remain untrusted.

Failures are typed: unavailable, timeout, rate-limited, authentication-failed, invalid-response, refused, network-error, or configuration-unavailable. Adapter exception messages are never returned. Existing request/auth/ownership/CAS errors use the normal HTTP error envelope; completed interpretations (including `FAILED`) return HTTP 200 with their typed status/error. Optional interpreter availability does not participate in core readiness.

## Privacy, ownership, rate limits and persistence

The existing authenticated project repository verifies ownership before any provider call. Cross-user projects return 404; unauthenticated requests return 401. A stale `baseRevisionId` returns 409 `REVISION_CONFLICT`. The route returns `Cache-Control: no-store` and shares the existing expensive generation-operation quota plus the IP perimeter limit.

Nothing leaves the server for the fallback. The adapter interface supplies only text, optional locale, the fixed intent schema, AbortSignal and output-token budget. It receives no JWT, API credentials, project/owner/revision identifiers, database metadata, history, geometry, cost data, clarification IDs or inherited base requirements. The existing project read internally loads its current revision DTO; only its normalized requirements are passed into the interpreter for local merging. A future external adapter would necessarily transmit the supplied brief/schema, so its privacy policy and prompt must be documented when added.

Application logs contain interpretation ID, provider/model/version, duration, status, validation outcome, clarification count, path and input-byte count. They exclude the raw brief and provider output. Tests verify prompt and authorization redaction. No raw-response debug storage was added.

Interpretation is stateless and does not write revisions, audit events or idempotency receipts. No interpretation table, RLS policy, migration `0012`, persistence immutability mechanism or interpretation idempotency key is needed. The same header with different briefs therefore cannot replay a stored interpretation. Generation continues to use the existing durable idempotency, native validation, independent QA and immutable commit path. Migrations 0001–0011 remain untouched and no database reset is used.

## Frontend handoff and modification example

1. POST the brief to `/api/projects/:projectId/requirements/interpret`.
2. For clarification, display the typed questions and resubmit text plus explicit answers and the previous interpretation ID.
3. For `READY`, display counts, dimensions, assumptions, warnings and deferred requirements. Let the user confirm or edit the structured requirements.
4. POST `{ requirements: structuredRequirements, baseRevisionId }` to `/api/projects/:projectId/revisions/generate` with the existing idempotency header. No further AI transformation is needed.
5. Use the returned Phase 17 `generationId`, `requirementsHash`, seed, `modelHash`, revision ID and freshness fields. QA is the real independent engine result, never the interpretation's status.

For “Keep the bedrooms the same but make the kitchen larger,” supply the explicit current generated revision. The first response asks for minimum kitchen width/depth; a typed answer produces a complete clone of the base requirements with only those minima changed. There must be exactly one kitchen; a request to increase it must provide nondecreasing dimensions and larger minimum area. This preserves bedroom requirements, not exact wall positions, and warns that larger minima do not guarantee a larger actual room than the previous plan. Supplied revisions with no stored requirements cannot be modified by inventing a brief. Any current-revision change requires reload; neither interpretation nor generation silently rebases.

Phase 16 `BLUEPRINT_ONLY` and `COMPLETE_BUILDING` remain unchanged and accept direct structured requirements with interpretation disabled. No capability-registry dependency on AI was added.

## Verification and Phase 19 boundary

The dedicated `test:interpretation` command is included in `check`; normal unit/integration and local Supabase suites also include relevant interpretation coverage. Tests enforce the import boundary recursively, strict schemas, bilingual semantics, exact units, provenance, seed preservation, clarification, unsupported intent, prompt injection, provider failures and budgets, owner access, no persistence, generation identity, real QA, CAS and disabled-interpreter startup. Required runs and counts are recorded in `phase18-verification.json`, with complete logs under `phase18-evidence/`. `phase18-example.json` is generated by a real HTTP acceptance test against disposable PostgreSQL.

This phase adds no solver algorithm, parking layout, daylight/ventilation simulation, irregular/L-shaped site support, advanced stair/roof generation, privacy optimization or engineering/code-compliance claim. Those architectural capabilities remain Phase 19 — Precision Solver V2. Live paid-provider tests are absent from required CI; external interpretation capability is a future optional adapter, not part of this phase's correctness evidence.

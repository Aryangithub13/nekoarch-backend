# Phase 9 design record — inspected before implementation

Baseline verified on 2026-09-20: HEAD and backend-v1-phase8-complete both resolve to 908b64db4bba489b7193eba2aafbaa863c83f146. Working tree clean; tag-to-HEAD diff empty.

## Preserve

The strict shared Plan/PlanInput/SavedPlan contracts, Phase 6 generator, generation service, plan persistence, estimates, endpoints, RLS and idempotency remain unchanged. Relevant protections are the existing shared contract, generator, API, PostgreSQL and live Supabase suites. Shared code uses Zod 3.25.76, ES2022 and browser compilation without Node types.

Inspection covered shared types/API, generator geometry/generation/invariants and README, API plan/repository/estimate paths, core plan migration and Phase 6–8 documentation. V1 coordinates are metres on X/Z; generator boundaries round to micrometres. Rooms are rectangles, walls are segmented lines with gaps. Optional window intervals have no established semantics. V1 contains neither wall thickness/height nor elevations, slabs, sites, true doors or stair construction. Its bounds describe a layout footprint, not a surveyed plot. Estimates link to saved plan IDs and use explicit estimation inputs, not geometry takeoff.

## Extend additively

Add a versioned, strict, modular Building Model V2 to @designflow/shared, exported alongside V1. Keep X/Z horizontal; Y is positive elevation. All geometry uses building-global plan coordinates; vertical entity offsets are relative to their level. A site may supply a placement/reference datum. Complete architectural documents require physical dimensions; explicitly marked legacy-planar documents can carry null unknowns. The full architectural schema rejects incomplete imports. Unknown is never zero or a nominal invented construction value.

Integer millimetres are canonical. Decimal boundary conversion uses BigInt rational arithmetic and nearest-mm rounding, ties away from zero. Coordinates/dimensions have explicit engineering bounds, and products, polygon predicates and areas use BigInt. Diagonal length is a documented rounded derived measurement; hosting checks compare squared exact lengths, avoiding rounded-fit errors. Polygon areas retain half-square-millimetres. Derived values are calculated, not duplicated in the model. Dimensions distinguish measured chains from controlling targets.

Entities have document-unique stable IDs and explicit references. Wall paths are directed centerlines in architectural documents. Openings own host references; wall opening lists and reverse room adjacency are derived. Door swing is relative to the directed host. Space boundaries declare whether they describe usable faces or legacy unspecified boundaries. Arbitrary simple polygon rings are supported; slabs have explicit voids. Flat roof slabs and optional independent ceiling plates suffice for this phase. No roof/structural solver is introduced.

## Compatibility and storage decision

An explicit pure adapter validates V1 and converts only known planar coordinates, room labels/types and wall segments. Room IDs are namespaced; wall IDs derive from geometry, never permanent array positions. It does not infer construction dimensions, plot boundaries, north, material specifications, windows or doors. Gaps alone in a general saved V1 plan cannot establish a real door, its host construction, height or swing. Adapter diagnostics identify omissions and millimetre quantization. Precision collapse or invalid topology fails instead of silently repairing geometry. No raw prompt is copied into provenance.

V2 is an atomic JSON document, but is NOT accepted by legacy HTTP persistence in this phase. The existing plans table enforces V1 JSON-to-column metadata consistency; passing V2 into it would require unrelated API/RPC changes. No migration is needed for the shared model foundation. Historical JSON stays V1. An explicit document parser recognizes schemaVersion: 2, otherwise validates V1; unknown explicit versions fail. Future V2 persistence needs a deliberate additive API/storage change rather than weakening those checks. This phase delivers JSON serialization and validation, not a new persistence endpoint.

## Validation and verification

Validate unique IDs, same-level typed references, physical positivity, polygon simplicity/containment, non-overlapping spaces and openings, host extents, elevations, stair rise/run/counts, plate voids, specification references and exact dimension reconciliation. No municipal rules or structural sizing. Golden authored fixtures include single-room, small residence, multi-room, two-level stair, explicit openings and invalid variants.

Run all requested npm gates, the Phase 8 teardown regression and container checks. Integration repeats are necessary only if persistence/lifecycle code changes. Keep old tests intact and extend the browser fixture. No external providers, frontend, full quantities, pricing changes or Phase 10 work.

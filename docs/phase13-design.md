# Phase 13 design — deterministic geometric quantity takeoff

Baseline HEAD is main at 46f0117, identical to backend-v1-phase12-complete.
The working tree already contained partial Phase 13 work. The initial clean-tree
gate stopped work; the user then authorized fixing the baseline and continuing.
Existing Phase 13 work is preserved and reviewed, without rewriting Phase 12 history. This phase is additive and stops before materials or prices.

## Taxonomy and authority

A pure @designflow/quantity-takeoff package depends only on shared V2 and Zod.
Wall centerline length, segment-prism volumes and single-face areas use wall.path,
thicknessMm and heightMm. Hosted entities in model.openings are the sole deduction
source; connectivity and wall.spaceIds never generate quantities. Opening schedules
preserve kind, type, operation, size, sill, host, level and specification.
Space boundary gives centerline-space area, an explicitly alternative floor-finish
basis, and geometric perimeter. These alternative bases must not be added together.
Slab footprint outer and void rings give gross/void/net area and thickness volume,
with separate floor, flat-roof and explicit ceiling codes. No implicit ceiling plate
is invented. Columns use net cross-section and height; stairs use explicit flight,
risers, run, width, footprint and landing geometry, assigned to the source level
(landings to their actual end level). Site/buildable and level envelopes are separate
plan bases. Geometric GFA is sum of net floor-plate area, never statutory FAR/FSI.
Building footprint union across levels is not evaluated.

## Conventions and exactness

Each wall contributes its own length × thickness × height. Junction overlaps are
not unioned, and wall/column or wall/slab intersections are not removed. The result
is segment-prism volume, not exact physical masonry union volume. A wall face means
one longitudinal face, with classification retained; it is not assigned plaster,
paint or an interior/exterior assembly. Reveals, ends and tops are excluded.

Distinct validated openings deduct width × height once per entity from their host
face and that area × host thickness from its prism. V2 rejects duplicate IDs,
overlapping hosted rectangles and out-of-host extents. Negative net quantities fail.

Integer-mm coordinates use BigInt intermediates. All internal measures use doubled
base units, permitting exact .5 mm² and .5 mm³; no polygon-area rounding. Integer
lengths are exact. Irrational diagonal lengths follow Phase 9 nearest-mm rounding
per segment (ties upward); dependent quantities and coverage are PARTIAL and carry
an explicit rounding warning. Exact areas remain EVALUATED even on diagonal rings.
JSON quantity values are canonical decimal strings with mm/mm2/mm3/each units and
explicit dimension; no BigInt escapes. SI display strings round half upward only
at display, with configurable 0–9 decimal places (default 6). They never feed totals.

## Report and grouping

Stable item codes are Phase 14 contracts. Item identity is code plus source entity
ID, with structured evidence, specificationId (null = unknown), status and assumption
codes. Deterministic code-point sorting controls items, warnings, schedules and groups.
All totals are sums of emitted items grouped by code/unit, never mixed dimensions or
alternative bases. Sections expose project, level, specification, classification and
wall thickness groupings. Schedule groups preserve size/type/operation/specification.
Missing representations produce NOT_EVALUATED coverage, not a claim of completeness;
unsupported physical union, pitched roofs, implicit ceilings, structural and MEP
quantities are explicit. Unknown specifications do not imply a material.

## Persistence and trust

New 0007 migration adds project_revision_takeoffs with immutable ID, revision FK,
acceptance-QA FK, engine/policy/schema versions, options, report, fingerprint and DB
creation time. Report itself has no timestamps. No project or revision columns change.
Fingerprint includes revision ID, canonical model, engine, policy and normalized
options. Uniqueness by revision/engine/policy/options ensures concurrent requests,
even with different retry keys, return one logical artifact. Future engine versions
coexist. Existing PROJECT_COMMIT_SECRET signs the complete takeoff input and caller,
route, retry context and expiry. New RPC verifies signature and acceptance QA.
Owner-only read RLS derives ownership through revision → project, even when public.
Client writes are denied. Artifact and existing Phase 8 receipt commit atomically.
Updates/deletes of artifacts are rejected. No re-audit or current-takeoff pointer.

POST and paginated summary GET /api/projects/:projectId/revisions/:revisionId/takeoffs;
detail GET adds /:takeoffId. Existing auth, body limits, structured errors and safe
logging apply. No raw model/report logging. API validates both computed and stored DTOs.

## Resource bounds and exclusions

Before V2 validation: JSON-safe input at most 2 MiB, 5,000 entities, 100,000 vertices,
and bounded pairwise validation work (2,000,000 candidate pairs). Afterwards at most
40,000 items, 6,000 warnings, 2,000 sections, 8 MiB report; evidence bounded per item.
Measurement/grouping is linear apart from sorting and the bounded existing V2 geometry
validation. No timing benchmark; test maximum supported generated residential inputs.

No recipes, prices, wastage, structural adequacy, reinforcement, MEP, professional
output, AI, solver changes or frontend. No automatic commit or completion tag.

# Phase 23 second source review

This is a separate inspection pass by the implementing agent, not a claim of external human review. The IFC parser/geometry checks are independently implemented by IfcOpenShell/OpenCASCADE. Inspected the tracked delta and every new production BIM module, route and service, plus acceptance fixtures, benchmark and external verifier.

| Review area | Source evidence and conclusion |
|---|---|
| Geometry authority | `sourceModel` parses the architectural contract and reruns Blueprint QA. `projectBim` references one canonical geometry document. Accepted models are cloned, never patched. `validateBim` compares embedded geometry with the separately supplied authoritative source. |
| Semantic duplicates | Validator independently enumerates the required element inventory and exact relationship set. Duplicate IDs, missing elements, wrong kinds and extra physical elements fail. Groups are nonphysical IFC groups. Openings are voids; door/window fills are explicitly surface envelopes. |
| Hosts and containment | Source host IDs, wall/space boundaries, fill relationships, parents, floor IDs, stair endpoints and exact footprint/void matches are checked. IFC openings have void hosts and no conflicting storey containment; stair parts decompose the stair. Spaces decompose storeys. |
| Material truthfulness | Native specified material labels are the only source of IFC material associations. The semantic model retains unknown material and unevaluated engineering states. No estimate recipe is promoted to a certified material assembly. Added an independent specified-material/Unicode fixture. |
| Identity and history | Semantic IDs bind project, native role and source ID; revision bindings carry immutable model/generation/requirements/parameter identity. IFC GlobalIds are deterministic 128-bit compressed identifiers, independently checked with IfcOpenShell. Diffs never infer continuity from a label. |
| Quantities | Projection references the existing Phase 13 report. Validator recalculates through that same authoritative measurement engine; external IFC verification compares converted quantities against the native report and also reconstructs geometry. |
| IFC geometry | Checked explicit IFC4 entity attributes, millimetre placements, X=x/Y=-z/Z=y transform, slab holes, real L rings, opening Boolean deductions and stair surface construction. External EXPRESS and geometry checks are required; a STEP file write alone is insufficient. |
| API isolation | Every route calls authenticated request context before loading data. Owner JWT reaches `ProjectRepository`; project/revision associations are checked again. Existing safe error handling, no-store responses and read quotas apply. No arbitrary path, write endpoint or public storage link is introduced. |
| Bounds | Strict schemas, iterative JSON preflight, supported geometry/count limits, capped graph/output/export sizes and bounded page sizes constrain work. Projection is regenerated from the accepted revision, so no stale cross-revision cache exists. |
| Historical preservation | All preexisting shared/generator/QA/quantity/construction/cost production files and migrations remain unmodified. Only API registration, test registration and script registration touch tracked Phase 22 files. Database before/after digest evidence is required before the final classification. |
| AI and future disciplines | No conversational/provider authority or workflow capability enum changes. Read-only BIM services are available; natural-language BIM tool coverage remains explicitly pending. Structural/MEP/engineering certification remains unsupported. |

Findings resolved in this continuation:

1. Three incomplete repository casts broke typecheck. Introduced a fully typed test repository whose unrelated methods fail explicitly; assertions remain intact.
2. Compiled acceptance lacked the explicit `Buffer` import required by lint. Added it and extended compiled coverage to a real parametric revision change and immutable prior snapshot.
3. `/relationships?kind=...` used the element-kind schema and ignored the filter. Added a relationship-kind schema/filter and shared PostgreSQL/Supabase acceptance assertions.
4. Verification runner could exit successfully after a failed gate. It now returns nonzero on any failed gate/source drift and records the tested source manifest.
5. Prior external IFC checks lacked a specified-material fixture and missing-project/unit corruption controls. Added those checks without weakening schema or geometry assertions.

The final report records actual gate results and remaining representation limits. The runtime exporter has no Python/native IFC dependency; independent verification uses a pinned development parser. Surface models are intentional for unspecified-thickness elements and must not be represented as detailed construction solids. No IFC certification or universal application compatibility is claimed.

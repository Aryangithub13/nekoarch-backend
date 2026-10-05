# Phase 23 source audit and design matrix

Starting checkpoint: clean `main`, HEAD and `backend-v1-phase22-complete` both `7086209efd9e337a2c175b9bed1e562fde54ca68`. Phase 22 audit, design, report and verification evidence inspected. No applicable AGENTS.md or previous BIM/IFC implementation found. No frontend access, release mutation or migration is planned.

Continuation audit (2026-10-05): the initial clean checkpoint above is recorded by the preceding implementation pass. This continuation independently confirmed the same branch, HEAD and tag, with the expected uncommitted Phase 23 implementation and evidence already present. `phase23-evidence/continuation-baseline.json` preserves that observed status and file digests. The user's instruction to continue authorizes completing this existing delta; no baseline reset or release action was performed.

| Existing source | Reuse | Phase 23 decision / gap |
|---|---|---|
| shared/building-v2 schemas, invariants, adapter | mm coordinates, explicit floors, walls, opening hosts, slab voids, stair geometry, specification references | Keep native model unchanged; one geometry document with typed semantic references. Legacy planar adapters lack heights and are explicitly unsupported for architectural IFC; V1 architectural generator is supported. |
| generator V1, blueprint, solver-v2, parametric | Existing IDs and validated generation, canonical ordering | Never regenerate geometry during BIM reads. Rooms retain role identity; wall intervals change identity when endpoints change. |
| blueprint-qa, parametric QA, project-service | Independent geometric acceptance and accepted immutable revision evidence | Reaudit input; BIM validator independently checks projection against source, without calling projector. |
| generation-identity | Historical canonical hash, requirements hash, generation UUID | Reuse unchanged hash; verify stored identity; bind BIM to project, revision, generator and parameter state. |
| project contracts/repository, auth and SQL RLS | Owner-scoped revision reads, signed immutable writes | Read-only routes through same owner repository; no public artifact route or filesystem path input. |
| quantity-takeoff | Exact bounded Phase 13 item IDs, units, totals and measurement policy | Reference existing quantity items, preserve overlap/finish limitations; no competing quantity engine. |
| construction-calculations / boq-cost | Conceptual recipes, signed calculation provenance | Do not reinterpret recipes as specified materials. Only native specification material labels count as specified; no grades/performance claims. |
| workflows registry / conversation contracts | Fixed capability/tool enums and exact approval path | Expose bounded read-only BIM services first; conversational retrieval pending; preserve registry and provider behavior. |
| Phase 21 orchestration | Advisory intent only | No AI geometry, materials, IFC insertion or QA authority. No paid dependency. |
| Docker / Vitest / PostgreSQL / Supabase | Compiled API, isolated acceptance fixtures, RLS tests | Add BIM API/unit/adversarial tests, independent IFC verification and production acceptance. |

## Contracts and identity

`bim-semantic-v1` contains native geometry once, source revision binding, deterministic semantic elements, a flat typed graph, material labels with provenance, and the Phase 13 report. Geometry references identify native collections and nested landings/voids; they never imply a second geometry authority. Semantic IDs hash project + role + source ID. Revisions are not part of continuity IDs; source hashes and revision IDs belong to snapshots. Hierarchical edges are acyclic; nonhierarchical host/connect/group edges are distinct. A changed native interval yields removed/added elements; replacement is only reported when a stable source role changes category, never guessed by display name.

Property keys and value states are bounded enums, with explicit units/provenance. Unknown engineering data remains absent or explicitly not evaluated. Material names may be specified without constituting certified products. Assemblies are groups, not additional physical solids. Floor envelope areas differ from slabs and room centerline areas.

## Persistence, APIs and budgets

Deterministic on-demand projection from accepted owner-scoped revisions; no cache, migration or artifact storage. Routes under `/api/projects/:projectId/revisions/:revisionId/bim` provide model, validation, elements, individual element, relationships, revision comparison and private JSON/IFC downloads. Strict inputs, keyset pagination bound to revision/hash, inherited authentication/rate limits, bounded outputs, fixed filenames and safe errors. Input preflight rejects cycles/nonfinite/overlarge values before schemas. Architectural limits: two floors, 24 occupied rooms, bounded orthogonal geometry; all arrays and exports have explicit caps.

## IFC profile and independent verification

Target IFC4 ADD2 TC1 (`IFC4`, schema definitions inspected via IfcOpenShell 0.8.5). Native TypeScript STEP serializer keeps production free from Python/native runtime dependencies. Independent parser/geometry verifier uses pinned IfcOpenShell in an isolated environment. No IFC certification or arbitrary IFC4/4x3 compatibility claim.

Map native x/right, y/up, z/depth to IFC X=x, Y=-z, Z=y in millimetres. Storey-local placements apply elevation exactly once. Wall prisms and slab profiles preserve source intervals, L rings and slab holes. Hosted voids use IfcRelVoidsElement and fills use IfcRelFillsElement. Door/window representations describe opening envelopes, not invented leaf/frame assemblies. Stair tread/riser and landing surfaces preserve known geometry without inventing underside thickness. Spaces are boundary representations; derived storey envelope height is not certified clear height. Unknown site address, survey coordinates and engineering values are omitted. Project-defined property sets use NekoArch names, not invented standardized Psets.

Independent verification must open every representative file, validate EXPRESS, reconstruct geometry, verify bounds/volumes/placements/hosts/units/IDs against original geometry and quantities, and record information loss. Missing dependencies block this gate rather than waive it.

References: https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html and https://docs.ifcopenshell.org/ifcopenshell-python/geometry_creation.html .

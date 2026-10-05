# Phase 23 BIM API and reproduction guide

All operations use the existing bearer-authenticated, owner-scoped revision API. The base path is `/api/projects/:projectId/revisions/:revisionId/bim`. Both identifiers must be UUIDs. BIM reads revalidate accepted source geometry and produce a deterministic semantic snapshot; they never create a revision or write an artifact to storage.

| GET suffix | Result |
|---|---|
| (none) | `{ model, validation }` |
| `/validation` | Typed validation summary and IFC profile limitations |
| `/elements` | `{ binding, items, nextAfter }`; optional element `kind` filter |
| `/elements/:elementId` | Element, source binding and all incident relationships |
| `/relationships` | `{ binding, items, nextAfter }`; optional relationship `kind` filter |
| `/diff/:otherRevisionId` | Comparison of two accepted revisions in the same owned project |
| `/export.json` | Private JSON attachment |
| `/export.ifc` | Private IFC4 STEP attachment, `application/x-step` |

Pages accept `limit` (1–100, default 50), `after` (the preceding page's last ID), and `kind`. Element and relationship kinds have separate strict vocabularies in `apps/api/src/bim/contracts.ts`. Follow `nextAfter` until it is null. Ordering is lexicographic by deterministic ID. Each page includes the revision and model hash; keep the same revision URL and filter for the entire traversal. The cursor is an element ID validated against the requested revision/filter, not a signed cross-revision token. Unknown parameters are rejected. All other routes reject query parameters.

Example suffixes: `/elements?kind=wall&limit=20`, `/relationships?kind=hosts&limit=100`. Geometry is stored once in `model.geometry`; an element's `source` points into a native collection. `quantityIds` point into `model.quantities.items`. Do not sum room centerline area, floor footprint area and slab net area as if they were interchangeable. Material `unspecified` and property `not_evaluated` states are meaningful and must remain visible to consumers.

Missing authentication returns 401; another owner's project/revision and cross-project revision combinations return 404. Invalid parameters return 400, read quota exhaustion returns 429, and unaccepted/mismatched/unsupported source data returns 422 with a typed error. Internal errors use the existing redacted error envelope. Downloads have fixed revision-derived filenames and `Cache-Control: no-store`; there are no public download URLs or writable BIM endpoints.

## Reproduce verification

Use Node 22 or later and the repository's installed lockfile dependencies. The live database acceptance requires the existing local Supabase stack. Do not reset it. `python3 scripts/verify-phase23.py` runs 30 release gates, including independent IFC/profile verification, benchmarking, Docker and compiled acceptance, and records commands, exits, elapsed times and a source manifest under `docs/phase23-evidence`. The runner exits nonzero if any gate fails or source changes during execution.

Independent IFC verification is a development dependency, separate from the production image:

```bash
python3 -m venv /tmp/designflow-phase23-ifc
/tmp/designflow-phase23-ifc/bin/python -m pip install -r scripts/requirements-ifc.txt
npm run benchmark:bim
PATH=/tmp/designflow-phase23-ifc/bin:$PATH npm run test:ifc
/tmp/designflow-phase23-ifc/bin/python docs/phase23-evidence/verify-ifc-profiles.py
```

The benchmark generates V1, V2, L, two-floor setback, 24-room, edited-wing and specified-material fixtures. Python opens these files using IfcOpenShell 0.8.5, validates EXPRESS rules and reconstructs geometry with OpenCASCADE. It compares source dimensions, native quantities, storey positions, void hosts, fills, spaces, stairs and materials. Corrupted GlobalIds, missing project entities and incorrect units must be rejected. Performance observations include cold/warm effects and are single samples per fixture, not service-level latency guarantees.

```bash
docker build -t designflow-api:phase23 .
node scripts/smoke-container.mjs designflow-api:phase23
docker run --rm -i --network none designflow-api:phase23 node --input-type=module < docs/phase23-evidence/compiled-acceptance.mjs
```

The production image uses the native TypeScript exporter and does not require Python, IfcOpenShell, paid AI services or network access to generate BIM/IFC from accepted geometry. Live authenticated persistence is exercised separately against PostgreSQL and Supabase.

## Extension boundaries

The profile supports at most two storeys, 24 occupied rooms and bounded orthogonal architectural geometry. Native model/hash contracts remain unchanged. New disciplines require a new reviewed contract/profile and independent validation; do not insert structural, MEP, certified material or compliance claims into arbitrary properties. Conversational BIM retrieval remains pending; the current read-only services do not widen Phase 20 tool enums or Phase 21 provider authority. Surface-only doors/windows, spaces and stair/landing representations retain the documented architectural meaning and do not supply missing assembly thickness or construction detail.

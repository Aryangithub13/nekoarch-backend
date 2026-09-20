# Architectural Building Model V2

Public browser-safe exports are available through `@designflow/shared`. Zod 3.25.76 validates shape and relationships. `BuildingModelV2Schema.parse(unknown)` is the trust boundary; TypeScript types alone do not validate data. All schema objects are strict. A schema parse returns independent plain JSON data, with no mutation, defaults, clocks, providers or pricing.

```ts
import {
  ArchitecturalBuildingModelV2Schema, BuildingModelV2Schema,
  upgradePlanV1, parseArchitecturalDocument,
  serializeBuildingModel, deserializeBuildingModel,
  toMillimetres, fromMillimetres, polygonAreaMm2, wallMeasurements,
} from '@designflow/shared';

const full = ArchitecturalBuildingModelV2Schema.parse(authoredDocument);
const json = serializeBuildingModel(full);
const restored = deserializeBuildingModel(json);
const { model: planar, diagnostics } = upgradePlanV1(legacyPlan, 'my-building');
// planar is explicitly incomplete: full architectural validation rejects it.
const recognized = parseArchitecturalDocument(unknownStoredJson);
```

Executable, authored examples live in `packages/shared/tests/fixtures/building-v2`. `BuildingModelV2Schema` accepts `architectural` and `legacy-planar` completeness. Architectural means the supplied walls and spaces declare construction/boundary semantics; it is not a certification that every physical entity, door or regulation has been modeled. Site, north and optional specifications may be unknown. The stricter architectural schema excludes planar imports. The existing HTTP plan endpoints continue to accept V1 only.

## Precision and coordinates

- `schemaVersion: 2`, `units: 'mm'`, `coordinateSystem: 'x-right-y-up-z-depth'` are mandatory literals.
- X is right, Y is up/elevation, Z is plan depth. In plan, use `(x,z)`; the vertical coordinate is `y`. All horizontal points are in the same building-global frame, including the site, level boundaries and footprints. No object-local transforms are implicit.
- The origin is an author-selected local building datum, not necessarily a survey corner or ground. Negative X/Z coordinates and negative level elevations are valid. An entity's Y coordinate is `level.elevationMm + entity offset`; wall openings add wall base and opening sill. Plate top offsets are relative to the level, and thickness extends downward.
- A site's optional named reference datum locates the building origin in an aligned external frame. It is not a geospatial CRS or map projection. `northMilliDegrees` measures from +Z toward +X, modulo 360 degrees (0–359999). Null means orientation unknown. No solver invents north or transforms individual entities.
- Stored coordinates and physical dimensions are finite integer millimetres. Coordinates lie within ±100,000,000 mm; individual lengths are positive and at most 100,000,000 mm. Zero is allowed for offsets, never positive physical dimensions. These are model engineering bounds, not regulations.
- Decimal conversions parse base-ten strings into BigInt rational numbers and round once, nearest mm with half ties away from zero. Numeric inputs mean their JavaScript decimal serialization; precision already lost by a caller cannot be restored. Prefer strings for external decimals. Exact factors: metre = 1000 mm, cm = 10 mm, foot = 1524/5 mm, inch = 127/5 mm. Thus one foot becomes 305 canonical mm, but five feet becomes exactly 1524 mm. `feetAndInchesToMillimetres` combines signed additive components before rounding.
- `fromMillimetres` returns fixed-decimal display strings (0–12 decimal places), using the same rounding policy. Display strings never implicitly modify geometry.
- Polygon predicates, squared distance, shoelace area and dimension reconciliation use BigInt intermediates. The serialized model contains no BigInt. Area helpers return exact decimal strings in mm², including `.5` for half-square-mm grid triangles. Areas beyond Number.MAX_SAFE_INTEGER remain exact.
- Diagonal lengths may be irrational. `segmentLengthMm` uses integer square root and nearest-mm rounding. Polygon perimeter sums individually rounded edges; it does not claim exact irrational perimeter. Wall areas and simple prism volumes use that declared rounded length, so diagonal results are deterministic approximations. Orthogonal and integer-length diagonal results are exact. Opening-fit validation compares exact squared distances, never rounded wall lengths.

## Entities and topology

| Entity | Meaning |
| --- | --- |
| Site | Simple polygon, optional buildable polygon, nullable north, optional reference origin, edge-indexed setback declarations. Edge references address vertices within this one site, not entity IDs. Setbacks are represented but not converted into municipal rules. |
| Level | Stable ID, index/name/kind, signed elevation, nullable floor-to-floor height, simple plan envelope. Index and elevation order agree. Declared floor-to-floor height reconciles with the next represented level. |
| Space | Stable ID, level reference, extensible classification/name, simple boundary polygon, optional occupancy/use/specification. Architectural boundaries use wall centerlines. Imported V1 boundaries remain unspecified. Area is derived; it is not automatically net usable floor area. Room constraints can use vertex-anchored dimensions. |
| Wall | Directed straight centerline, level, thickness, height and base offset, classification and optional specification. Cross section is symmetric about the line. Ends are perpendicular butt planes; junction joins are deferred. A planar import can leave construction/path convention unknown. |
| Opening | Discriminated door/window/generic opening; host wall/level, offset measured from path start along the wall, width, height, sill measured above host base, type/specification. Walls have no duplicate opening list. |
| Door operation | Hinged start/end, left/right swing and millidegree angle; sliding start/end; or explicitly unspecified operation. Left in the `(x,z)` plan is the normal `(-dz,+dx)` of the directed path. All void dimensions remain known even when operation is unspecified. |
| Stair | One straight axis-aligned ascending flight. Source/destination levels, rectangular footprint, width/rise/run, per-riser integer heights, tread depth, direction, optional declared headroom, up to two endpoint landings. Riser count = array length; tread count = riser count minus one. Uniform risers are not assumed or prescribed. |
| Plate | Floor, flat roof or independent ceiling; polygon outer ring and voids, thickness, level, top offset and optional specification. A floor slab's underside is already its physical ceiling surface; add a ceiling plate only for a separate assembly. |
| Column | Basic vertical extrusion of a polygon cross section with optional voids, level/base/height and specification. No structural properties or capacity calculation. |
| Dimension | X/Y/Z projected chain of point, wall-end, space-vertex, opening-edge or level anchors. Derived dimensions store no duplicate measured number. Controlling dimensions store overall/segment targets that must match each other and the referenced geometry exactly. |
| Specification | Stable ID, descriptive name, material label and optional external reference. No prices or rate-table values. |

All IDs, including landings and setback declarations, are unique within a document. Strings, not permanent array indices, cross-reference entities. Space-vertex and site-edge indices are explicitly local geometry references: topology edits must update those references. Adapters derive wall IDs from directed source geometry because V1 has no wall IDs; these imported IDs persist when arrays reorder but change if source geometry changes. V2 editors should subsequently retain assigned IDs when editing.

Opening orientation follows its host. A 3D renderer uses host start, unit tangent and normal, thickness, global base and height. A wall-relative interval gives the rectangular void. Rational/irrational diagonal transforms are renderer calculations; rounding them must not rewrite authoritative geometry. Opening-edge dimension anchors currently require axis-aligned walls to keep projected coordinates integral. Free point anchors are explicit dimension geometry, not automatically associated with a physical object. Use entity anchors when dimensions must track edits.

`wallSpaceIds`, `openingSpaceIds` and `wallOpenings` derive relationships. Optional stored wall `spaceIds` must exactly match same-level boundary adjacency and cannot contain duplicates. This adjacency is geometric; an unmodeled space cannot be inferred from an empty list. A connected door inherits the host's space relationships. Stair endpoints establish vertical connectivity. No duplicated reverse lists exist on spaces or levels.

## Validation scope

Simple nonzero rings may be concave and use either winding. Do not repeat the first vertex at the end. Forward collinear vertices are allowed; duplicate vertices, retraced edges, crossing/touching non-adjacent edges and zero area fail. Plate voids must lie strictly inside the outer ring and must not touch, overlap or nest.

Space polygons and wall paths stay within level envelopes; levels stay inside a supplied site/buildable polygon. Containment checks complete edges across concavities. Space interiors on the same level may not overlap; touching boundaries are valid. Collinear walls cannot overlap. Wall top cannot exceed a declared storey height; resulting entity elevations must fit the coordinate envelope. Envelope containment describes centerline/footprint geometry, not setbacks or offset wall-solid clearance.

Doors/windows/openings must reference a physically specified same-level wall, fit its exact extent/height, and not overlap in wall-relative 2D rectangles. Edge-touching and vertically separated openings are valid. Dimensions must be strictly monotonic along the measured axis. A controlling chain with 3000, 2500 and 3500 mm must reconcile to 9000 mm and actual anchor geometry.

Stair rise matches destination minus source elevation; risers sum exactly to that rise, and tread count/depth reconcile to run. The footprint matches run/width/direction and lies inside both envelopes. Landings must be at the appropriate endpoint elevation, adjoin the full correct flight end, remain inside the level, and not overlap the flight. Stair headroom is a declared geometric value, not a collision result. Destination slab voids are explicit geometry; automatic flight/solid collision and headroom QA are deferred.

Same-kind plates on a level require disjoint outer footprints (all floor plates, or plates at the same height for other kinds). Insets into another plate's void are deliberately unsupported in this version, preventing double counting in the simple floor-area helper. Shape arrays have explicit finite limits; this validator uses pairwise geometric checks, not a large-campus spatial index.

## Measurements and compatibility

`polygonAreaMm2`, `footprintAreaMm2`, `polygonPerimeterMm`, `segmentLengthMm`, `openingAreaMm2`, `wallMeasurements`, `grossFloorAreaMm2`, and `dimensionMeasurements` are independent helpers. Wall measurements describe one face and a butt-ended prism with hosted rectangular voids deducted. They do not resolve overlapping wall junction solids or aggregate materials. Floor area sums floor plates with voids deducted across levels; it excludes roofs and ceilings and is not a jurisdiction-defined legal GFA. No floor plates means unknown: the helper throws rather than substituting room/bounds area. Unknown wall construction returns null surface/volume measurements.

`upgradePlanV1` validates V1, rounds decimal endpoint sums once, converts rooms and segments, and uses a synthetic zero datum explicitly labeled as a legacy datum. It never asserts actual ground elevation, surveyed site, north, floor assembly, wall dimensions, door identity/swing, windows, materials or generator version. V1 gap geometry is insufficient for those facts. The unchanged V1 source remains the authoritative legacy record. Furniture and ambiguous window intervals are not mapped; structured diagnostics report those omissions and quantization. Prompt history is not copied. Existing seed/variant/saved ID are optional safe provenance; overlong seeds are omitted with a diagnostic. Invalid/collapsed quantized geometry fails rather than being silently repaired.

`parseArchitecturalDocument` recognizes V2 only by an explicit valid version; unversioned data is validated as V1. Unknown explicit versions fail. JSON serialization always validates. There is no V2-to-V1 downgrade and no V2 HTTP persistence in this phase. The existing database's V1 metadata constraints, ownership, RLS, estimates and idempotency remain intact.

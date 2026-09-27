# Phase 14 design — construction material requirements

Baseline verified before edits: clean main at cceb01d, identical to
backend-v1-phase13-complete. Phases 5–13 remain frozen except additive wiring.

## Architecture and boundary

Accepted immutable revision → accepted QA → immutable Phase 13 takeoff →
explicit construction specification → source-controlled recipe pack → material
requirements → immutable construction calculation. The pure package depends on
quantity-takeoff and Zod only; no geometry generator, QA, database, clock, network,
AI, or market data. Official routes load stored takeoffs. Phase 15 can reference
calculationId/takeoffId/revisionId and consume stable material codes and units;
it must not reconstruct these formulas. No costing, labor, or V1 estimate changes.

## Material taxonomy and units

CEMENT (kg), SAND and COARSE_AGGREGATE (m3), FIRED_CLAY_BRICK, CONCRETE_BLOCK,
AAC_BLOCK, FLOOR_TILE (piece), READY_MIX_CONCRETE (m3), PRIMER and PAINT (l),
PUTTY (kg), DOOR_UNIT and WINDOW_UNIT (each). No ambiguous unitless quantities.
Geometric inputs use authoritative mm2/mm3/each strings, never rounded display
values. SI physical conversion divides by 10^6 or 10^9; l↔ml and kg↔g use 1000.
Cement kg↔bag depends on explicit bagMassKg and is an assembly conversion.

## Specification and mapping

Versioned, strict runtime schemas contain assemblies and assignments. Each
assignment names a supported takeoff basis, assembly, selector, and explicit
layerId. Precedence: entity > V2 specification > classification > level > default.
Equal-precedence matches for the same item/layer are errors, even if they name
the same assembly. Entity selection matches the primary entity only, never a
host wall attached as secondary provenance. Unassigned eligible bases return
NOT_EVALUATED. Unknown assembly references are invalid; no implicit brick/default
material. Explicit default selectors are recorded in assumptions. Distinct layers
must be named and intentional. Only the dedicated FLOOR_FINISH_BASE_AREA feeds
flooring; SPACE_FLOOR_AREA and aggregates never duplicate it. Layer IDs are unique
per assembly family on a basis, and multiple physical layers require explicit
allowMultipleLayers. Wall sides (1 or 2) must be supplied for surface assemblies;
interior/exterior faces are not inferred from wall classifications.

## Recipe pack and exact formulas

Source-controlled construction-recipes/1 defines formula IDs, supported bases,
parameter names, outputs, rounding and limitations. All construction constants
are supplied in the versioned specification; no universal densities, mixes,
coverage, bag sizes or wastage defaults. Fixtures are synthetic arithmetic
examples, not engineering, manufacturer, or jurisdictional recommendations.

* Masonry: simplified one-wythe volumetric modules, module =
  (length + longitudinal joint) × (height + bed joint) × depth in mm3. Wall
  thickness must equal unit depth. Count = net wall prism / module; wet mortar =
  net prism − count × unit envelope. Unit envelopes exclude mortar; hollow-unit
  cavities, bonds, junction unions and cutting are not solved. Supported recipes
  require solid rectangular units. Mortar omission is PARTIAL, never zero mortar.
* Mortar/plaster: wet × dryFactor; cement volume = dry × cementParts / totalParts;
  cement kg = cement volume × configured bulk density; sand = dry × sandParts /
  totalParts. Plaster wet = net single face area × sides × thickness.
* Concrete: READY_MIX_VOLUME_ONLY emits explicit slab/flat-roof/architectural-column
  volume, or NOMINAL_VOLUMETRIC_RECIPE splits dry volume among configured cement,
  sand and coarse aggregate parts. No structural mix design or strength claim.
* Flooring: area / rectangular tile area; area-based estimate, no cut optimization.
* Coatings: area × sides × coats / configured coverage in m2 per l (paint/primer)
  or m2 per kg (putty). Layers have stable IDs and distinct outputs.
* Components: explicit door/window count to corresponding configured unit;
  no generic passage conversion or hardware BOM.

## Precision, wastage and purchase rounding

The existing estimate uses isolated Decimal. Construction instead uses reduced
BigInt rational arithmetic to preserve exact repeating fractions and exact ceil
boundaries without precision-dependent purchase decisions. No floating-point
accumulation. Inputs are bounded decimal strings (≤6 fractional places).
Output quantity strings round half-up at the selected 6–12 decimal places (9 by
default). Exact numerator/denominator evidence preserves theoretical values.
finalExact = theoreticalExact × (1 + wastagePercent/100), with wastage explicitly
required and bounded 0–100. Emitted wastage = rounded final − rounded theoretical
so emitted arithmetic reconciles. Purchase rounding uses the unrounded rational:
pieces/each ceil(finalExact), cement bags ceil(finalExactKg/bagMassKg). Both
theoretical and adjusted bag equivalents remain visible. Continuous materials
have no purchase rounding. Procurement occurs per material line; aggregates sum
emitted lines, including per-line rounded purchases, and never round a pooled
theoretical total. Different bag masses remain separate purchase groups.

## Report, provenance, coverage and resource limits

Reports include engine/takeoff/policy/recipe/specification versions, normalized
options/specification, calculation items, materials, structured formula evidence,
warnings, assumptions, and coverage. Every material points to a calculation item,
takeoff item code/ID, and architectural IDs. Aggregates derive only from emitted
material strings grouped by material/unit, level, assembly, and specification.
EVALUATED means the configured recipe was evaluated, not whole-project completeness;
PARTIAL identifies modeled simplifications; NOT_EVALUATED identifies absent or
unsupported work. Upstream partial/unsupported status is preserved.
Bound JSON input/output, assemblies, mappings, candidate matching work, calculation
items, materials, evidence, warnings and sections; fail with typed resource errors.

## Unsupported categories

Structural reinforcement, foundations/excavation, MEP, structural stairs, ceiling
assemblies, waterproofing, pitched roofs, adhesive/grout, hardware/glazing BOM and
cutting optimization are NOT_EVALUATED. No unsupported quantity is reported as zero.

## Persistence, security and reproducibility

Add migration 0008 only. Immutable project_revision_construction_calculations rows
reference the exact takeoff and revision through a composite FK. Ownership derives
through revision/project. Owner-only SELECT even for public projects; direct client
INSERT/UPDATE/DELETE revoked. Signed write RPC reuses project_private.commit_key,
binding caller, operation, full input/report, context and expiry. RPC rechecks accepted
QA and source versions, independently recomputes fingerprint including takeoff ID,
takeoff input fingerprint, canonical report content hash, engine, recipe, normalized
specification and options. Unique fingerprints converge keyless requests. Existing
durable receipts and artifact insert commit in one transaction. Identical identity
with changed report fails closed. Read RPC returns bounded keyset pages and exact
reports. No existing takeoff/revision/current pointer mutation.

## Verification plan

Hand-calculated fixtures, rational boundaries, controlled specification/version
changes, golden takeoff invariants, mapping conflicts, duplicate prevention,
resource limits, JSON/frozen/parallel/order independence. Real PostgreSQL tests
exercise signing, provenance, RLS, immutability, atomic rollback and concurrency;
shared acceptance runs through real local Supabase Auth/JWT/PostgREST twice.
Run the complete requested gate, including integration three times, disposable
local database reset/pgTAP, Docker and smoke. Record exact counts and limitations.

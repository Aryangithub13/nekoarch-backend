# @designflow/generator

Portable, deterministic single-floor residential plan generation. The package has no API, database, HTTP, rendering, browser-global or Node runtime dependency. It returns the existing canonical `Plan`; saving it remains the responsibility of the existing backend.

```ts
import {
  generatePlan,
  parseRequirements,
  GenerationError,
} from '@designflow/generator';

const input = parseRequirements('2BHK modern flat with open kitchen');
try {
  const plan = generatePlan(input, { seed: 'design-42', variant: 1 });
  // plan is ready for the existing POST /api/plans body: { plan }.
  // No persistence ID is generated here.
} catch (error) {
  if (error instanceof GenerationError) {
    // error.code, error.message and optional error.fieldErrors are public.
  } else {
    throw error;
  }
}
```

The prompt adapter is optional. The core accepts normalized design requirements directly:

```ts
const plan = generatePlan({
  prompt: 'A compact home with a connected kitchen and living room',
  bounds: { x: 0, z: 0, w: 10, d: 12 },
  rooms: [
    { type: 'bedroom', count: 2 },
    { type: 'bathroom', count: 1 },
    { type: 'living', count: 1 },
    { type: 'kitchen', count: 1 },
  ],
  adjacency: [{ from: 'kitchen', to: 'living' }],
}, { seed: 'design-42', variant: 1 });
```

## Contract and limits

Input is validated at runtime. `prompt` reuses the canonical 1–500 character limit, with whitespace-only prompts rejected. `bounds` reuses `RectSchema` and normalizes coordinates to six decimal places in metres. The MVP allows dimensions from 3 to 60 metres, origins from −1,000 to 1,000 metres, at most 24 requested rooms, and one count group per type with 1–8 rooms. These are explicit engineering bounds for a predictable MVP, not architectural standards or legal requirements. A valid request can still be too small for its specified rooms/furniture and fail with `IMPOSSIBLE_LAYOUT`.

Supported room types are `bedroom`, `bathroom`, `living`, `kitchen`, `dining` and `study`. A generated `circulation` room may be added; it does not replace a requested room. Floor numbers and commercial/institutional building classifications are not part of this generator. The estimator's building types are unchanged.

An adjacency requires at least one pair of the two named types to share a direct opening. Chains are supported; branching/cyclic requirement graphs are outside the strip-layout family. Missing types, self-adjacency and duplicate pairs are rejected. Unknown fields are rejected instead of ignored.

Options are an optional 1–128 character seed and the existing positive PostgreSQL-integer variant, defaulting to 1. Without a seed, the package derives one from the full normalized input, including prompt text. Same normalized input, seed and variant produce the same values and array order. No unseeded randomness, clock, UUID or mutable global state participates. A different seed/variant can select a different arrangement but is not guaranteed to produce a unique layout.

## Prompt normalization

`parseRequirements(prompt)` is a small English keyword/count adapter, separate from layout. It supports BHK counts, explicit room counts, common room-name aliases, one metre footprint such as `12m x 10m`, and `open kitchen`. It does not call an LLM.

- BHK expands to its bedroom count, one bathroom, one living room and one kitchen.
- Explicit room lists contain only the named room types. `open kitchen` also includes living and requires a direct kitchen/living opening.
- Prose without recognized room requirements defaults to two bedrooms, one bathroom, living and kitchen. Default bounds are 10m wide and `max(8, ceil(roomCount / 2) × 3.6)` metres deep.
- Style descriptions are retained in the prompt; no style-specific layout or furnishing rules are applied. Prompt text contributes to the default seed. Supply an explicit seed to hold the arrangement stable across text-only changes.
- Recognized unsupported requirements—such as studio/nonrectangular footprints, additional storeys, room exclusions, ambiguous counts, non-metre units and extra dimensions—fail explicitly. General natural-language interpretation is not promised; use structured input for precise requirements.

## Modules and geometry

| Module | Responsibility |
| --- | --- |
| `input.ts` | Canonical-schema reuse, generator input/options and separate prompt normalization |
| `random.ts` | Fixed integer seed hashing and a centralized seeded random source |
| `layout.ts` | Room identities, adjacency chains, balanced room allocation, circulation and door locations |
| `geometry.ts` | Shared edges, T-junction splitting, wall construction and opening inference |
| `furniture.ts` | Nominal furniture dimensions and bounded relational placement |
| `invariants.ts` | Independent runtime schema, geometry, connectivity and furniture checks |
| `generate.ts` | Stage orchestration, bounded retries and typed failures |
| `errors.ts` | Portable domain errors |

The generator tries at most twelve candidates: two orientations, three layout families and two opening positions. The room allocation uses bounded subset-sum over at most 24 room counts, preserving each adjacency chain while balancing the two sides. Corridors are 1.2m wide. Multi-room strip spans use a 3.2m minimum. Narrow footprints can use a room-to-room chain without a separate corridor; this permits through-room circulation and does not enforce bedroom privacy.

The canonical model has no door objects or floor IDs. Openings are actual gaps in otherwise complete orthogonal wall segments. Internal room IDs used while building openings do not add fields to `Plan`. Standard openings are 0.9m, requested room-pair openings may be 1.2m, and the verifier permits gaps from 0.9 to 1.4m. These dimensions are MVP geometric choices, not code-compliance claims. Windows are omitted because the existing optional `window` interval has no defined generation semantics in the supplied specification.

Furniture uses centre coordinates and quarter-turn rotations: zero faces +z, then +x, −z and −x. `FURNITURE_DIMENSIONS` is the single nominal footprint source. Beds, sofas, counters, dining tables and desks are primary pieces for their respective rooms. Bedside tables, opposite-facing TVs and chairs are added where they fit. Placement preserves a 0.05m wall margin, one-metre doorway approaches, containment and non-overlap. Optional companions may be omitted in tight rooms. Bathrooms remain unfurnished because the canonical furniture enum has no bathroom fixtures; circulation remains clear. There is no full pedestrian pathfinding or accessibility-certification solver.

## Validation and failures

Every successful output passes `PlanSchema` and `assertPlanInvariants`. Checks include finite geometry, unique IDs, footprint containment and full tiling, required room counts/types, wall alignment/non-overlap, actual doorway connectivity to an exterior entrance, direct adjacency, furniture containment/non-overlap/door clearance, and exact QA counts. Input and invariant validation do not leak exceptions from hostile getters or proxies.

`GenerationError.code` is one of `INVALID_INPUT`, `UNSUPPORTED_REQUIREMENT`, `IMPOSSIBLE_LAYOUT`, `INVARIANT_FAILURE` or `GENERATION_FAILED`. There are no unbounded retries. This is a geometric MVP, not a structural design or building-code assessment.

Run from the repository root:

```sh
npm run test:generator
npm run build
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
```

The root checks include generator tests and Node/browser compilation. No generation endpoint or frontend integration is introduced by Phase 6.

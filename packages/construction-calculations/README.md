# Construction calculations

Pure, deterministic material requirements from `@designflow/quantity-takeoff` reports and explicit versioned specifications. No geometry generation, prices, network, database, clocks, or inferred construction constants.

```ts
import { calculateConstruction } from '@designflow/construction-calculations';
const report = calculateConstruction(takeoff.report, {
  id: 'floor-spec', version: '1',
  recipePack: { id: 'construction-recipes', version: '1' },
  assemblies: [{
    id: 'tile', kind: 'flooring', tileLengthMm: 500, tileWidthMm: 500,
    wastagePercent: '10',
  }],
  assignments: [{
    id: 'floor', basis: 'FLOOR_FINISH_BASE_AREA', assemblyId: 'tile',
    layerId: 'finish', selector: { kind: 'default' },
  }],
}, { quantityDecimalPlaces: 9 });
```

Example parameters above are synthetic. Supply project/manufacturer specifications explicitly.

Supported assemblies: solid rectangular one-wythe masonry, mortar, plaster, nominal volumetric concrete or ready-mix volume, rectangular floor tiles, paint/primer/putty, and door/window units. Mapping precedence is entity > specification > classification > level > default. Entity selectors match only the primary takeoff entity. Equal-precedence candidates within an assembly family/layer are rejected. Additional physical layers require `allowMultipleLayers: true`.

Reports retain exact rational theoretical/final quantities, displayed decimals, formula evidence, source entity and takeoff item IDs, selected assignment/layer/recipe, coverage, warnings, and grouped totals. Wastage is explicit; bag masses, mix parts, density, dry factors, sides and coating coverage are explicit. Purchase counts round upward per source material line using the exact fraction. Aggregates sum those per-line purchases and separate different bag masses.

Coverage is not a claim that the whole project has been evaluated. Upstream partial/unsupported status survives. Unassigned inputs are reported, not treated as zero materials. Structural reinforcement, MEP, foundations, structural stairs, ceilings, waterproofing, pitched roofs, adhesive/grout, hardware/glazing bills and cutting optimization remain unsupported.

The HTTP API loads an immutable stored takeoff itself; callers cannot submit their own takeoff/report or accepted QA metadata. See `docs/PHASE14.md` for persistence and endpoints. Run `npm run test:construction` from the repository root (integration tests require a local socket).

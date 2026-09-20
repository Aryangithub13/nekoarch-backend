import type { z } from 'zod';
import type { BuildingModelV2 } from './model-shape.js';
import { CoordinateMmSchema, reconcileDimensions } from './units.js';
import { abs, cross, lengthSquared, ringContains, ringsOverlap, ringsTouch, segmentInRing, signedArea2 } from './geometry.js';
import { dimensionMeasurements, dimensionPoints, wallSpaceIds } from './relationships.js';

export function validateBuildingInvariants(model: BuildingModelV2, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const levels = new Map(model.levels.map(l => [l.id, l]));
  const walls = new Map(model.walls.map(w => [w.id, w]));
  const specs = new Set(model.specifications.map(s => s.id));
  const ids = new Set<string>();
  function register(id: string, path: (string | number)[]) {
    if (ids.has(id)) issue(path, 'Entity IDs must be unique throughout the document');
    ids.add(id);
  }
  register(model.id, ['id']);
  if (model.site) {
    register(model.site.id, ['site', 'id']);
    model.site.setbacks.forEach((s, i) => {
      register(s.id, ['site', 'setbacks', i, 'id']);
      if (s.boundaryEdgeStart >= model.site!.boundary.length) issue(['site', 'setbacks', i], 'Setback edge must exist');
    });
    if (model.site.buildableBoundary && !ringContains(model.site.boundary, model.site.buildableBoundary)) issue(['site', 'buildableBoundary'], 'Buildable region must be contained in site');
  }
  const collections = ['levels', 'spaces', 'walls', 'openings', 'stairs', 'slabs', 'columns', 'dimensions', 'specifications'] as const;
  for (const key of collections) model[key].forEach((entity, index) => {
    register(entity.id, [key, index, 'id']);
    if ('levelId' in entity && entity.levelId && !levels.has(entity.levelId)) issue([key, index, 'levelId'], 'Level reference must resolve');
    if ('specificationId' in entity && entity.specificationId && !specs.has(entity.specificationId)) issue([key, index, 'specificationId'], 'Specification reference must resolve');
  });
  model.stairs.forEach((stair, i) => stair.landings.forEach((landing, j) => register(landing.id, ['stairs', i, 'landings', j, 'id'])));
  const complete = model.completeness === 'architectural';
  if (!complete && model.provenance.creationMode !== 'legacy-adapter') issue(['provenance'], 'Planar documents must declare legacy-adapter provenance');
  if (model.provenance.creationMode === 'legacy-adapter' && !model.provenance.adapterVersion) issue(['provenance'], 'Legacy adaptation requires an adapter version');
  if (!complete && (model.openings.length || model.stairs.length || model.slabs.length || model.columns.length)) issue(['completeness'], 'Planar imports cannot assert construction entities');

  const indices = new Set<number>(); const elevations = new Set<number>();
  model.levels.forEach((level, i) => {
    if (indices.has(level.index)) issue(['levels', i, 'index'], 'Level index must be unique');
    if (elevations.has(level.elevationMm)) issue(['levels', i, 'elevationMm'], 'Level elevation must be unique');
    indices.add(level.index); elevations.add(level.elevationMm);
    const higher = model.levels.filter(l => l.index > level.index).sort((a, b) => a.index - b.index)[0];
    if (higher && higher.elevationMm <= level.elevationMm) issue(['levels', i], 'Level index and elevation order must agree');
    if (level.floorToFloorHeightMm !== null) {
      if (!CoordinateMmSchema.safeParse(level.elevationMm + level.floorToFloorHeightMm).success) issue(['levels', i], 'Next floor elevation exceeds coordinate range');
      if (higher && higher.elevationMm - level.elevationMm !== level.floorToFloorHeightMm) issue(['levels', i, 'floorToFloorHeightMm'], 'Floor-to-floor height must match next represented level');
    }
    if (model.site && !ringContains(model.site.buildableBoundary ?? model.site.boundary, level.boundary)) issue(['levels', i, 'boundary'], 'Level boundary must stay in site/buildable region');
  });
  model.spaces.forEach((space, i) => {
    const level = levels.get(space.levelId);
    if (level && !ringContains(level.boundary, space.boundary)) issue(['spaces', i, 'boundary'], 'Space must remain inside level boundary');
    if (complete && space.boundaryBasis === 'unspecified') issue(['spaces', i, 'boundaryBasis'], 'Architectural space needs a known boundary convention');
    for (let j = 0; j < i; j++) if (model.spaces[j]!.levelId === space.levelId && ringsOverlap(space.boundary, model.spaces[j]!.boundary)) issue(['spaces', i], 'Space interiors on a level must not overlap');
  });
  model.walls.forEach((wall, i) => {
    const level = levels.get(wall.levelId);
    if (complete && (wall.pathReference !== 'centerline' || wall.thicknessMm === null || wall.heightMm === null || wall.baseOffsetMm === null)) issue(['walls', i], 'Architectural walls require centerline, thickness, height and base');
    if (level && !segmentInRing(wall.path.start, wall.path.end, level.boundary)) issue(['walls', i, 'path'], 'Wall path must stay in level boundary');
    if (level && wall.baseOffsetMm !== null && wall.heightMm !== null) {
      if (!CoordinateMmSchema.safeParse(level.elevationMm + wall.baseOffsetMm + wall.heightMm).success) issue(['walls', i], 'Wall top exceeds coordinate range');
      if (level.floorToFloorHeightMm !== null && wall.baseOffsetMm + wall.heightMm > level.floorToFloorHeightMm) issue(['walls', i], 'Wall top exceeds level storey height');
    }
    const adjacent = wallSpaceIds(model, wall);
    if (wall.classification === 'exterior' && adjacent.length === 2) issue(['walls', i, 'classification'], 'Exterior walls cannot divide two modeled spaces');
    if (adjacent.length > 2) issue(['walls', i], 'Wall may bound at most two spaces');
    if (wall.spaceIds && (new Set(wall.spaceIds).size !== wall.spaceIds.length || [...wall.spaceIds].sort().join('|') !== adjacent.join('|'))) issue(['walls', i, 'spaceIds'], 'Stored space topology must equal geometric same-level adjacency');
    for (let j = 0; j < i; j++) {
      const other = model.walls[j]!;
      if (wall.levelId !== other.levelId) continue;
      const { start: a, end: b } = wall.path; const { start: c, end: d } = other.path;
      if (cross(a, b, c) !== 0n || cross(a, b, d) !== 0n) continue;
      const axis = a.x !== b.x ? 'x' : 'z';
      if (Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) > Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]))) issue(['walls', i], 'Collinear wall paths may not overlap');
    }
  });
  model.openings.forEach((opening, i) => {
    const wall = walls.get(opening.wallId);
    if (!wall) { issue(['openings', i, 'wallId'], 'Opening host wall must resolve'); return; }
    if (wall.levelId !== opening.levelId) issue(['openings', i, 'levelId'], 'Opening and wall levels must agree');
    if (wall.heightMm === null || wall.thicknessMm === null || wall.baseOffsetMm === null || wall.pathReference !== 'centerline') issue(['openings', i], 'Opening host must have complete construction geometry');
    if (BigInt(opening.offsetMm + opening.widthMm) ** 2n > lengthSquared(wall.path)) issue(['openings', i, 'widthMm'], 'Opening exceeds exact host wall extent');
    if (wall.heightMm !== null && opening.sillMm + opening.heightMm > wall.heightMm) issue(['openings', i, 'heightMm'], 'Opening exceeds host wall height');
    for (let j = 0; j < i; j++) {
      const other = model.openings[j]!;
      if (other.wallId === opening.wallId
        && Math.min(other.offsetMm + other.widthMm, opening.offsetMm + opening.widthMm) > Math.max(other.offsetMm, opening.offsetMm)
        && Math.min(other.sillMm + other.heightMm, opening.sillMm + opening.heightMm) > Math.max(other.sillMm, opening.sillMm)) issue(['openings', i], 'Hosted opening rectangles may not overlap');
    }
  });
  model.slabs.forEach((slab, i) => {
    const level = levels.get(slab.levelId);
    if (!level) return;
    if (!ringContains(level.boundary, slab.footprint.outer)) issue(['slabs', i, 'footprint'], 'Plate footprint must stay in level boundary');
    for (let j = 0; j < i; j++) {
      const other = model.slabs[j]!;
      if (other.levelId === slab.levelId && other.kind === slab.kind
        && (slab.kind === 'floor' || other.topOffsetMm === slab.topOffsetMm)
        && ringsOverlap(other.footprint.outer, slab.footprint.outer)) issue(['slabs', i], 'Same-level plates of the same kind require disjoint outer footprints');
    }
    const top = level.elevationMm + slab.topOffsetMm;
    if (![top, top - slab.thicknessMm].every(n => CoordinateMmSchema.safeParse(n).success)) issue(['slabs', i], 'Plate elevation exceeds coordinate range');
  });
  model.columns.forEach((column, i) => {
    const level = levels.get(column.levelId);
    if (!level) return;
    if (!ringContains(level.boundary, column.crossSection.outer)) issue(['columns', i], 'Column cross-section must stay in level boundary');
    if (![level.elevationMm + column.baseOffsetMm, level.elevationMm + column.baseOffsetMm + column.heightMm].every(n => CoordinateMmSchema.safeParse(n).success)) issue(['columns', i], 'Column elevation exceeds coordinate range');
    if (level.floorToFloorHeightMm !== null && column.baseOffsetMm + column.heightMm > level.floorToFloorHeightMm) issue(['columns', i], 'Column top exceeds level storey height');
  });
  model.stairs.forEach((stair, i) => {
    const from = levels.get(stair.fromLevelId); const to = levels.get(stair.toLevelId);
    if (!from || !to || from.id === to.id) { issue(['stairs', i], 'Stairs need valid distinct source/destination levels'); return; }
    if (to.elevationMm - from.elevationMm !== stair.riseMm) issue(['stairs', i, 'riseMm'], 'Rise must equal destination minus source elevation');
    if (stair.riserHeightsMm.reduce((n, h) => n + BigInt(h), 0n) !== BigInt(stair.riseMm)) issue(['stairs', i, 'riserHeightsMm'], 'Risers must exactly sum to rise');
    if (BigInt(stair.treadDepthMm) * BigInt(stair.riserHeightsMm.length - 1) !== BigInt(stair.runMm)) issue(['stairs', i, 'runMm'], 'Run must equal tread depth times riser count minus one');
    if (!ringContains(from.boundary, stair.footprint) || !ringContains(to.boundary, stair.footprint)) issue(['stairs', i, 'footprint'], 'Stair must remain in both level envelopes');
    const xs = stair.footprint.map(p => p.x); const zs = stair.footprint.map(p => p.z);
    const dx = Math.max(...xs) - Math.min(...xs); const dz = Math.max(...zs) - Math.min(...zs);
    if ((stair.direction.endsWith('x') ? dx !== stair.runMm || dz !== stair.widthMm : dz !== stair.runMm || dx !== stair.widthMm)
      || abs(signedArea2(stair.footprint)) !== 2n * BigInt(dx) * BigInt(dz)) issue(['stairs', i, 'footprint'], 'Straight flight footprint must match run, width and direction');
    const landingElevations = new Set<number>();
    stair.landings.forEach((landing, j) => {
      if (landingElevations.has(landing.elevationOffsetMm)) issue(['stairs', i, 'landings', j], 'Only one landing is permitted at each flight end');
      landingElevations.add(landing.elevationOffsetMm);
      if (landing.elevationOffsetMm !== 0 && landing.elevationOffsetMm !== stair.riseMm) issue(['stairs', i, 'landings', j], 'Straight-flight landings are at source or destination elevation');
      if (!ringContains(landing.elevationOffsetMm === 0 ? from.boundary : to.boundary, landing.footprint)) issue(['stairs', i, 'landings', j], 'Landing must remain in its level boundary');
      const axis = stair.direction.endsWith('x') ? 'x' : 'z';
      const crossAxis = axis === 'x' ? 'z' : 'x';
      const ascending = stair.direction.startsWith('+');
      const topLanding = landing.elevationOffsetMm === stair.riseMm;
      const endCoordinate = (ascending === topLanding ? Math.max : Math.min)(...stair.footprint.map(p => p[axis]));
      const low = Math.min(...stair.footprint.map(p => p[crossAxis]));
      const high = Math.max(...stair.footprint.map(p => p[crossAxis]));
      const contactStart = axis === 'x' ? { x: endCoordinate, z: low } : { x: low, z: endCoordinate };
      const contactEnd = axis === 'x' ? { x: endCoordinate, z: high } : { x: high, z: endCoordinate };
      if (!segmentInRing(contactStart, contactEnd, landing.footprint)) issue(['stairs', i, 'landings', j], 'Landing must span the correct flight end at full width');
      if (ringsOverlap(landing.footprint, stair.footprint) || !ringsTouch(landing.footprint, stair.footprint)) issue(['stairs', i, 'landings', j], 'Landing must adjoin flight without overlapping it');
    });
  });
  model.dimensions.forEach((dimension, i) => {
    if (dimension.anchors.some(a => a.kind === 'level') && dimension.axis !== 'y') issue(['dimensions', i], 'Level anchors measure only elevation');
    if (dimension.levelId) for (const anchor of dimension.anchors) {
      const anchorLevel = anchor.kind === 'level' ? anchor.levelId
        : anchor.kind === 'wall-end' ? walls.get(anchor.wallId)?.levelId
        : anchor.kind === 'space-vertex' ? model.spaces.find(s => s.id === anchor.spaceId)?.levelId
        : anchor.kind === 'opening-edge' ? model.openings.find(o => o.id === anchor.openingId)?.levelId : undefined;
      if (anchorLevel && anchorLevel !== dimension.levelId) issue(['dimensions', i, 'levelId'], 'Dimension level must agree with referenced entities');
    }
    try {
      const points = dimensionPoints(model, dimension);
      if (!points.every(p => Object.values(p).every(n => CoordinateMmSchema.safeParse(n).success))) issue(['dimensions', i], 'Dimension anchor exceeds coordinate range');
      const values = points.map(p => p[dimension.axis]);
      const deltas = values.slice(1).map((v, j) => v - values[j]!);
      if (!deltas.every(d => d > 0) && !deltas.every(d => d < 0)) issue(['dimensions', i], 'Dimension chains must be strictly monotonic along their axis');
      const actual = dimensionMeasurements(model, dimension);
      if (dimension.constraint.mode === 'controlling') {
        const target = dimension.constraint;
        if (!reconcileDimensions(target.overallMm, target.segmentsMm) || actual.overallMm !== target.overallMm
          || actual.segmentsMm.length !== target.segmentsMm.length || actual.segmentsMm.some((v, j) => v !== target.segmentsMm[j])) issue(['dimensions', i, 'constraint'], 'Controlling dimensions must reconcile exactly with each other and geometry');
      }
    } catch { issue(['dimensions', i, 'anchors'], 'Dimension references must resolve to known geometry'); }
  });
}

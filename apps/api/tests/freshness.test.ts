import { describe, expect, it } from 'vitest';
import { generateBlueprint, normalizeBlueprintRequirements } from '@designflow/generator';
import { canonicalBuilding, modelHash, requirementsHash } from '../src/lib/generation-identity.js';
import { requirements, authored } from '../../../packages/blueprint-qa/tests/fixtures.js';

describe('canonical architectural identity', () => {
  it('normalizes defaults, object order and room/relationship/setback order before hashing', () => {
    const a = requirements();
    a.relationships = [{ from: { type: 'bedroom', ordinal: 1 }, to: { type: 'living', ordinal: 1 }, strength: 'soft' }];
    a.site.setbacks = [{ boundaryEdgeStart: 0, minimumMm: 100 }, { boundaryEdgeStart: 2, minimumMm: 200 }];
    const b = normalizeBlueprintRequirements(a);
    b.rooms.reverse(); b.site.setbacks.reverse();
    const edge = b.relationships[0]!; [edge.from, edge.to] = [edge.to, edge.from];
    const reordered = Object.fromEntries(Object.entries(b).reverse());
    expect(requirementsHash(a)).toBe(requirementsHash(reordered));
  });
  it('separates seed and version from architectural requirements without losing solver options', () => {
    const a = requirements();
    expect(requirementsHash(a)).toBe(requirementsHash({ ...a, seed: 'alternative' }));
    expect(requirementsHash(a)).not.toBe(requirementsHash(a, 'next-generator'));
    expect(requirementsHash(a)).not.toBe(requirementsHash({ ...a, solver: { maxCandidates: 1 } }));
    expect(() => requirementsHash({ ...a, timestamp: 'ignored?' })).toThrow();
    expect(() => requirementsHash({ ...a, site: { ...a.site, units: 'feet' } })).toThrow();
  });
  it('changes input hash for bedroom count and site dimensions', () => {
    const a = requirements(), b = structuredClone(a), c = structuredClone(a);
    b.rooms[0]!.count = 4; c.site.boundary[1]!.x += 1000; c.site.boundary[2]!.x += 1000;
    expect(new Set([a, b, c].map(r => requirementsHash(r))).size).toBe(3);
  });
  it('reproduces the same normalized input and seed without geometry drift', () => {
    const a = generateBlueprint(requirements()).model, b = generateBlueprint(normalizeBlueprintRequirements(requirements())).model;
    expect(b).toEqual(a); expect(modelHash(b)).toBe(modelHash(a));
  });
  it('sorts entity collections and wall memberships without mutating geometry or meaningful array order', () => {
    const a = authored(), b = structuredClone(a);
    b.walls.reverse(); b.spaces.reverse(); b.openings.reverse(); b.dimensions.reverse();
    for (const wall of b.walls) wall.spaceIds?.reverse();
    expect(modelHash(a)).toBe(modelHash(b));
    expect(b.walls[0]!.id).toBe('partition');
    b.dimensions[0]!.anchors.reverse();
    expect(modelHash(a)).not.toBe(modelHash(b));
  });
  it('excludes execution provenance and distinguishes changed authoritative geometry', () => {
    const a = authored(), b = structuredClone(a);
    b.provenance = { creationMode: 'generated', generatorVersion: 'other', seed: 'other', measurementVersion: 'mm-exact/1' };
    expect(modelHash(a)).toBe(modelHash(b));
    b.walls[0]!.thicknessMm = b.walls[0]!.thicknessMm! + 20;
    expect(modelHash(a)).not.toBe(modelHash(b));
    expect(canonicalBuilding(a)).not.toHaveProperty('provenance');
  });
  it('honestly hashes seed alternatives even when authoritative models converge', () => {
    const a = generateBlueprint(requirements(1, 'S1')).model, b = generateBlueprint(requirements(1, 'S2')).model;
    expect(modelHash(a) === modelHash(b)).toBe(JSON.stringify(canonicalBuilding(a)) === JSON.stringify(canonicalBuilding(b)));
  });
});

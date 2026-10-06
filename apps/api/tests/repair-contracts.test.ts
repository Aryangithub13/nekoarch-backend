import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ArchitecturalBuildingModelV2Schema } from '@designflow/shared';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { calculateQuantityTakeoff } from '@designflow/quantity-takeoff';
import { calculateConstruction } from '@designflow/construction-calculations';
import { specification } from '../../../packages/construction-calculations/tests/fixtures.js';
import { authored, authoredOptions, generated, rect } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { sourceModel } from '../src/bim/core.js';
import { modelHash } from '../src/lib/generation-identity.js';
import { CAPABILITIES } from '../src/workflows/registry.js';
it.each(['v1','v2','L','setback','maximum-24','modified','specified-material'])('preserves stored Phase 23 hash: %s', name => {
  const fixture = JSON.parse(readFileSync(`docs/phase23-evidence/fixtures/${name}.json`, 'utf8'));
  expect(modelHash(fixture.model)).toBe(fixture.bim.binding.modelHash);
});
it('preserves historical ordered landing identity while canonicalizing top-level collections', () => {
  const m = generated(2), copy = structuredClone(m); copy.walls.reverse(); copy.spaces.reverse();
  expect(modelHash(copy)).toBe(modelHash(m));
  copy.stairs[0]!.landings.reverse();
  expect(ArchitecturalBuildingModelV2Schema.safeParse(copy).success).toBe(true);
  expect(modelHash(copy)).not.toBe(modelHash(m));
});
it('explicitly rejects native columns outside the released architectural BIM profile', () => {
  const m = authored(); m.columns.push({ id: 'single-column', levelId: 'ground', baseOffsetMm: 0, heightMm: 2800, crossSection: { outer: rect(500,500,500,500), voids: [] } });
  expect(ArchitecturalBuildingModelV2Schema.safeParse(m).success).toBe(true);
  expect(auditBlueprint(m, authoredOptions).status).toBe('PASS');
  expect(() => sourceModel(m)).toThrow(expect.objectContaining({ code: 'BIM_UNSUPPORTED_MODEL' }));
  m.columns = []; expect(() => sourceModel(m)).not.toThrow();
});
it('retains the bounded rectangle/L profile without adding T-shaped storeys', () => {
  const m = authored(); const boundary = [{x:0,z:0},{x:8000,z:0},{x:8000,z:6000},{x:6000,z:6000},{x:6000,z:8000},{x:2000,z:8000},{x:2000,z:6000},{x:0,z:6000}];
  m.site!.boundary = boundary; m.levels[0]!.boundary = boundary;
  expect(ArchitecturalBuildingModelV2Schema.safeParse(m).success).toBe(true);
  expect(auditBlueprint(m, authoredOptions).status).toBe('PASS');
  expect(() => sourceModel(m)).toThrow(expect.objectContaining({ code: 'BIM_UNSUPPORTED_MODEL' }));
});
it('retains bounded workflow authority and exact construction precision', () => {
  expect(JSON.stringify(CAPABILITIES)).not.toMatch(/BIM_PROJECTION|IFC_EXPORT/);
  const q = calculateQuantityTakeoff(authored()), spec = specification();
  expect(() => calculateConstruction(q, spec, { quantityDecimalPlaces: 0 })).toThrow();
  const a = calculateConstruction(q, spec, { quantityDecimalPlaces: 6 }), b = calculateConstruction(q, spec, { quantityDecimalPlaces: 12 });
  expect(a.materials.map(m => m.finalExact)).toEqual(b.materials.map(m => m.finalExact));
});

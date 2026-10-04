import { expect, it } from 'vitest';
import { generateParametricBlueprint } from '../src/index.js';
import { calculateQuantityTakeoff } from '@designflow/quantity-takeoff';
import { calculateConstruction } from '@designflow/construction-calculations';
import { specification } from '../../construction-calculations/tests/fixtures.js';
import { parametricInput } from '../../../test-support/parametric-fixtures.js';
it('matches hand-calculated exterior lengths/faces, slab voids/volumes and disjoint roofs', () => {
  const model = generateParametricBlueprint(parametricInput(true)).model, q = calculateQuantityTakeoff(model);
  const sum = (code: string, level?: string, classification?: string) => q.items.filter(i => i.itemCode === code && (!level || i.levelId === level) && (!classification || i.classification === classification)).reduce((s, i) => s + BigInt(i.quantity.value), 0n);
  // L perimeter equals 2(W+D); uniform 100mm centerline inset reduces it by 800mm.
  expect(sum('WALL_CENTERLINE_LENGTH', 'level-0', 'exterior')).toBe(71200n);
  expect(sum('WALL_CENTERLINE_LENGTH', 'level-1', 'exterior')).toBe(63200n);
  expect(sum('WALL_SINGLE_FACE_GROSS_AREA', 'level-0', 'exterior')).toBe(71200n * 2850n);
  expect(sum('FLOOR_PLATE_GROSS_AREA', 'level-0')).toBe(9000n * 18000n + 9000n * 8000n);
  expect(sum('FLOOR_PLATE_GROSS_AREA', 'level-1')).toBe(8500n * 16000n + 7500n * 7000n);
  expect(sum('FLOOR_PLATE_VOID_AREA')).toBe(1000n * 15n * 280n);
  expect(sum('FLOOR_PLATE_VOLUME')).toBe(418300000n * 150n);
  expect(sum('ROOF_NET_AREA')).toBe(234000000n);
  expect(sum('ROOF_NET_AREA', 'level-0')).toBe(45500000n);
  expect(sum('STAIR_RISER_COUNT')).toBe(16n);
  const construction = calculateConstruction(q, specification());
  expect(construction.summary.status).toBe('PARTIAL');
  expect(construction.coverage.some(c => c.category === 'upstream:parametric_stair_core_finish' && c.status === 'NOT_EVALUATED')).toBe(true);
});

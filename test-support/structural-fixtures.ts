import type { BuildingModelV2 } from '@designflow/shared';
import type { StructuralInput } from '../apps/api/src/structural/contracts.js';

/** Test-only engineering values, explicitly user-provided in every request; never product defaults. */
export const TEST_CONCRETE = { key: 'test-concrete', category: 'CONCRETE' as const, name: 'Fixture concrete (test values only)',
  elasticModulus: { value: 30000, unit: 'MPa' as const }, poissonRatio: { value: 0.2, unit: '1' as const }, density: { value: 2400, unit: 'kg/m3' as const }, architecturalSpecificationId: null };

/** A column at every distinct wall endpoint per storey and a beam along every wall, fixed at the lowest column bases. */
export function frameInput(model: BuildingModelV2, options: { selfWeight?: boolean; lineLoadKnPerM?: number } = {}): StructuralInput {
  const columns = new Map<string, StructuralInput['members'][number]>();
  for (const wall of [...model.walls].sort((a, b) => a.id < b.id ? -1 : 1)) for (const end of ['start', 'end'] as const) {
    const p = wall.path[end], key = `c-${wall.levelId}-${p.x}-${p.z}`;
    if (!columns.has(key)) columns.set(key, { key, rule: 'COLUMN_AT_WALL_END', wallId: wall.id, end, material: 'test-concrete', section: 'col' });
  }
  const beams = model.walls.map(w => ({ key: `b-${w.id}`, rule: 'BEAM_ALONG_WALL' as const, wallId: w.id, material: 'test-concrete', section: 'beam' }));
  const line = options.lineLoadKnPerM ?? -10;
  return { version: 'structural-input-v1', materials: [structuredClone(TEST_CONCRETE)],
    sections: [{ key: 'col', shape: 'RECTANGLE', width: { value: 300, unit: 'mm' }, depth: { value: 300, unit: 'mm' } },
      { key: 'beam', shape: 'RECTANGLE', width: { value: 230, unit: 'mm' }, depth: { value: 450, unit: 'mm' } }],
    members: [...columns.values(), ...beams], supports: [], autoSupports: { rule: 'BASE_OF_COLUMNS_AT_LOWEST_ELEVATION', type: 'FIXED' },
    loadCases: [
      { key: 'DEAD', category: 'DEAD', selfWeight: options.selfWeight ?? true, loads: beams.map(b => ({ key: `d-${b.key}`, application: 'MEMBER_DISTRIBUTED' as const, target: { member: b.key }, direction: 'GLOBAL_Y' as const, magnitude: { value: line, unit: 'kN/m' as const } })) },
      { key: 'LIVE', category: 'LIVE', selfWeight: false, loads: beams.map(b => ({ key: `l-${b.key}`, application: 'MEMBER_DISTRIBUTED' as const, target: { member: b.key }, direction: 'GLOBAL_Y' as const, magnitude: { value: line / 2, unit: 'kN/m' as const } })) },
    ],
    combinations: [{ key: 'D-plus-L', profile: 'PROJECT_DEFINED', terms: [{ loadCase: 'DEAD', factor: 1 }, { loadCase: 'LIVE', factor: 1 }] },
      { key: 'project-factored', profile: 'PROJECT_DEFINED', terms: [{ loadCase: 'DEAD', factor: 1.35 }, { loadCase: 'LIVE', factor: 1.5 }] }],
  };
}

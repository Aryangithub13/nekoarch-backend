import { describe, expect, it } from 'vitest';
import { ArchitecturalBuildingModelV2Schema } from '@designflow/shared';
import { auditBlueprint, PRODUCT_DEFAULTS_RULE_PACK } from '@designflow/blueprint-qa';
import { BlueprintError, blueprintVersionForRequirements, generateBlueprintForVersion, generateProgramBlueprint, normalizeProgramRequirements, PROGRAM_VERSION } from '../src/index.js';

const ft = (n: number) => Math.round(n * 304.8);
const rect = (w: number, d: number) => [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: d }, { x: 0, z: d }];
const qa = (model: ReturnType<typeof generateProgramBlueprint>['model']) => auditBlueprint(model, { requireReachability: true, rulePacks: [PRODUCT_DEFAULTS_RULE_PACK],
  entryOpeningIds: model.openings.filter(o => o.kind === 'door' && model.walls.find(w => w.id === o.wallId)?.classification === 'exterior').map(o => o.id).sort() });

const cases = {
  villa: { program: { buildingType: 'villa', qualityTier: 'premium', spaces: [{ kind: 'master', count: 1, ensuite: true }, { kind: 'bedroom', count: 3, ensuite: true }, { kind: 'office', count: 1 }, { kind: 'puja', count: 1 }, { kind: 'living', count: 1 }, { kind: 'kitchen', count: 1 }, { kind: 'dining', count: 1 }, { kind: 'garage', count: 1 }, { kind: 'toilet', count: 1 }] },
    site: { boundary: rect(ft(40), ft(60)), setbacks: [{ boundaryEdgeStart: 0, minimumMm: 3000 }, { boundaryEdgeStart: 1, minimumMm: 1000 }, { boundaryEdgeStart: 2, minimumMm: 1500 }, { boundaryEdgeStart: 3, minimumMm: 1000 }] }, floors: 3 },
  bhk2: { program: { buildingType: 'house', spaces: [{ kind: 'bedroom', count: 2 }, { kind: 'bathroom', count: 1 }, { kind: 'living', count: 1 }, { kind: 'kitchen', count: 1 }] }, site: { boundary: rect(ft(30), ft(40)), setbacks: [{ boundaryEdgeStart: 0, minimumMm: 2000 }] }, floors: 1 },
  cafe: { program: { buildingType: 'cafe', spaces: [{ kind: 'seating', count: 1, areaM2: 60 }, { kind: 'commercialKitchen', count: 1 }, { kind: 'counter', count: 1 }, { kind: 'restroomMen', count: 1 }, { kind: 'restroomWomen', count: 1 }, { kind: 'store', count: 1 }] }, site: { boundary: rect(15000, 20000) }, floors: 1 },
  office: { program: { buildingType: 'office', spaces: [{ kind: 'reception', count: 1 }, { kind: 'workspace', count: 3 }, { kind: 'cabin', count: 4 }, { kind: 'conference', count: 2 }, { kind: 'restroomMen', count: 2 }, { kind: 'restroomWomen', count: 2 }, { kind: 'pantry', count: 1 }] }, site: { boundary: rect(20000, 30000), setbacks: [{ boundaryEdgeStart: 0, minimumMm: 4500 }] }, floors: 4 },
} as const;

describe('program engine (program-architecture-v1)', () => {
  it('is selected by a program object and dispatched through the version registry', () => {
    expect(blueprintVersionForRequirements(cases.bhk2)).toBe(PROGRAM_VERSION);
    expect(generateBlueprintForVersion(cases.bhk2, PROGRAM_VERSION).model.provenance.generatorVersion).toBe(PROGRAM_VERSION);
  });
  for (const [name, input] of Object.entries(cases)) it(`generates a valid model that passes independent QA: ${name}`, () => {
    const result = generateProgramBlueprint(input);
    expect(ArchitecturalBuildingModelV2Schema.safeParse(result.model).success).toBe(true);
    expect(result.model.levels).toHaveLength(input.floors);
    expect(result.model.stairs).toHaveLength(input.floors - 1);
    expect(result.metadata.circulation.unreachableSpaceIds).toEqual([]);
    const report = qa(result.model);
    expect(report.status).not.toBe('FAIL');
    expect(report.summary.errors).toBe(0);
    // Every requested room exists (en-suites add their bathrooms).
    const requested = input.program.spaces.reduce((n, s) => n + s.count, 0);
    expect(result.program.rooms.filter(r => r.targetAreaM2 !== null)).toHaveLength(requested);
  });
  it('honours explicit storeys, en-suites and zoning (living on the ground, bedrooms above)', () => {
    const { model } = generateProgramBlueprint(cases.villa);
    const level = (name: string) => model.spaces.find(s => s.name === name)?.levelId;
    expect(level('Living room')).toBe('level-0');
    expect(level('Garage')).toBe('level-0');
    expect(model.spaces.filter(s => s.name.endsWith(' bath'))).toHaveLength(4);
    expect(model.spaces.filter(s => s.use === 'Master bedroom' || s.use === 'Bedroom').every(s => s.levelId !== 'level-0')).toBe(true);
    expect(model.openings.some(o => o.type === 'garage-door')).toBe(true);
  });
  it('is deterministic and order-independent', () => {
    const a = generateProgramBlueprint(cases.office), b = generateProgramBlueprint({ ...cases.office, program: { ...cases.office.program, spaces: [...cases.office.program.spaces].reverse() } });
    expect(JSON.stringify(b.model)).toBe(JSON.stringify(a.model));
  });
  it('rejects non-rectangular plots and explains programs that cannot fit', () => {
    expect(() => normalizeProgramRequirements({ ...cases.bhk2, site: { boundary: [{ x: 0, z: 0 }, { x: 9000, z: 0 }, { x: 4000, z: 9000 }] } })).toThrow(BlueprintError);
    try { generateProgramBlueprint({ ...cases.bhk2, program: { buildingType: 'house', spaces: [{ kind: 'bedroom', count: 20 }, { kind: 'hall', count: 3 }] } }); expect.unreachable(); }
    catch (error) { expect((error as BlueprintError).code).toBe('PROGRAM_DOES_NOT_FIT'); }
  });
});

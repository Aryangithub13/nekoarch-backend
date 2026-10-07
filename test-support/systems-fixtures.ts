import type { BuildingModelV2 } from '@designflow/shared';
import { generateParametricBlueprint, type ParametricRequirements } from '@designflow/generator';
import type { SystemsInput } from '../apps/api/src/systems/contracts.js';
import type { StructuralInput } from '../apps/api/src/structural/contracts.js';
import { TEST_CONCRETE } from './structural-fixtures.js';
import { parametricInput } from './parametric-fixtures.js';

/** Two storeys, a bathroom on each level and a kitchen: the Phase 26 residential acceptance building (generated, never hand-edited). */
export function wetRequirements(): ParametricRequirements {
  const p = parametricInput(true);
  p.rooms = [{ type: 'bedroom', count: 1, level: 1 }, { type: 'bathroom', count: 1, level: 1 }, { type: 'living', count: 1, level: 0 }, { type: 'kitchen', count: 1, level: 0 },
    { type: 'bathroom', count: 1, level: 0 }];
  return p;
}
export const wetTwoStorey = (): BuildingModelV2 => generateParametricBlueprint(wetRequirements()).model;

const user = 'USER_PROVIDED' as const;
const at = (spaceId: string, x: number, z: number, elevationMm: number) => ({ spaceId, point: { x, z }, elevationMm });
/** Test-only engineering values, explicit in every request; never product defaults. Elevations are relative to each terminal's level. */
export function systemsInput(options: { outletElevationMm?: number; demandFactors?: boolean; supply?: boolean; structuralAnalysisId?: string | null;
  environmentalAnalysisId?: string | null; elevator?: 'PLANNER_SELECTED' | { x: number; z: number } | null; loadWatts?: number[]; ductWidthMm?: number } = {}): SystemsInput {
  const conn = (service: 'COLD_WATER' | 'HOT_WATER' | 'SANITARY', x: number, z: number, elevationMm: number) => ({ service, point: { x, z }, elevationMm });
  const [living = 1000, kitchen = 500, bedroom = 250] = options.loadWatts ?? [];
  const factor = (value: number) => options.demandFactors ? { value, provenance: user } : null;
  const supplied = options.supply !== false;
  return {
    version: 'building-systems-input-v1',
    sources: { structuralAnalysisId: options.structuralAnalysisId ?? null, environmentalAnalysisId: options.environmentalAnalysisId ?? null },
    plumbing: {
      fixtures: [
        { key: 'g-wc', kind: 'WC', spaceId: 'space-bathroom-1', connections: [conn('SANITARY', 4200, 4000, 0), conn('COLD_WATER', 4500, 4000, 200)], provenance: user },
        { key: 'g-basin', kind: 'WASH_BASIN', spaceId: 'space-bathroom-1', connections: [conn('SANITARY', 6000, 3000, 400), conn('COLD_WATER', 6200, 3000, 800), conn('HOT_WATER', 6400, 3000, 800)], provenance: user },
        { key: 'k-sink', kind: 'SINK', spaceId: 'space-kitchen-1', connections: [conn('SANITARY', 16000, 8200, 600), conn('COLD_WATER', 16200, 8200, 900), conn('HOT_WATER', 16400, 8200, 900)], provenance: user },
        { key: 'u-wc', kind: 'WC', spaceId: 'space-bathroom-2', connections: [conn('SANITARY', 10200, 7000, 0), conn('COLD_WATER', 10500, 7000, 200)], provenance: user },
        { key: 'u-basin', kind: 'WASH_BASIN', spaceId: 'space-bathroom-2', connections: [conn('SANITARY', 12000, 7200, 400), conn('COLD_WATER', 12200, 7200, 800), conn('HOT_WATER', 12400, 7200, 800)], provenance: user },
        { key: 'u-shower', kind: 'SHOWER', spaceId: 'space-bathroom-2', connections: [conn('SANITARY', 15500, 7000, 0), conn('COLD_WATER', 15700, 7000, 1000), conn('HOT_WATER', 15900, 7000, 1000)], provenance: user },
      ],
      coldWaterSource: { key: 'cold-main', ...at('space-corridor-0', 5000, 1800, 300), provenance: user },
      hotWaterSource: { key: 'water-heater', ...at('space-kitchen-1', 18000, 3500, 1500), provenance: user },
      sanitaryOutlet: { key: 'sewer', ...at('space-corridor-0', 9000, 1500, options.outletElevationMm ?? -800), provenance: user },
      minimumSlope: { rise: 1, run: 40, provenance: user },
      coldWater: { elevations: [{ levelId: 'level-0', elevationMm: 2200 }, { levelId: 'level-1', elevationMm: -700 }], size: { shape: 'ROUND', diameterMm: 20 }, routing: { mode: 'PLANNED' } },
      hotWater: { elevations: [{ levelId: 'level-0', elevationMm: 2050 }, { levelId: 'level-1', elevationMm: -850 }], size: { shape: 'ROUND', diameterMm: 20 }, routing: { mode: 'PLANNED' } },
      sanitary: { bands: [{ levelId: 'level-0', topMm: -300, bottomMm: -900 }, { levelId: 'level-1', topMm: -250, bottomMm: -500 }], size: { shape: 'ROUND', diameterMm: 100 } },
      clearance: { value: 25, unit: 'mm', provenance: user },
    },
    electrical: {
      supply: { key: 'mains', systemVoltage: supplied ? { value: 230, unit: 'V' } : null, phaseSystem: supplied ? 'SINGLE_PHASE' : null, frequencyHz: supplied ? { value: 50, unit: 'Hz' } : null,
        ...at('space-corridor-0', 2000, 1500, 1500), provenance: user },
      panels: [{ key: 'db-1', ...at('space-corridor-0', 3000, 1700, 1500), footprint: { minX: 2800, minZ: 1600, maxX: 3200, maxZ: 1800 }, provenance: user }],
      circuits: [{ key: 'c1', panel: 'db-1', loads: ['light-living', 'socket-kitchen'] }, { key: 'c2', panel: 'db-1', loads: ['light-bedroom'] }],
      loads: [
        { key: 'light-living', kind: 'LIGHTING', ...at('space-living-1', 12000, 5000, 2700), power: { value: living, unit: 'W' }, phase: null, demandFactor: factor(0.9), provenance: user },
        { key: 'socket-kitchen', kind: 'SOCKET', ...at('space-kitchen-1', 16000, 4000, 300), power: { value: kitchen, unit: 'W' }, phase: null, demandFactor: factor(0.5), provenance: user },
        { key: 'light-bedroom', kind: 'LIGHTING', ...at('space-bedroom-1', 6000, 9000, 2700), power: { value: bedroom, unit: 'W' }, phase: null, demandFactor: factor(1), provenance: user },
      ],
      feeder: { elevations: [{ levelId: 'level-0', elevationMm: 2500 }], size: { shape: 'ROUND', diameterMm: 32 }, routing: { mode: 'PLANNED' } },
      circuitRouting: { elevations: [{ levelId: 'level-0', elevationMm: 2500 }, { levelId: 'level-1', elevationMm: 2500 }], size: { shape: 'ROUND', diameterMm: 25 }, routing: { mode: 'PLANNED' } },
      clearance: { value: 25, unit: 'mm', provenance: user },
    },
    hvac: {
      equipment: [{ key: 'ahu-1', kind: 'AIR_HANDLING_UNIT', ...at('space-corridor-1', 5200, 1750, 2300), footprint: null, provenance: user }],
      systems: [
        { key: 'sa', kind: 'SUPPLY', equipment: 'ahu-1', connection: { point: { x: 5000, z: 1750 }, elevationMm: 2300 },
          terminals: [{ key: 'sa-bed', ...at('space-bedroom-1', 6000, 12000, 2700), airflow: { value: 150, unit: 'L/s', provenance: user } },
            { key: 'sa-bath', ...at('space-bathroom-2', 13000, 5000, 2700), airflow: { value: 100, unit: 'L/s', provenance: user } }],
          ductSection: { shape: 'RECTANGULAR', widthMm: options.ductWidthMm ?? 300, heightMm: 200 }, elevations: [{ levelId: 'level-1', elevationMm: 2400 }], routing: { mode: 'PLANNED' } },
        { key: 'ra', kind: 'RETURN', equipment: 'ahu-1', connection: { point: { x: 5600, z: 1750 }, elevationMm: 2300 },
          terminals: [{ key: 'ra-corridor', ...at('space-corridor-1', 8000, 1800, 2700), airflow: { value: 250, unit: 'L/s', provenance: user } }],
          ductSection: { shape: 'RECTANGULAR', widthMm: 300, heightMm: 200 }, elevations: [{ levelId: 'level-1', elevationMm: 2100 }], routing: { mode: 'PLANNED' } },
      ],
      clearance: { value: 50, unit: 'mm', provenance: user },
    },
    lifeSafety: { exits: { mode: 'SITE_PRIMARY_ENTRY' }, obstructedOpeningIds: [] },
    verticalTransport: options.elevator === null ? null : { elevators: [{ key: 'lift-1', servedLevelIds: ['level-0', 'level-1'], shaft: { widthMm: 1600, depthMm: 1600 },
      door: { side: '+z', widthMm: 900 }, placement: !options.elevator || options.elevator === 'PLANNER_SELECTED' ? { mode: 'PLANNER_SELECTED' } : { mode: 'FIXED', origin: options.elevator },
      cabin: null, pitDepthMm: null, overheadMm: null, ratedLoad: null, ratedSpeed: null, provenance: user }] },
  };
}

/** Phase 24 input for the wet building (test values): one beam along the bathroom/corridor wall at the storey top, columns at its two ends. */
export function wetFrameInput(): StructuralInput {
  return { version: 'structural-input-v1', materials: [structuredClone(TEST_CONCRETE)],
    sections: [{ key: 'col', shape: 'RECTANGLE', width: { value: 300, unit: 'mm' }, depth: { value: 300, unit: 'mm' } }, { key: 'beam', shape: 'RECTANGLE', width: { value: 300, unit: 'mm' }, depth: { value: 600, unit: 'mm' } }],
    members: [{ key: 'b1', rule: 'BEAM_ALONG_WALL', wallId: 'wall-level-0-3550-2450-9900-2450', material: 'test-concrete', section: 'beam' },
      { key: 'c1', rule: 'COLUMN_AT_WALL_END', wallId: 'wall-level-0-3550-2450-9900-2450', end: 'start', material: 'test-concrete', section: 'col' },
      { key: 'c2', rule: 'COLUMN_AT_WALL_END', wallId: 'wall-level-0-3550-2450-9900-2450', end: 'end', material: 'test-concrete', section: 'col' }],
    supports: [], autoSupports: { rule: 'BASE_OF_COLUMNS_AT_LOWEST_ELEVATION', type: 'FIXED' }, combinations: [], loadCases: [{ key: 'd', category: 'DEAD', selfWeight: true, loads: [] }] };
}

import type { NormalizedParametricRequirements } from '@designflow/generator';
import type { BlueprintQaOptions } from '@designflow/blueprint-qa';
export function parametricQaOptions(r: NormalizedParametricRequirements): BlueprintQaOptions {
  const counts: Record<string, number> = {};
  return { parametric: { architecture: r.parametricArchitecture, circulationWidthMm: r.circulationWidthMm, exteriorWallThicknessMm: r.exteriorWallThicknessMm, interiorWallThicknessMm: r.interiorWallThicknessMm, doorJambMm: r.door.jambMm },
    requiredClearSpaces: r.rooms.flatMap(room => Array.from({ length: room.count }, () => {
      counts[room.type] = (counts[room.type] ?? 0) + 1;
      return { id: `space-${room.type}-${counts[room.type]}`, ...(room.level !== undefined ? { levelId: `level-${room.level}` } : {}), minimumWidthMm: room.minWidthMm, minimumDepthMm: room.minDepthMm, ...(room.minAreaMm2 !== undefined ? { minimumAreaMm2: room.minAreaMm2 } : {}) };
    })),
    requiredRelationships: r.relationships.filter(e => e.strength === 'hard').map(e => ({ from: `space-${e.from.type}-${e.from.ordinal}`, to: `space-${e.to.type}-${e.to.ordinal}`, kind: e.kind })),
  };
}

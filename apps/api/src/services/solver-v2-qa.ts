import type { NormalizedBlueprintV2Requirements } from '@designflow/generator';
import type { BlueprintQaOptions } from '@designflow/blueprint-qa';

/** Caller requirements are independently checked against actual model geometry. */
export function solverV2QaOptions(r: NormalizedBlueprintV2Requirements): BlueprintQaOptions {
  const counts = new Map<string, number>();
  const spaces = r.rooms.flatMap(room => Array.from({ length: room.count }, () => {
    const ordinal = (counts.get(room.type) ?? 0) + 1;
    counts.set(room.type, ordinal);
    return { id: `space-${room.type}-${ordinal}`, classification: room.type, ...(room.level === undefined ? {} : { levelId: `level-${room.level}` }), minimumWidthMm: room.minWidthMm, minimumDepthMm: room.minDepthMm, ...(room.minAreaMm2 === undefined ? {} : { minimumAreaMm2: room.minAreaMm2 }) };
  }));
  return {
    requiredClearSpaces: spaces.map(({ classification: _classification, ...requirement }) => requirement),
    forbiddenTransitSpaceIds: r.layoutV2.forbidPrivateThroughAccess ? spaces.filter(s => ['bedroom', 'study'].includes(s.classification)).map(s => s.id) : [],
    requiredRelationships: r.relationships.filter(e => e.strength === 'hard').map(e => ({ from: `space-${e.from.type}-${e.from.ordinal}`, to: `space-${e.to.type}-${e.to.ordinal}`, kind: e.kind })),
    requiredSeparations: r.layoutV2.separations.filter(e => e.strength === 'hard').map(e => ({ from: `space-${e.from.type}-${e.from.ordinal}`, to: `space-${e.to.type}-${e.to.ordinal}`, minimumClearDistanceMm: e.minimumClearDistanceMm })),
  };
}

import { SpaceFinishesSchema, type BuildingModelV2, type SpaceFinishes } from '@designflow/shared';
import { ELEMENT_COLLECTIONS, PLAN_STATUSES, type Change, type ChangeDisposition, type ChangeSet, type ElementType, type IntegrationReason, type PlanStatus }
  from '../contracts/integration.js';
import type { IntegrationPlan } from '../contracts/integration.js';

type PlannedChange = IntegrationPlan['changes'][number];
type Kind = 'FINISH' | 'GEOMETRY';
/**
 * Hard model locks (ROADMAP A2) each kind of change would break, in the Phase 30 preservation vocabulary. A finish edits space data only (the
 * 0029 finish-only lock holds everything else); any other change alters geometry or topology. A LEVEL lock on the element's storey always applies.
 */
const LOCKED_BY: Record<Kind, Record<ElementType, readonly string[]>> = {
  FINISH: { space: ['INTERIOR'], level: [], wall: [], opening: [], stair: [], slab: [], column: [] },
  GEOMETRY: { space: ['ROOMS', 'WALLS', 'FLOOR_PLANS', 'BUILDING_GEOMETRY'], wall: ['WALLS', 'ROOMS', 'FLOOR_PLANS', 'BUILDING_GEOMETRY'],
    opening: ['OPENINGS', 'WALLS', 'FLOOR_PLANS', 'BUILDING_GEOMETRY'], stair: ['STAIRS', 'FLOOR_PLANS', 'BUILDING_GEOMETRY'], slab: ['STRUCTURE', 'BUILDING_GEOMETRY'],
    column: ['STRUCTURE', 'BUILDING_GEOMETRY'], level: ['BUILDING_GEOMETRY', 'BUILDING_DIMENSIONS', 'FLOOR_PLANS', 'STRUCTURE'] },
};
/**
 * What a storey addition would require before any output could be presented as current. Dependency categories only: no value is computed and no
 * check is claimed to pass (ROADMAP A4; B40 brief §B40-C).
 */
export const STOREY_ADDITION_CHECKS = Object.freeze(['Floor plan of the new storey (generator: requirements regeneration)', 'Vertical circulation: stair continuity to the new storey',
  'Structural review by a qualified engineer (no validated design solver exists)', 'Building height and storey-count limits', 'Elevations and sections',
  'Egress and fire separation (Phase 26 services refuse more than 2 storeys)', 'Quantities and cost of every storey', 'Scene and BIM of the whole building']);

export interface ChangePlan { changes: PlannedChange[]; assignments: { spaceId: string; finishes: SpaceFinishes }[] }

const levelOf = (e: Record<string, unknown> | undefined) => typeof e?.['levelId'] === 'string' ? e['levelId'] : null;
const describe = (c: Change) => `${c.operation} ${c.elementType}${c.elementId ? ` ${c.elementId.slice(0, 80)}` : ''}`;

/**
 * Pure and deterministic: validates each change against the base model's stable element ids, the hard locks and the supported operations, and returns
 * one typed disposition per change. Only a finish change on an existing space is executable (the Phase 30 INTERIOR_FINISH_MODIFY path); every other
 * change is refused by type, never approximated. `maxFloors` is the generators' storey limit (GENERATION_MAX_FLOORS).
 */
export function planChanges(model: BuildingModelV2, changeSet: ChangeSet, maxFloors: number): ChangePlan {
  const seen = new Set<string>(), assignments: ChangePlan['assignments'] = [];
  const global = new Set<string>(changeSet.preserve.filter(p => p.levelId === null).map(p => p.scope));
  const lockedLevels = new Set(changeSet.preserve.filter(p => p.scope === 'LEVEL' && p.levelId !== null).map(p => p.levelId!));
  const changes = changeSet.changes.map((c, index): PlannedChange => {
    const reasons: IntegrationReason[] = [];
    let levelId: string | null = null, limit: PlannedChange['limit'] = null, requiredChecks: string[] = [];
    const result = (disposition: ChangeDisposition, code: string, message: string): PlannedChange => {
      reasons.push({ code, message: message.slice(0, 500) });
      return { index, operation: c.operation, elementType: c.elementType, elementId: c.elementId, levelId, disposition,
        module: disposition === 'SUPPORTED' ? 'INTERIOR' : null, reasons, limit, requiredChecks };
    };
    const list = model[ELEMENT_COLLECTIONS[c.elementType]] as unknown as Record<string, unknown>[];
    const element = c.elementId === null ? undefined : list.find(e => e['id'] === c.elementId);

    // Identity first: a change must name exactly one existing element (or a new id for an addition), and each element at most once.
    if (c.operation === 'add') {
      if (element) return result('INVALID', 'ELEMENT_ID_EXISTS', `${describe(c)}: the id already exists in the base revision`);
    } else {
      if (c.elementId === null) return result('INVALID', 'ELEMENT_ID_REQUIRED', `${c.operation} ${c.elementType} names no element`);
      const key = `${c.elementType}:${c.elementId}`;
      if (seen.has(key)) return result('INVALID', 'DUPLICATE_TARGET', `${describe(c)} is named by more than one change`);
      seen.add(key);
      if (!element) return result('NEEDS_CLARIFICATION', 'ELEMENT_NOT_FOUND', `${describe(c)}: no such element in the base revision`);
    }
    levelId = c.elementType === 'level' ? c.elementId : levelOf(element);
    const keys = Object.keys(c.properties);
    const kind: Kind = c.operation === 'modify' && c.elementType === 'space' && keys.length > 0 && keys.every(k => k === 'finishes') ? 'FINISH' : 'GEOMETRY';

    // Hard locks before support: a conflict is reported as a conflict even when the change could not run anyway.
    const conflicts = LOCKED_BY[kind][c.elementType].filter(s => global.has(s));
    if (levelId !== null && lockedLevels.has(levelId) && c.operation !== 'add') conflicts.push(`LEVEL:${levelId}`);
    if (conflicts.length) return result('BLOCKED_BY_LOCK', 'LOCK_CONFLICT', `${describe(c)} conflicts with the requested preservation of ${conflicts.join(', ')}`);

    if (kind === 'FINISH') {
      const finishes = SpaceFinishesSchema.safeParse(c.properties['finishes']);
      if (!finishes.success) return result('INVALID', 'PROPERTY_INVALID', `${describe(c)}: finishes must name catalog finishes for floor, walls or ceiling`);
      assignments.push({ spaceId: c.elementId!, finishes: finishes.data });
      return result('SUPPORTED', 'SPACE_FINISH_MODIFY', `${describe(c)}: finish data only, through the Phase 30 INTERIOR_FINISH_MODIFY operation`);
    }
    if (c.operation === 'modify' && keys.length === 0) return result('INVALID', 'NO_PROPERTIES', `${describe(c)} changes nothing`);
    if (c.operation === 'add' && c.elementType === 'level') {
      const storeys = model.levels.filter(l => l.kind === 'storey').length;
      limit = { limitId: 'GENERATION_MAX_FLOORS', value: maxFloors, requested: storeys + 1 };
      requiredChecks = [...STOREY_ADDITION_CHECKS];
      if (storeys + 1 > maxFloors) return result('UNSUPPORTED', 'GEOMETRY_LIMIT_EXCEEDED', `Adding a storey makes ${storeys + 1} storeys; the supported geometry scope is at most `
        + `${maxFloors} (GENERATION_MAX_FLOORS). No geometry, calculation or validation result is produced; the base revision is unchanged`);
      return result('UNSUPPORTED', 'SELECTIVE_STOREY_ADDITION_NOT_SUPPORTED', `No engine adds a storey to an existing model selectively. Within ${maxFloors} storeys, `
        + 'regenerate the requirements through the BLUEPRINT specialist (a new full revision); the listed checks then apply');
    }
    const code = c.operation === 'add' ? 'ELEMENT_ADDITION_NOT_SUPPORTED' : c.operation === 'remove' ? 'ELEMENT_REMOVAL_NOT_SUPPORTED'
      : c.operation === 'replace' ? 'ELEMENT_REPLACEMENT_NOT_SUPPORTED' : 'ELEMENT_GEOMETRY_NOT_SUPPORTED';
    return result('UNSUPPORTED', code, `${describe(c)} (${keys.join(', ') || 'no properties'}): no engine regenerates this element selectively; only space finishes `
      + 'change in place. Regenerate the requirements through the BLUEPRINT specialist (a new full revision) instead');
  });
  return { changes, assignments };
}

/** The most restrictive status that applies (PLAN_STATUSES order); READY_FOR_APPROVAL when none does. */
export function planStatus(statuses: readonly PlanStatus[]): PlanStatus {
  return PLAN_STATUSES.find(s => statuses.includes(s)) ?? 'READY_FOR_APPROVAL';
}
export const dispositionStatus = (d: ChangeDisposition): PlanStatus => d === 'SUPPORTED' ? 'READY_FOR_APPROVAL' : d;

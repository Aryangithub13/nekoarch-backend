import type { BuildingModelV2 } from '@designflow/shared';
import { costHash } from '@designflow/boq-cost';

/** Phase 38: schedules derived only from stored revision fields; nothing is defaulted or estimated. */
export const SCHEDULES_VERSION = 'construction-schedules-v1';
export const SCHEDULE_IDS = ['levels', 'rooms', 'doors', 'windows', 'openings'] as const;
export type ScheduleId = typeof SCHEDULE_IDS[number];
export type Cell = string | number | null;
export type Column = { key: string; label: string; kind: 'text' | 'number'; unit: 'mm' | 'm2' | null };
export type Schedule = { scheduleId: ScheduleId; title: string; columns: Column[]; rows: Record<string, Cell>[]; rowCount: number; scheduleHash: string };

const text = (key: string, label: string): Column => ({ key, label, kind: 'text', unit: null });
const num = (key: string, label: string, unit: Column['unit'] = null): Column => ({ key, label, kind: 'number', unit });
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Exact polygon area: |shoelace| as an integer twice-area in mm², formatted as an exact decimal of m² (1 m² = 1,000,000 mm²). */
export function ringTwiceAreaMm2(ring: readonly { x: number; z: number }[]): bigint {
  let sum = 0n;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!, q = ring[(i + 1) % ring.length]!;
    sum += BigInt(p.x) * BigInt(q.z) - BigInt(q.x) * BigInt(p.z);
  }
  return sum < 0n ? -sum : sum;
}
export function exactAreaM2(twiceAreaMm2: bigint): string {
  // area m² = twice / 2,000,000 = twice × 5 / 10^7: at most seven decimal digits, all exact.
  const scaled = twiceAreaMm2 * 5n, whole = scaled / 10_000_000n, fraction = (scaled % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function buildSchedules(model: BuildingModelV2): Schedule[] {
  const levels = [...model.levels].sort((a, b) => a.index - b.index || byId(a, b));
  const level = new Map(levels.map(l => [l.id, l])), order = new Map(levels.map((l, i) => [l.id, i]));
  const onLevel = <T extends { id: string; levelId: string }>(items: readonly T[]) =>
    [...items].sort((a, b) => (order.get(a.levelId) ?? Infinity) - (order.get(b.levelId) ?? Infinity) || byId(a, b));
  const levelName = (id: string) => level.get(id)?.name ?? null;
  const hosted = [num('widthMm', 'Width', 'mm'), num('heightMm', 'Height', 'mm'), num('sillMm', 'Sill', 'mm')];
  const openings = (kind: 'door' | 'window' | 'opening') => onLevel(model.openings.filter(o => o.kind === kind));
  const make = (scheduleId: ScheduleId, title: string, columns: Column[], rows: Record<string, Cell>[]): Schedule =>
    ({ scheduleId, title, columns, rows, rowCount: rows.length, scheduleHash: costHash({ version: SCHEDULES_VERSION, scheduleId, columns, rows }) });
  return [
    make('levels', 'Level schedule', [text('levelId', 'Level ID'), text('name', 'Name'), num('index', 'Index'), text('kind', 'Kind'), num('elevationMm', 'Elevation', 'mm'),
      num('floorToFloorHeightMm', 'Floor-to-floor height', 'mm')],
      levels.map(l => ({ levelId: l.id, name: l.name, index: l.index, kind: l.kind, elevationMm: l.elevationMm, floorToFloorHeightMm: l.floorToFloorHeightMm }))),
    // Area is reported only where the boundary has a stated basis; an unspecified basis is a missing value, not an estimate.
    make('rooms', 'Room schedule', [text('spaceId', 'Space ID'), text('name', 'Name'), text('classification', 'Classification'), text('use', 'Use'),
      text('levelId', 'Level ID'), text('levelName', 'Level'), text('boundaryBasis', 'Boundary basis'), num('areaM2', 'Area', 'm2'), num('occupancy', 'Occupancy')],
      onLevel(model.spaces).map(s => ({ spaceId: s.id, name: s.name, classification: s.classification, use: s.use ?? null, levelId: s.levelId, levelName: levelName(s.levelId),
        boundaryBasis: s.boundaryBasis, areaM2: s.boundaryBasis === 'wall-centerline' ? exactAreaM2(ringTwiceAreaMm2(s.boundary)) : null, occupancy: s.occupancy ?? null }))),
    make('doors', 'Door schedule', [text('openingId', 'Door ID'), text('levelId', 'Level ID'), text('levelName', 'Level'), text('wallId', 'Host wall'), text('type', 'Type'),
      ...hosted, text('operation', 'Operation'), text('hinge', 'Hinge'), text('swingSide', 'Swing side')],
      openings('door').map(o => {
        const op = o.kind === 'door' ? o.operation : { kind: 'unspecified' as const };
        return { openingId: o.id, levelId: o.levelId, levelName: levelName(o.levelId), wallId: o.wallId, type: o.type, widthMm: o.widthMm, heightMm: o.heightMm, sillMm: o.sillMm,
          operation: op.kind, hinge: op.kind === 'hinged' ? op.hinge : null, swingSide: op.kind === 'hinged' ? op.swingSide : null };
      })),
    make('windows', 'Window schedule', [text('openingId', 'Window ID'), text('levelId', 'Level ID'), text('levelName', 'Level'), text('wallId', 'Host wall'), text('type', 'Type'), ...hosted],
      openings('window').map(o => ({ openingId: o.id, levelId: o.levelId, levelName: levelName(o.levelId), wallId: o.wallId, type: o.type, widthMm: o.widthMm, heightMm: o.heightMm, sillMm: o.sillMm }))),
    make('openings', 'Opening schedule', [text('openingId', 'Opening ID'), text('levelId', 'Level ID'), text('levelName', 'Level'), text('wallId', 'Host wall'), text('purpose', 'Purpose'),
      text('type', 'Type'), ...hosted],
      openings('opening').map(o => ({ openingId: o.id, levelId: o.levelId, levelName: levelName(o.levelId), wallId: o.wallId, purpose: o.kind === 'opening' ? o.purpose : null,
        type: o.type, widthMm: o.widthMm, heightMm: o.heightMm, sillMm: o.sillMm }))),
  ];
}

/** RFC 4180 (CRLF, quoted fields). Text cells that a spreadsheet would evaluate (= + - @ tab CR) are prefixed with an apostrophe. */
export function scheduleCsv(schedule: Schedule): string {
  const cell = (value: Cell, column: Column) => {
    if (value === null) return '';
    let s = String(value);
    if (column.kind === 'text' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = schedule.columns.map(c => cell(c.unit ? `${c.label} (${c.unit === 'm2' ? 'm²' : c.unit})` : c.label, { ...c, kind: 'text' }));
  return [header.join(','), ...schedule.rows.map(r => schedule.columns.map(c => cell(r[c.key] ?? null, c)).join(','))].join('\r\n') + '\r\n';
}

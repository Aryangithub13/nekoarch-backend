import { describe, expect, it } from 'vitest';
import type { BuildingModelV2 } from '@designflow/shared';
import { authored } from '../../../packages/blueprint-qa/tests/fixtures.js';
import { buildSchedules, exactAreaM2, ringTwiceAreaMm2, scheduleCsv } from '../src/documents/schedules.js';
import { buildPlanSheet, DocumentError, PLAN_SHEET_LIMITS, xmlEscape } from '../src/documents/plan-sheet.js';

const binding = { projectId: '00000000-0000-4000-8000-000000000001', revisionId: '00000000-0000-4000-8000-000000000002', revisionNumber: 3,
  modelHash: 'a'.repeat(64), acceptanceQaId: '00000000-0000-4000-8000-000000000003', qaStatus: 'PASS' };
const model = () => structuredClone(authored()) as BuildingModelV2;
const level = (m: BuildingModelV2) => m.levels.find(l => l.kind === 'storey')!.id;
/** Minimal well-formedness check: every element closes in order, no raw '<' or '&' outside markup, one root. */
function wellFormed(xml: string) {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, ''), stack: string[] = [];
  let roots = 0;
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|<|&(?!(amp|lt|gt|quot|apos);)/g)) {
    if (!m[2]) return false;
    if (m[1]) { if (stack.pop() !== m[2]) return false; }
    else { if (stack.length === 0) roots++; if (!m[4]) stack.push(m[2]); }
  }
  return stack.length === 0 && roots === 1;
}

describe('Phase 38 schedules', () => {
  it('computes exact areas: twice-area in mm², formatted without rounding', () => {
    expect([exactAreaM2(2n), exactAreaM2(1n), exactAreaM2(24_000_000n), exactAreaM2(3n)]).toEqual(['0.000001', '0.0000005', '12', '0.0000015']);
    expect(ringTwiceAreaMm2([{ x: 0, z: 0 }, { x: 3000, z: 0 }, { x: 3000, z: 4000 }, { x: 0, z: 4000 }])).toBe(24_000_000n);
    // Orientation does not change the area; coordinates at the schema maximum do not overflow.
    expect(ringTwiceAreaMm2([{ x: 0, z: 0 }, { x: 0, z: 4000 }, { x: 3000, z: 4000 }, { x: 3000, z: 0 }])).toBe(24_000_000n);
    expect(ringTwiceAreaMm2([{ x: -100_000_000, z: -100_000_000 }, { x: 100_000_000, z: -100_000_000 }, { x: 100_000_000, z: 100_000_000 }])).toBe(40_000_000_000_000_000n);
  });

  it('reports only stored values, sorted by level then id, with source ids; unknown values stay null', () => {
    const m = model(), s = Object.fromEntries(buildSchedules(m).map(x => [x.scheduleId, x]));
    expect(Object.keys(s)).toEqual(['levels', 'rooms', 'doors', 'windows', 'openings']);
    expect(s.rooms!.rows.map(r => r.spaceId)).toEqual(m.spaces.map(x => x.id).sort());
    for (const row of s.rooms!.rows) {
      const space = m.spaces.find(x => x.id === row.spaceId)!;
      expect(row.areaM2).toBe(exactAreaM2(ringTwiceAreaMm2(space.boundary)));
      expect(row.use).toBe(space.use ?? null);
    }
    const doors = m.openings.filter(o => o.kind === 'door');
    expect(s.doors!.rows).toHaveLength(doors.length);
    for (const row of s.doors!.rows) {
      const d = doors.find(x => x.id === row.openingId)!;
      expect([row.widthMm, row.heightMm, row.sillMm, row.wallId, row.type]).toEqual([d.widthMm, d.heightMm, d.sillMm, d.wallId, d.type]);
    }
    expect(s.windows!.rowCount).toBe(m.openings.filter(o => o.kind === 'window').length);
    // An unspecified boundary basis gives no area: a missing value, not an estimate.
    m.spaces[0]!.boundaryBasis = 'unspecified';
    expect(buildSchedules(m).find(x => x.scheduleId === 'rooms')!.rows.find(r => r.spaceId === m.spaces[0]!.id)!.areaM2).toBeNull();
  });

  it('is deterministic whatever the order of the stored arrays', () => {
    const a = model(), b = model();
    b.spaces.reverse(); b.openings.reverse(); b.levels.reverse();
    expect(JSON.stringify(buildSchedules(b))).toBe(JSON.stringify(buildSchedules(a)));
  });

  it('writes RFC 4180 CSV and neutralises spreadsheet formulas in text cells only', () => {
    const m = model();
    m.spaces[0]!.name = '=HYPERLINK("http://x","y")'; m.spaces[1]!.name = 'Room, "north"';
    m.levels[0]!.elevationMm = -3000;
    const csv = scheduleCsv(buildSchedules(m).find(x => x.scheduleId === 'rooms')!);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n')[0]).toBe('Space ID,Name,Classification,Use,Level ID,Level,Boundary basis,Area (m²),Occupancy');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csv).toContain('"Room, ""north"""');
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    const levels = scheduleCsv(buildSchedules(m).find(x => x.scheduleId === 'levels')!);
    expect(levels).toContain(',-3000,'); // numbers are never prefixed
  });
});

describe('Phase 38 plan sheets', () => {
  it('draws stored geometry exactly, with source ids, and is byte-identical across reads and array orders', () => {
    const m = model(), id = level(m), sheet = buildPlanSheet(m, id, binding);
    expect(sheet.status).toBe('COMPLETE');
    expect(wellFormed(sheet.svg)).toBe(true);
    for (const w of m.walls.filter(x => x.levelId === id)) {
      expect(sheet.svg).toContain(`x1="${w.path.start.x}" y1="${w.path.start.z}" x2="${w.path.end.x}" y2="${w.path.end.z}" stroke-width="${w.thicknessMm}" data-source-id="${w.id}"`);
    }
    for (const o of m.openings.filter(x => x.levelId === id)) {
      const w = m.walls.find(x => x.id === o.wallId)!, len = Math.hypot(w.path.end.x - w.path.start.x, w.path.end.z - w.path.start.z);
      const at = (d: number) => [Math.round(w.path.start.x + ((w.path.end.x - w.path.start.x) * d) / len), Math.round(w.path.start.z + ((w.path.end.z - w.path.start.z) * d) / len)];
      const [x1, z1] = at(o.offsetMm), [x2, z2] = at(o.offsetMm + o.widthMm);
      expect(sheet.svg).toContain(`<line class="${o.kind}" x1="${x1}" y1="${z1}" x2="${x2}" y2="${z2}"`);
      expect(sheet.svg).toContain(`data-source-id="${o.id}" data-host-wall="${w.id}" data-width-mm="${o.widthMm}"`);
    }
    for (const s of m.spaces) expect(sheet.svg).toContain(`data-source-id="${s.id}"`);
    expect(sheet.svg).toContain(binding.modelHash);
    expect(sheet.svg).toContain('No professional review recorded');
    expect(sheet.svg).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/); // no timestamp
    const shuffled = model(); shuffled.walls.reverse(); shuffled.spaces.reverse(); shuffled.openings.reverse();
    expect(buildPlanSheet(shuffled, id, binding).svg).toBe(sheet.svg);
  });

  it('never invents a thickness or an area: unknown values are drawn as unknown and the sheet is INCOMPLETE', () => {
    const m = model(), id = level(m);
    m.walls[0]!.thicknessMm = null; m.spaces[0]!.boundaryBasis = 'unspecified';
    const sheet = buildPlanSheet(m, id, binding);
    expect(sheet.status).toBe('INCOMPLETE');
    expect(sheet.incomplete).toEqual([{ reason: 'WALL_THICKNESS_UNSPECIFIED', entityIds: [m.walls[0]!.id] }, { reason: 'SPACE_AREA_BASIS_UNSPECIFIED', entityIds: [m.spaces[0]!.id] }]);
    expect(sheet.svg).toMatch(new RegExp(`<line class="wall thickness-unspecified" [^>]*data-source-id="${m.walls[0]!.id}"`));
    expect(sheet.svg).not.toMatch(new RegExp(`stroke-width="\\d+" data-source-id="${m.walls[0]!.id}"`));
    expect(sheet.svg).toContain('area basis unspecified');
    expect(sheet.svg).toContain('INCOMPLETE: WALL_THICKNESS_UNSPECIFIED (1), SPACE_AREA_BASIS_UNSPECIFIED (1)');
  });

  it('refuses inconsistent hosting and oversized levels instead of drawing an approximation', () => {
    const refuse = (mutate: (m: BuildingModelV2) => void) => {
      const m = model(), id = level(m); mutate(m);
      try { buildPlanSheet(m, id, binding); } catch (e) { return e instanceof DocumentError ? e.code : String(e); }
      return 'DRAWN';
    };
    expect(refuse(m => { m.openings[0]!.wallId = 'no-such-wall'; })).toBe('DOCUMENT_GEOMETRY_INCONSISTENT');
    expect(refuse(m => { const w = m.walls.find(x => x.id === m.openings[0]!.wallId)!;
      m.openings[0]!.offsetMm = Math.ceil(Math.hypot(w.path.end.x - w.path.start.x, w.path.end.z - w.path.start.z)); })).toBe('DOCUMENT_GEOMETRY_INCONSISTENT');
    expect(refuse(m => { m.levels[0]!.kind = 'datum'; })).toBe('DOCUMENT_GEOMETRY_INCONSISTENT');
    expect(refuse(m => { const w = m.walls[0]!; m.walls.push(...Array.from({ length: PLAN_SHEET_LIMITS.elements }, (_, i) => ({ ...w, id: `bulk-${i}` }))); }))
      .toBe('DOCUMENT_RESOURCE_LIMIT');
    expect(refuse(() => undefined)).toBe('DRAWN');
  });

  it('escapes user text so names cannot inject markup, scripts or attributes', () => {
    const m = model(), id = level(m);
    m.spaces[0]!.name = '<script>alert(1)</script>" onload="x" & \u0001';
    m.openings[0]!.type = '"/><image href="x" onerror="y"/>';
    const sheet = buildPlanSheet(m, id, binding);
    expect(wellFormed(sheet.svg)).toBe(true);
    // Escaped text may read 'onload=&quot;', but no attribute or element can be formed.
    expect(sheet.svg).not.toMatch(/<script|<image|\son(load|error)="/);
    expect(sheet.svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&quot; onload=&quot;x&quot; &amp; \ufffd');
    expect(xmlEscape(`a'b`)).toBe('a&apos;b');
  });
});

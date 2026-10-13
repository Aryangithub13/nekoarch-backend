import type { BuildingModelV2 } from '@designflow/shared';
import { exactAreaM2, ringTwiceAreaMm2 } from './schedules.js';

/** Phase 38: a storey plan drawn only from the stored revision geometry. Integer millimetres, no timestamps, elements sorted by id. */
export const PLAN_SHEET_VERSION = 'plan-sheet-svg-v1';
export const PLAN_SHEET_LIMITS = Object.freeze({ elements: 6000 });
export type SheetBinding = { projectId: string; revisionId: string; revisionNumber: number; modelHash: string; acceptanceQaId: string; qaStatus: string };
export type IncompleteReason = 'WALL_THICKNESS_UNSPECIFIED' | 'SPACE_AREA_BASIS_UNSPECIFIED';
export type PlanSheet = { levelId: string; levelName: string; levelIndex: number; svg: string; status: 'COMPLETE' | 'INCOMPLETE';
  incomplete: { reason: IncompleteReason; entityIds: string[] }[]; notDrawn: { stairs: number; slabs: number; columns: number; dimensions: number }; elementCount: number };

export class DocumentError extends Error {
  constructor(public readonly code: 'DOCUMENT_GEOMETRY_INCONSISTENT' | 'DOCUMENT_RESOURCE_LIMIT', message: string) { super(message); this.name = 'DocumentError'; }
}

/** XML text and attribute escaping. Characters XML 1.0 forbids become U+FFFD, so user text can never break out of its node. */
const xmlForbidden = (code: number) => (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0xfffe || code === 0xffff;
export function xmlEscape(value: string): string {
  return Array.from(value, ch => (xmlForbidden(ch.codePointAt(0)!) ? '\ufffd' : ch)).join('')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const pts = (ring: readonly { x: number; z: number }[]) => ring.map(p => `${p.x},${p.z}`).join(' ');

/** Exact host-wall check: offset + width must lie on the wall's centreline (squared lengths in BigInt; coordinates reach 1e8 mm). */
function hostSpan(wall: BuildingModelV2['walls'][number], offsetMm: number, widthMm: number) {
  const dx = wall.path.end.x - wall.path.start.x, dz = wall.path.end.z - wall.path.start.z;
  if (BigInt(offsetMm + widthMm) ** 2n > BigInt(dx) ** 2n + BigInt(dz) ** 2n) return null;
  const length = Math.hypot(dx, dz), at = (d: number) => ({ x: Math.round(wall.path.start.x + (dx * d) / length), z: Math.round(wall.path.start.z + (dz * d) / length) });
  return { from: at(offsetMm), to: at(offsetMm + widthMm) };
}

export function buildPlanSheet(model: BuildingModelV2, levelId: string, binding: SheetBinding): PlanSheet {
  const level = model.levels.find(l => l.id === levelId);
  if (!level || level.kind !== 'storey') throw new DocumentError('DOCUMENT_GEOMETRY_INCONSISTENT', 'Plan sheets are drawn for storey levels only');
  const spaces = model.spaces.filter(s => s.levelId === levelId).sort(byId), walls = model.walls.filter(w => w.levelId === levelId).sort(byId);
  const openings = model.openings.filter(o => o.levelId === levelId).sort(byId), wallById = new Map(model.walls.map(w => [w.id, w]));
  const elementCount = spaces.length + walls.length + openings.length;
  if (elementCount > PLAN_SHEET_LIMITS.elements) throw new DocumentError('DOCUMENT_RESOURCE_LIMIT', `A plan sheet is limited to ${PLAN_SHEET_LIMITS.elements} elements`);
  const spans = openings.map(o => {
    const wall = wallById.get(o.wallId);
    if (!wall || wall.levelId !== o.levelId) throw new DocumentError('DOCUMENT_GEOMETRY_INCONSISTENT', `Opening ${o.id} is not hosted by a wall on its level`);
    const span = hostSpan(wall, o.offsetMm, o.widthMm);
    if (!span) throw new DocumentError('DOCUMENT_GEOMETRY_INCONSISTENT', `Opening ${o.id} extends beyond its host wall`);
    return { opening: o, wall, span };
  });

  // Extents: the level boundary and everything drawn on the level, plus a 1 m margin and a title band below.
  const xs = [...level.boundary.map(p => p.x), ...walls.flatMap(w => [w.path.start.x, w.path.end.x]), ...spaces.flatMap(s => s.boundary.map(p => p.x))];
  const zs = [...level.boundary.map(p => p.z), ...walls.flatMap(w => [w.path.start.z, w.path.end.z]), ...spaces.flatMap(s => s.boundary.map(p => p.z))];
  const margin = 1000, minX = Math.min(...xs) - margin, minZ = Math.min(...zs) - margin, width = Math.max(...xs) - Math.min(...xs) + 2 * margin;
  const drawingHeight = Math.max(...zs) - Math.min(...zs) + 2 * margin, band = Math.max(2400, Math.round(width / 6)), text = Math.max(150, Math.round(band / 14));

  const thicknessUnknown = walls.filter(w => w.thicknessMm === null).map(w => w.id);
  const basisUnknown = spaces.filter(s => s.boundaryBasis !== 'wall-centerline').map(s => s.id);
  const incomplete = [...(thicknessUnknown.length ? [{ reason: 'WALL_THICKNESS_UNSPECIFIED' as const, entityIds: thicknessUnknown }] : []),
    ...(basisUnknown.length ? [{ reason: 'SPACE_AREA_BASIS_UNSPECIFIED' as const, entityIds: basisUnknown }] : [])];
  // Counted, never approximated: a stair counts on the level it starts from; a dimension without a level counts on every sheet.
  const notDrawn = { stairs: model.stairs.filter(s => s.fromLevelId === levelId).length, slabs: model.slabs.filter(s => s.levelId === levelId).length,
    columns: model.columns.filter(c => c.levelId === levelId).length, dimensions: model.dimensions.filter(d => !d.levelId || d.levelId === levelId).length };

  const line = (from: { x: number; z: number }, to: { x: number; z: number }) => `x1="${from.x}" y1="${from.z}" x2="${to.x}" y2="${to.z}"`;
  const label = (s: typeof spaces[number]) => {
    const twice = ringTwiceAreaMm2(s.boundary);
    // Label at the vertex mean (integer mm). It is a presentation anchor, not a computed property.
    const cx = Math.round(s.boundary.reduce((n, p) => n + p.x, 0) / s.boundary.length), cz = Math.round(s.boundary.reduce((n, p) => n + p.z, 0) / s.boundary.length);
    const area = s.boundaryBasis === 'wall-centerline' ? `${exactAreaM2(twice)} m²` : 'area basis unspecified';
    return `<text class="space-label" x="${cx}" y="${cz}" data-source-id="${xmlEscape(s.id)}">${xmlEscape(s.name)}</text>`
      + `<text class="space-area" x="${cx}" y="${cz + text}" data-source-id="${xmlEscape(s.id)}">${xmlEscape(area)}</text>`;
  };
  const meta = { generator: PLAN_SHEET_VERSION, ...binding, levelId: level.id, levelIndex: level.index, units: 'mm', axes: '+x right, +z down the sheet',
    status: incomplete.length ? 'INCOMPLETE' : 'COMPLETE', incomplete: incomplete.map(i => i.reason), professionalReview: 'NOT_RECORDED' };
  const title = [
    `Plan: ${level.name} (level index ${level.index}, elevation ${level.elevationMm} mm)`,
    `Revision ${binding.revisionNumber} · ${binding.revisionId} · acceptance QA ${binding.qaStatus}`,
    `Model hash ${binding.modelHash}`,
    `${PLAN_SHEET_VERSION} · units mm · +x right, +z down · wall stroke = stored thickness; dashed = thickness not stored`,
    incomplete.length ? `INCOMPLETE: ${incomplete.map(i => `${i.reason} (${i.entityIds.length})`).join(', ')}` : 'All drawn elements have their stored geometry',
    `Not drawn: ${notDrawn.stairs} stairs, ${notDrawn.slabs} slabs, ${notDrawn.columns} columns, ${notDrawn.dimensions} dimensions`,
    'No professional review recorded. Not for construction, permit or code-compliance use.',
  ];
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="${minX} ${minZ} ${width} ${drawingHeight + band}" data-generator="${PLAN_SHEET_VERSION}">`,
    `<metadata id="provenance">${xmlEscape(JSON.stringify(meta))}</metadata>`,
    `<style>.boundary{fill:none;stroke:#999;stroke-width:20;stroke-dasharray:200 100}.space{fill:#f2f2f2;stroke:none}.wall{stroke:#000;stroke-linecap:square}`
      + `.thickness-unspecified{stroke-width:30;stroke-dasharray:150 75}.door{stroke:#b35900}.window{stroke:#0059b3}.opening{stroke:#6b6b6b}`
      + `text{font-family:sans-serif;font-size:${text}px;fill:#000}.space-area{fill:#444}</style>`,
    `<g id="level-boundary"><polygon class="boundary" points="${pts(level.boundary)}" data-source-id="${xmlEscape(level.id)}"/></g>`,
    `<g id="spaces">${spaces.map(s => `<polygon class="space" points="${pts(s.boundary)}" data-source-id="${xmlEscape(s.id)}"/>`).join('')}</g>`,
    `<g id="walls">${walls.map(w => `<line class="wall${w.thicknessMm === null ? ' thickness-unspecified' : ''}" ${line(w.path.start, w.path.end)}`
      + `${w.thicknessMm === null ? '' : ` stroke-width="${w.thicknessMm}"`} data-source-id="${xmlEscape(w.id)}"/>`).join('')}</g>`,
    // Opening symbols lie on the host centreline between offset and offset + width; their stroke is symbolic (the wall's stored thickness, else 60 mm).
    `<g id="openings">${spans.map(({ opening: o, wall, span }) => `<line class="${o.kind}" ${line(span.from, span.to)} stroke-width="${wall.thicknessMm ?? 60}"`
      + ` data-source-id="${xmlEscape(o.id)}" data-host-wall="${xmlEscape(wall.id)}" data-width-mm="${o.widthMm}"/>`).join('')}</g>`,
    `<g id="space-labels">${spaces.map(label).join('')}</g>`,
    `<g id="title-block">${title.map((t, i) => `<text x="${minX + margin}" y="${minZ + drawingHeight + text * (i + 2)}">${xmlEscape(t)}</text>`).join('')}</g>`,
    '</svg>', '',
  ].join('\n');
  return { levelId: level.id, levelName: level.name, levelIndex: level.index, svg, status: incomplete.length ? 'INCOMPLETE' : 'COMPLETE', incomplete, notDrawn, elementCount };
}

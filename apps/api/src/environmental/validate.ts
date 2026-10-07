import { createHash } from 'node:crypto';
import { ringsOverlap, wallSpaceIds, type BuildingModelV2 } from '@designflow/shared';
import { digest, semanticId } from '../bim/core.js';
import { ENVIRONMENTAL_ANALYSIS_VERSION, ENVIRONMENTAL_LIMITS, ENVIRONMENTAL_MODEL_VERSION, EnvironmentalModelSchema, MODEL_VALIDATOR, ModelValidationSchema, RESULT_VALIDATOR,
  ResultValidationSchema, ResultsSchema, SURFACE_TYPES, type EnvironmentalBinding, type EnvironmentalInput, type EnvironmentalModel, type ModelValidation, type ResultValidation } from './contracts.js';

/**
 * Independent verifier. Imports nothing from model.ts, solar.ts, shading.ts or analysis.ts: wall exposure comes from Phase 23 adjacency,
 * the sun from a different algorithm (PSA, Blanco-Muriel 2001), occlusion from a separately written plane-intersection caster, and every
 * heat flow and energy is recomputed from the input.
 */
const CALCULATORS: Record<string, string[]> = { 'nekoarch-reference-environmental': ['1.0.0'] };
type Diagnostic = ModelValidation['diagnostics'][number];
type V = [number, number, number];
type P = { x: number; z: number };
const recorder = () => { const diagnostics: Diagnostic[] = [];
  return { diagnostics, error: (code: string, message: string, targetId: string | null = null) => { if (diagnostics.length < 199) diagnostics.push({ code, targetId, message, severity: 'ERROR' }); } }; };
const close = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(a), Math.abs(b));
const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const shoelace = (ring: P[]) => Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]!; return s + p.x * q.z - q.x * p.z; }, 0)) / 2;
/** Winding-number containment, strict interior only (boundary points count as outside). */
function strictlyInside(p: P, ring: P[]) {
  let wn = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!, side = (b.x - a.x) * (p.z - a.z) - (p.x - a.x) * (b.z - a.z);
    if (side === 0 && Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.z, b.z) <= p.z && p.z <= Math.max(a.z, b.z)) return false;
    if (a.z <= p.z) { if (b.z > p.z && side > 0) wn++; } else if (b.z <= p.z && side < 0) wn--;
  }
  return wn !== 0;
}
const frameOf = (milli: number) => { const t = milli / 1000 * RAD; return { north: [Math.sin(t), 0, -Math.cos(t)] as V, east: [Math.cos(t), 0, Math.sin(t)] as V }; };
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

export function validateEnvironmentalModel(candidate: unknown, source: BuildingModelV2, input: EnvironmentalInput, binding: EnvironmentalBinding): ModelValidation {
  const { diagnostics, error } = recorder();
  const done = () => ModelValidationSchema.parse({ validator: MODEL_VALIDATOR, status: diagnostics.length ? 'INVALID' : 'VALID', diagnostics });
  const parsed = EnvironmentalModelSchema.safeParse(candidate);
  if (!parsed.success) { error('SCHEMA', 'Environmental model schema, unit or finite-value violation'); return done(); }
  const m = parsed.data, pid = binding.projectId;
  const eid = (...parts: (string | number | null)[]) => `env-${createHash('sha256').update(JSON.stringify([pid, ENVIRONMENTAL_MODEL_VERSION, ...parts])).digest('hex').slice(0, 40)}`;
  if (digest(m.binding) !== digest(binding)) error('BINDING', 'Model is bound to a different revision, hash or version');
  if (digest(m.location) !== digest(input.location)) error('LOCATION', 'Location differs from the explicit input');
  if ((input.orientation === null) !== (m.orientation === null)) error('ORIENTATION', 'Orientation presence differs from the input');
  if (input.orientation && m.orientation) {
    const f = frameOf(input.orientation.northMilliDegrees);
    if (m.orientation.northMilliDegrees !== input.orientation.northMilliDegrees || ![...f.north, ...f.east].every((v, i) => close(v, [...m.orientation!.north, ...m.orientation!.east][i]!, 1e-12))
      || m.orientation.up.join() !== '0,1,0' || m.orientation.siteNorthMilliDegrees !== (source.site?.northMilliDegrees ?? null)) error('ORIENTATION', 'North/east frame differs from the explicit orientation');
  }
  const levels = new Map(source.levels.map(l => [l.id, l]));
  // Zones.
  const zoneIds = new Map(source.spaces.map(s => [s.id, eid('zone', s.id)]));
  if (m.zones.length !== source.spaces.length) error('ZONE', 'Zone inventory differs from the spaces');
  for (const s of source.spaces) {
    const z = m.zones.find(x => x.id === zoneIds.get(s.id)), l = levels.get(s.levelId)!, a = shoelace(s.boundary) / 1e6;
    if (!z || z.source.id !== s.id || z.source.bimElementId !== semanticId(pid, 'space', s.id) || z.levelId !== s.levelId || !close(z.floorArea.value, a, 1e-12)
      || z.height.value !== l.floorToFloorHeightMm || !close(z.volume.value, a * l.floorToFloorHeightMm! / 1000, 1e-12)) error('ZONE', 'Zone source, area, height or volume is wrong', z?.id ?? null);
  }
  // Expected envelope inventory from Phase 23 adjacency (not the builder's sampling).
  const expected = new Map<string, { type: string; collection: string; id: string }>();
  const resolve = (type: string, collection: string, id: string) => {
    const k = input.overrides.find(o => o.source.collection === collection && o.source.id === id)?.construction ?? input.assignments[type as keyof typeof input.assignments];
    return input.constructions.find(c => c.key === k) ?? null;
  };
  const opening = (kind: string) => kind === 'window' ? 'WINDOW' : kind === 'door' ? 'DOOR' : 'OPENING';
  for (const w of source.walls) {
    const adjacent = wallSpaceIds(source, w);
    if (adjacent.length !== 1) continue;
    expected.set(eid('surface', 'EXTERIOR_WALL', 'walls', w.id), { type: 'EXTERIOR_WALL', collection: 'walls', id: w.id });
    for (const o of source.openings.filter(x => x.wallId === w.id)) expected.set(eid('surface', opening(o.kind), 'openings', o.id), { type: opening(o.kind), collection: 'openings', id: o.id });
  }
  const floorLevels = source.slabs.filter(s => s.kind === 'floor').map(s => levels.get(s.levelId)!.elevationMm), lowest = Math.min(...floorLevels);
  for (const s of source.slabs) {
    if (s.kind === 'flat-roof') expected.set(eid('surface', 'ROOF', 'slabs', s.id), { type: 'ROOF', collection: 'slabs', id: s.id });
    if (s.kind === 'floor' && levels.get(s.levelId)!.elevationMm === lowest) expected.set(eid('surface', 'GROUND_FLOOR', 'slabs', s.id), { type: 'GROUND_FLOOR', collection: 'slabs', id: s.id });
  }
  const seen = new Set(m.surfaces.map(s => s.id));
  if (seen.size !== m.surfaces.length || m.surfaces.length !== expected.size || [...expected.keys()].some(k => !seen.has(k))) error('INVENTORY', 'Envelope surfaces differ from the independently derived inventory (missing, extra or duplicated)');
  const frame = input.orientation ? frameOf(input.orientation.northMilliDegrees) : null;
  for (const s of m.surfaces) {
    const e = expected.get(s.id); if (!e) continue;
    if (s.type !== e.type || s.source.collection !== e.collection || s.source.id !== e.id) { error('IDENTITY', 'Surface type or source differs', s.id); continue; }
    const c = resolve(s.type, e.collection, e.id);
    if (c ? s.construction.status !== 'SPECIFIED' || s.construction.key !== c.key || s.construction.uValue?.value !== c.uValue.value || s.construction.uValue?.unit !== 'W/(m2*K)' || digest(s.construction.provenance) !== digest(c.provenance)
      : s.construction.status !== 'NOT_SPECIFIED') error('PROPERTY', 'Construction differs from the explicit assignment or invents a property', s.id);
    const n = s.normal;
    if (!close(Math.hypot(...n), 1, 1e-12)) error('NORMAL', 'Normal is not a unit vector', s.id);
    if (!close(s.tilt.value, Math.acos(Math.max(-1, Math.min(1, n[1]))) * DEG, 1e-12)) error('NORMAL', 'Tilt differs from the normal', s.id);
    if (frame && n[1] === 0 ? !s.azimuth || !close(s.azimuth.value, ((Math.atan2(dot(n, frame.east), dot(n, frame.north)) * DEG) % 360 + 360) % 360, 1e-12) : s.azimuth !== null) error('NORMAL', 'Azimuth differs from the normal and orientation', s.id);
    if (e.collection === 'slabs') {
      const slab = source.slabs.find(x => x.id === e.id)!, l = levels.get(slab.levelId)!, roof = e.type === 'ROOF', g = s.geometry;
      const area = (shoelace(slab.footprint.outer) - slab.footprint.voids.reduce((a, v) => a + shoelace(v), 0)) / 1e6;
      if (g.kind !== 'HORIZONTAL_POLYGON' || digest(g.outer) !== digest(slab.footprint.outer) || digest(g.voids) !== digest(slab.footprint.voids) || g.elevationMm !== l.elevationMm + slab.topOffsetMm)
        error('GEOMETRY', 'Plate geometry differs from the source', s.id);
      if (n.join() !== (roof ? '0,1,0' : '0,-1,0') || s.boundary !== (roof ? 'OUTDOOR' : 'GROUND')) error('NORMAL', 'Plate normal or boundary is reversed', s.id);
      if (!close(s.grossArea.value, area, 1e-12) || !close(s.netArea.value, area, 1e-12)) error('AREA', 'Plate area differs from footprint minus voids', s.id);
      const zones = source.spaces.filter(x => x.levelId === slab.levelId && ringsOverlap(x.boundary, slab.footprint.outer)).map(x => zoneIds.get(x.id)!).sort();
      if (s.zoneIds.join() !== zones.join() || s.levelId !== slab.levelId || s.source.bimElementId !== semanticId(pid, roof ? 'roof' : 'slab', slab.id)) error('REFERENCE', 'Plate zone, level or BIM reference is wrong', s.id);
      continue;
    }
    const wall = e.collection === 'walls' ? source.walls.find(w => w.id === e.id)! : source.walls.find(w => w.id === source.openings.find(o => o.id === e.id)!.wallId)!;
    const l = levels.get(wall.levelId)!, space = source.spaces.find(x => x.id === wallSpaceIds(source, wall)[0])!, g = s.geometry;
    const a = wall.path.start, b = wall.path.end, len = Math.hypot(b.x - a.x, b.z - a.z), bottom = l.elevationMm + (wall.baseOffsetMm ?? 0);
    // Outward: 0.25 mm along the normal from the middle of the wall leaves the space; 0.25 mm against it enters.
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    if (n[1] !== 0 || !close(n[0] * (b.x - a.x) + n[2] * (b.z - a.z), 0, 1e-12) || strictlyInside({ x: mid.x + n[0] * 0.25, z: mid.z + n[2] * 0.25 }, space.boundary)
      || !strictlyInside({ x: mid.x - n[0] * 0.25, z: mid.z - n[2] * 0.25 }, space.boundary)) error('NORMAL', 'Wall normal is not horizontal and outward', s.id);
    if (s.boundary !== 'OUTDOOR' || s.levelId !== wall.levelId || s.zoneIds.join() !== zoneIds.get(space.id)) error('REFERENCE', 'Wall-hosted surface boundary, level or zone is wrong', s.id);
    if (g.kind !== 'VERTICAL_RECTANGLE' || g.storeyTopMm !== l.elevationMm + l.floorToFloorHeightMm! || g.faceOffsetMm !== (wall.thicknessMm ?? NaN) / 2) { error('GEOMETRY', 'Vertical surface geometry is wrong', s.id); continue; }
    if (e.collection === 'walls') {
      const holes = source.openings.filter(o => o.wallId === wall.id).reduce((x, o) => x + o.widthMm * o.heightMm, 0);
      if (g.start.x !== a.x || g.start.z !== a.z || g.end.x !== b.x || g.end.z !== b.z || g.bottomMm !== bottom || g.topMm !== bottom + (wall.heightMm ?? NaN)) error('GEOMETRY', 'Wall geometry differs from the source', s.id);
      if (!close(s.grossArea.value, len * wall.heightMm! / 1e6, 1e-12) || !close(s.netArea.value, (len * wall.heightMm! - holes) / 1e6, 1e-12)) error('AREA', 'Wall gross or net area is wrong (openings deducted once each)', s.id);
      if (s.hostSurfaceId !== null || s.source.bimElementId !== semanticId(pid, 'wall', wall.id)) error('REFERENCE', 'Wall reference is wrong', s.id);
      if (s.classification.architectural !== wall.classification || s.classification.status !== (wall.classification === 'unspecified' ? 'ASSUMED' : 'CONSISTENT')) error('CLASSIFICATION', 'Classification transcription is wrong', s.id);
    } else {
      const o = source.openings.find(x => x.id === e.id)!, ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
      if (g.start.x !== a.x + ux * o.offsetMm || g.start.z !== a.z + uz * o.offsetMm || g.end.x !== g.start.x + ux * o.widthMm || g.end.z !== g.start.z + uz * o.widthMm
        || g.bottomMm !== bottom + o.sillMm || g.topMm !== bottom + o.sillMm + o.heightMm || o.offsetMm + o.widthMm > len || o.sillMm + o.heightMm > (wall.heightMm ?? 0)) error('GEOMETRY', 'Opening geometry differs from its host or leaves it', s.id);
      if (!close(s.grossArea.value, o.widthMm * o.heightMm / 1e6, 1e-12) || !close(s.netArea.value, s.grossArea.value, 1e-12)) error('AREA', 'Opening area is wrong', s.id);
      if (s.hostSurfaceId !== eid('surface', 'EXTERIOR_WALL', 'walls', wall.id) || s.source.bimElementId !== semanticId(pid, o.kind === 'opening' ? 'opening' : o.kind, o.id)) error('REFERENCE', 'Opening host or BIM reference is wrong', s.id);
    }
  }
  const uncovered = source.spaces.filter(x => !source.slabs.some(s => ((s.kind === 'flat-roof' && s.levelId === x.levelId) || (s.kind === 'floor' && levels.get(s.levelId)!.elevationMm > levels.get(x.levelId)!.elevationMm))
    && ringsOverlap(x.boundary, s.footprint.outer))).map(x => zoneIds.get(x.id)!).sort();
  if (m.envelope.status !== (uncovered.length ? 'INCOMPLETE' : 'CLOSED') || m.envelope.uncoveredZoneIds.join() !== uncovered.join()) error('ENVELOPE', 'Envelope closure report differs');
  return done();
}

/** PSA solar position (Blanco-Muriel et al. 2001), topocentric parallax included; azimuth clockwise from north. */
export function psaSolarPosition(utcMs: number, latitude: number, longitude: number) {
  const n = utcMs / 86_400_000 + 2440587.5 - 2451545, hours = (((utcMs % 86_400_000) + 86_400_000) % 86_400_000) / 3_600_000;
  const omega = 2.1429 - 0.0010394594 * n, L = 4.8950630 + 0.017202791698 * n, g = 6.2400600 + 0.0172019699 * n;
  const lambda = L + 0.03341607 * Math.sin(g) + 0.00034894 * Math.sin(2 * g) - 0.0001134 - 0.0000203 * Math.sin(omega);
  const eps = 0.4090928 - 6.2140e-9 * n + 0.0000396 * Math.cos(omega);
  let ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)); if (ra < 0) ra += 2 * Math.PI;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda)), gmst = 6.6974243242 + 0.0657098283 * n + hours, H = (gmst * 15 + longitude) * RAD - ra, phi = latitude * RAD;
  let zenith = Math.acos(Math.cos(phi) * Math.cos(H) * Math.cos(dec) + Math.sin(dec) * Math.sin(phi));
  let az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H)); if (az < 0) az += 2 * Math.PI;
  zenith += 6371.01 / 149597890 * Math.sin(zenith);
  return { altitude: 90 - zenith * DEG, azimuth: az * DEG };
}

/** Independent occlusion test: plane intersection, then in-rectangle / in-polygon (winding). Same documented semantics as the calculator. */
function blocked(o: V, d: V, model: EnvironmentalModel, skip: Set<string>) {
  for (const s of model.surfaces) {
    if (skip.has(`${s.source.collection}:${s.source.id}`)) continue;
    const g = s.geometry;
    if (s.type === 'EXTERIOR_WALL' && g.kind === 'VERTICAL_RECTANGLE') {
      const e: V = [g.end.x - g.start.x, 0, g.end.z - g.start.z], len2 = dot(e, e), pn: V = [-e[2], 0, e[0]], den = dot(pn, d);
      if (Math.abs(den) <= 1e-12 * Math.sqrt(len2)) continue;
      const t = dot(pn, [g.start.x - o[0], 0, g.start.z - o[2]]) / den; if (!(t > 1e-6)) continue;
      const h: V = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]], u = dot([h[0] - g.start.x, 0, h[2] - g.start.z], e) / len2;
      if (u >= -1e-9 && u <= 1 + 1e-9 && h[1] >= g.bottomMm - 1e-9 && h[1] <= g.storeyTopMm + 1e-9) return true;
    } else if (s.type === 'ROOF' && g.kind === 'HORIZONTAL_POLYGON') {
      if (Math.abs(d[1]) <= 1e-12) continue;
      const t = (g.elevationMm - o[1]) / d[1]; if (!(t > 1e-6)) continue;
      const p = { x: o[0] + t * d[0], z: o[2] + t * d[2] };
      if (onOrIn(p, g.outer) && !g.voids.some(v => strictlyInsideFloat(p, v))) return true;
    }
  }
  return false;
}
function winding(p: P, ring: P[]) { let w = 0; for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!, side = (b.x - a.x) * (p.z - a.z) - (p.x - a.x) * (b.z - a.z);
  if (a.z <= p.z) { if (b.z > p.z && side > 0) w++; } else if (b.z <= p.z && side < 0) w--; } return w; }
function nearEdge(p: P, ring: P[]) { return ring.some((a, i) => { const b = ring[(i + 1) % ring.length]!, L = Math.hypot(b.x - a.x, b.z - a.z);
  return Math.abs((b.x - a.x) * (p.z - a.z) - (p.x - a.x) * (b.z - a.z)) <= 1e-9 * L && p.x >= Math.min(a.x, b.x) - 1e-9 && p.x <= Math.max(a.x, b.x) + 1e-9 && p.z >= Math.min(a.z, b.z) - 1e-9 && p.z <= Math.max(a.z, b.z) + 1e-9; }); }
const onOrIn = (p: P, ring: P[]) => nearEdge(p, ring) || winding(p, ring) !== 0;
const strictlyInsideFloat = (p: P, ring: P[]) => !nearEdge(p, ring) && winding(p, ring) !== 0;
/** Sample cell centres per the documented rule (≈500 mm cells, 1–8 per axis; polygons refined ×2, ×4 if no centre falls inside). */
function samples(s: EnvironmentalModel['surfaces'][number]): V[] {
  const g = s.geometry, k = (x: number) => Math.min(ENVIRONMENTAL_LIMITS.samplesPerAxis, Math.max(1, Math.ceil(x / 500))), out: V[] = [];
  if (g.kind === 'VERTICAL_RECTANGLE') {
    const nu = k(Math.hypot(g.end.x - g.start.x, g.end.z - g.start.z)), nv = k(g.topMm - g.bottomMm);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) out.push([g.start.x + (g.end.x - g.start.x) * (i + 0.5) / nu, g.bottomMm + (g.topMm - g.bottomMm) * (j + 0.5) / nv, g.start.z + (g.end.z - g.start.z) * (i + 0.5) / nu]);
    return out;
  }
  const xs = g.outer.map(p => p.x), zs = g.outer.map(p => p.z), x0 = Math.min(...xs), z0 = Math.min(...zs), w = Math.max(...xs) - x0, d = Math.max(...zs) - z0;
  for (const f of [1, 2, 4]) { for (let i = 0; i < k(w) * f; i++) for (let j = 0; j < k(d) * f; j++) { const p = { x: x0 + w * (i + 0.5) / (k(w) * f), z: z0 + d * (j + 0.5) / (k(d) * f) };
    if (onOrIn(p, g.outer) && !g.voids.some(v => strictlyInsideFloat(p, v))) out.push([p.x, g.elevationMm, p.z]); } if (out.length) return out; }
  return out;
}
/** Wall-clock of a UTC instant in a zone, `YYYY-MM-DDTHH:MM[:SS]` as given. */
function wallClock(utc: string, timeZone: string, like: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(Date.parse(utc)).map(x => [x.type, x.value]));
  const text = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
  return like.length === 19 ? `${text}:${p.second}` : p.second === '00' ? text : `${text}:${p.second}`;
}

export function validateEnvironmentalResults(snapshot: { binding: EnvironmentalBinding; input: EnvironmentalInput; inputHash: string; model: EnvironmentalModel; results: unknown;
  calculator: { name: string; version: string; adapterVersion: string; settings: Record<string, string | number> } }, expected: { binding: EnvironmentalBinding }): ResultValidation {
  const { diagnostics, error } = recorder(); let solarMaxDeviation: number | null = null;
  const done = () => ResultValidationSchema.parse({ validator: RESULT_VALIDATOR, status: diagnostics.length ? 'INVALID' : 'VALID', diagnostics,
    solarMaxDeviation: solarMaxDeviation === null ? null : { value: solarMaxDeviation, unit: 'deg' } });
  const parsed = ResultsSchema.safeParse(snapshot.results);
  if (!parsed.success) { error('SCHEMA', 'Result schema, unit or finite-value violation'); return done(); }
  const r = parsed.data, m = snapshot.model, input = snapshot.input;
  if (digest(snapshot.binding) !== digest(expected.binding) || digest(m.binding) !== digest(expected.binding)) error('BINDING', 'Results are bound to a different revision or model hash');
  if (!CALCULATORS[snapshot.calculator.name]?.includes(snapshot.calculator.version)) error('PROVENANCE', 'Unknown calculator identity');
  if (digest({ environmentalModelVersion: ENVIRONMENTAL_MODEL_VERSION, analysisVersion: ENVIRONMENTAL_ANALYSIS_VERSION, binding: expected.binding, input,
    calculator: { name: snapshot.calculator.name, version: snapshot.calculator.version, adapterVersion: snapshot.calculator.adapterVersion, settings: snapshot.calculator.settings } }) !== snapshot.inputHash)
    error('PROVENANCE', 'Input hash does not match binding, input and calculator');
  const loc = input.location, weatherAt = new Map((input.weather?.samples ?? []).map(s => [Date.parse(s.timestamp), s]));
  // Solar position: same instants, local time round-trips, PSA within 0.05°.
  const expectedInstants = loc ? input.solarInstants : [];
  if (r.solar.instants.map(i => `${i.key}|${i.localDateTime}`).join() !== expectedInstants.map(i => `${i.key}|${i.localDateTime}`).join()) error('SOLAR', 'Solar instants differ from the input');
  if (r.solar.status !== (!input.solarInstants.length ? 'NOT_EVALUATED' : loc ? 'ANALYZED' : 'INPUT_INCOMPLETE')) error('STATUS', 'Solar status is inconsistent with the input');
  for (const i of r.solar.instants) {
    if (!loc || i.timezone !== loc.timezone || wallClock(i.utc, loc.timezone, i.localDateTime) !== i.localDateTime) { error('SOLAR', 'UTC instant does not match the local time and zone', null); continue; }
    const p = psaSolarPosition(Date.parse(i.utc), loc.latitude.value, loc.longitude.value), dAlt = Math.abs(p.altitude - i.altitude.value);
    const dAz = p.altitude > 89.5 ? 0 : Math.abs(((p.azimuth - i.azimuth.value + 540) % 360) - 180);
    solarMaxDeviation = Math.max(solarMaxDeviation ?? 0, dAlt, dAz);
    if (dAlt > 0.05 || dAz > 0.05) error('SOLAR', `Solar position deviates from an independent algorithm (${dAlt.toFixed(3)}°, ${dAz.toFixed(3)}°)`, null);
    if (i.aboveHorizon !== i.altitude.value > 0) error('SOLAR', 'Above-horizon flag contradicts the altitude', null);
    if (m.orientation) {
      const f = frameOf(m.orientation.northMilliDegrees), a = i.altitude.value * RAD, z = i.azimuth.value * RAD, h = Math.cos(a);
      const s: V = [h * (Math.cos(z) * f.north[0] + Math.sin(z) * f.east[0]), Math.sin(a), h * (Math.cos(z) * f.north[2] + Math.sin(z) * f.east[2])];
      if (!i.sunDirection || i.sunDirection.some((v, k) => Math.abs(v - s[k]!) > 1e-9)) error('SOLAR', 'Sun direction contradicts altitude, azimuth and orientation', null);
    } else if (i.sunDirection !== null) error('SOLAR', 'Sun direction reported without an orientation', null);
  }
  // Exposure: states from incidence, sample counts, an independent ray cast (≤ one sample), direct beam from the supplied DNI only.
  const hasExposure = input.solarInstants.length > 0 && loc !== null && m.orientation !== null;
  if (r.exposure.instants.length !== (hasExposure ? r.solar.instants.length : 0)) error('EXPOSURE', 'Exposure instants are missing or unexpected');
  const sampleCache = new Map(m.surfaces.map(s => [s.id, samples(s)])), hosts = new Map(m.surfaces.map(s => [s.id, s.hostSurfaceId ? m.surfaces.find(x => x.id === s.hostSurfaceId) ?? null : null]));
  for (const [k, ins] of r.exposure.instants.entries()) {
    const sp = r.solar.instants[k]; if (!sp || sp.key !== ins.key || !sp.sunDirection) { error('EXPOSURE', 'Exposure instant has no matching sun position'); continue; }
    if (ins.surfaces.map(s => s.surfaceId).join() !== m.surfaces.map(s => s.id).join()) { error('EXPOSURE', 'Exposure surfaces differ from the model', null); continue; }
    const sun = sp.sunDirection as V, dni = weatherAt.get(Date.parse(sp.utc))?.directNormalIrradiance ?? null;
    for (const [j, e] of ins.surfaces.entries()) {
      const s = m.surfaces[j]!, cos = dot(s.normal, sun), pts = sampleCache.get(s.id)!;
      if (!close(e.cosIncidence, Math.max(-1, Math.min(1, cos)), 1e-9) || e.samples !== pts.length) { error('EXPOSURE', 'Incidence or sample count is wrong', s.id); continue; }
      const state = !sp.aboveHorizon ? 'SUN_BELOW_HORIZON' : cos <= 1e-6 ? 'NOT_FACING' : 'EVALUATED';
      if (e.state !== state) { error('EXPOSURE', 'Exposure state contradicts the sun position and the outward normal', s.id); continue; }
      if (state === 'EVALUATED') {
        const host = hosts.get(s.id), skip = new Set([`${s.source.collection}:${s.source.id}`, ...(host ? [`${host.source.collection}:${host.source.id}`] : [])]);
        const off = 1 + (s.geometry.kind === 'VERTICAL_RECTANGLE' ? s.geometry.faceOffsetMm : 0);
        const lit = pts.filter(p => !blocked([p[0] + s.normal[0] * off, p[1] + s.normal[1] * off, p[2] + s.normal[2] * off], sun, m, skip)).length;
        if (Math.abs(lit - e.sunlitSamples) > 1) error('EXPOSURE', `Sunlit samples ${e.sunlitSamples} differ from an independent ray cast (${lit})`, s.id);
      } else if (e.sunlitSamples !== 0) error('EXPOSURE', 'A surface without direct sun reports sunlit samples', s.id);
      if (!close(e.sunlitFraction, e.sunlitSamples / e.samples, 1e-15)) error('EXPOSURE', 'Sunlit fraction arithmetic is wrong', s.id);
      if (dni === null ? e.directBeam.status !== 'NOT_EVALUATED' : e.directBeam.status !== 'EVALUATED' || e.directBeam.dni.value !== dni
        || !close(e.directBeam.incident.value, dni * Math.max(cos, 0) * e.sunlitFraction) || !close(e.directBeam.power.value, dni * Math.max(cos, 0) * e.sunlitFraction * s.netArea.value))
        error('IRRADIANCE', 'Direct-beam irradiance is not DNI × cos θ × sunlit fraction from the supplied dataset', s.id);
    }
  }
  if (r.exposure.status !== (!input.solarInstants.length ? 'NOT_EVALUATED' : !hasExposure ? 'INPUT_INCOMPLETE' : m.envelope.status === 'CLOSED' ? 'ANALYZED' : 'PARTIAL'))
    error('STATUS', 'Exposure status is inconsistent with the input');
  // Thermal: recompute every flow, total and energy from the input and validated model.
  if (r.thermal.cases.map(c => c.key).join() !== input.thermalCases.map(c => c.key).join()) error('THERMAL', 'Thermal cases differ from the input');
  const series = input.weather?.samples.map(s => s.dryBulb) ?? null, hours = input.weather ? input.weather.intervalMinutes / 60 : null;
  for (const [k, c] of r.thermal.cases.entries()) {
    const ic = input.thermalCases[k]; if (!ic) continue;
    const incomplete = ic.outside.kind === 'WEATHER' && (!series || series.some(t => t === null));
    const outside = ic.outside.kind === 'CONSTANT' ? ic.outside.temperature.value : incomplete ? null : series!.reduce((a: number, t) => a + t!, 0) / series!.length;
    const dOut = outside === null ? null : ic.inside.value - outside, dGround = ic.ground ? ic.inside.value - ic.ground.value : null;
    if (c.surfaces.map(s => s.surfaceId).join() !== m.surfaces.map(s => s.id).join()) { error('THERMAL', 'Thermal surfaces differ from the model', null); continue; }
    let total = 0, area = 0, ua = 0, groundFlow = 0; const byType = Object.fromEntries(SURFACE_TYPES.map(t => [t, 0])) as Record<string, number>, missing: string[] = [];
    for (const [j, row] of c.surfaces.entries()) {
      const s = m.surfaces[j]!, dT = s.boundary === 'GROUND' ? dGround : dOut;
      const want = incomplete ? 'NOT_EVALUATED' : s.type === 'OPENING' ? 'UNSUPPORTED' : s.construction.status === 'NOT_SPECIFIED' ? 'NOT_SPECIFIED' : dT === null ? 'NOT_EVALUATED' : 'EVALUATED';
      if (row.status !== want) { error('THERMAL', 'Surface thermal status is inconsistent with the input', s.id); continue; }
      if (want !== 'EVALUATED') { if (row.heatFlow !== null) error('THERMAL', 'An unevaluated surface reports a heat flow', s.id); missing.push(s.id); continue; }
      const q = s.construction.uValue!.value * s.netArea.value * dT!;
      if (!row.heatFlow || !close(row.heatFlow.value, q)) error('THERMAL', 'Heat flow is not U × A × ΔT', s.id);
      total += q; area += s.netArea.value; byType[s.type]! += q; if (s.boundary === 'GROUND') groundFlow += q; else ua += s.construction.uValue!.value * s.netArea.value;
    }
    const complete = !incomplete && !missing.length && m.envelope.status === 'CLOSED', status = incomplete ? 'INPUT_INCOMPLETE' : complete ? 'ANALYZED' : 'PARTIAL';
    if (c.status !== status || c.unevaluatedSurfaceIds.join() !== missing.join()) error('THERMAL', 'Case status or unevaluated list is wrong', null);
    if (!close(c.total.value, total) || !close(c.totalKw.value, total / 1000) || !close(c.evaluatedArea.value, area) || SURFACE_TYPES.some(t => !close(c.byType[t].value, byType[t]!))) error('THERMAL', 'Totals are not the sum of surface flows', null);
    if ((c.deltaT.outdoor?.value ?? null) !== dOut || (c.deltaT.ground?.value ?? null) !== dGround) error('THERMAL', 'Temperature differences are wrong (K, inside minus outside/ground)', null);
    const energy = !complete ? null : ic.outside.kind === 'CONSTANT' ? (ic.durationHours ? { wh: total * ic.durationHours.value, h: ic.durationHours.value, peak: total, n: 1 } : null)
      : (() => { const p = series!.map(t => ua * (ic.inside.value - t!) + groundFlow); return { wh: p.reduce((a, x) => a + x * hours!, 0), h: p.length * hours!, peak: Math.max(...p), n: p.length }; })();
    if (energy === null ? c.energy !== null : !c.energy || !close(c.energy.energy.value, energy.wh) || !close(c.energy.energyKwh.value, energy.wh / 1000) || !close(c.energy.duration.value, energy.h)
      || !close(c.energy.peakPower.value, energy.peak) || c.energy.samples !== energy.n || c.energy.method !== (ic.outside.kind === 'CONSTANT' ? 'CONSTANT_POWER_TIMES_DURATION' : 'SAMPLED_SERIES_LEFT_RECTANGLE'))
      error('ENERGY', 'Energy is not power integrated over the stated duration', null);
  }
  const statuses = r.thermal.cases.map(c => c.status);
  if (r.thermal.status !== (!statuses.length ? 'NOT_EVALUATED' : statuses.every(s => s === 'ANALYZED') ? 'ANALYZED' : statuses.every(s => s === 'INPUT_INCOMPLETE') ? 'INPUT_INCOMPLETE' : 'PARTIAL')) error('STATUS', 'Thermal status is inconsistent');
  // Geometric indicator.
  if (r.daylightIndicator.zones.length !== m.zones.length || r.daylightIndicator.zones.some((z, i) => { const zone = m.zones[i]!, win = m.surfaces.filter(s => s.type === 'WINDOW' && s.zoneIds.includes(zone.id)).reduce((a, s) => a + s.netArea.value, 0);
    return z.zoneId !== zone.id || !close(z.windowArea.value, win) || !close(z.floorArea.value, zone.floorArea.value) || !close(z.ratio.value, win / zone.floorArea.value); })) error('INDICATOR', 'Window-to-floor ratios are wrong');
  if (r.weather.used !== (input.weather !== null) || r.weather.synthetic !== (input.weather?.provenance.synthetic ?? null) || r.weather.sha256 !== (input.weather?.sha256 ?? null)
    || r.weather.datasetId !== (input.weather?.provenance.datasetId ?? null)) error('PROVENANCE', 'Weather provenance differs from the input');
  return done();
}

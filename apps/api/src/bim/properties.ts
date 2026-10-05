import type { BuildingModelV2 } from '@designflow/shared';
import type { BimProperty, SourceRef } from './contracts.js';
import { compare, sourceValue } from './core.js';
/** Fixed property vocabulary. No client-authored properties or inferred engineering specifications. */
export function propertiesFor(m: BuildingModelV2, ref: SourceRef): BimProperty[] {
  const raw = sourceValue(m,ref), p: BimProperty[] = [];
  const source = raw && !Array.isArray(raw) ? raw as Record<string,unknown> : {};
  const native = (key: BimProperty['key'], field: string, unit: BimProperty['unit']) => {
    const value = source[field];
    if (value !== undefined) p.push({ key, value: value === null ? null : value as string | number, unit, state: value === null ? 'not_available' : 'known', provenance: value === null ? 'unspecified' : 'native' });
  };
  native('classification','classification','text'); native('elevation','elevationMm','mm');
  native('height','heightMm','mm'); native('thickness','thicknessMm','mm'); native('width','widthMm','mm');
  native('sill','sillMm','mm'); native('offset','offsetMm','mm'); native('boundaryBasis','boundaryBasis','text');
  native('rise','riseMm','mm'); native('run','runMm','mm'); native('treadDepth','treadDepthMm','mm');
  if (ref.collection === 'walls') {
    const w = m.walls.find(w => w.id === ref.id)!;
    p.push({ key:'orientation', value:w.path.start.x === w.path.end.x ? 'z-axis' : 'x-axis', unit:'text', state:'derived', provenance:'geometry' });
  }
  if (ref.collection === 'openings') {
    const opening = m.openings.find(o => o.id === ref.id)!, wall = m.walls.find(w => w.id === opening.wallId)!;
    p.push({ key:'orientation', value:wall.path.start.x === wall.path.end.x ? 'z-axis' : 'x-axis', unit:'text', state:'derived', provenance:'geometry' });
  }
  if (ref.collection === 'slabs' && source.kind === 'flat-roof') {
    const level = m.levels.find(l => l.id === source.levelId)!;
    p.push({ key:'roofRole', value: level.elevationMm === Math.max(...m.levels.map(l => l.elevationMm)) ? 'top-roof' : 'exposed-lower-roof', unit:'text', state:'derived', provenance:'geometry' });
  }
  if (['walls','openings','slabs','stairs','landings'].includes(ref.collection)) p.push({ key:'engineering', value:null, unit:'not_applicable', state:'not_evaluated', provenance:'unspecified' });
  return p.sort((a,b) => compare(a.key,b.key));
}

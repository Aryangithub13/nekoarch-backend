import { Context } from './context.js';
import { traversable } from './openings.js';
import { compareText } from './report.js';

export function circulationAudit(c: Context): void {
  const graph = c.report.circulation;
  graph.nodes = c.model.spaces.map(s => s.id).sort(compareText);
  for (const o of c.model.openings) {
    const w = c.walls.get(o.wallId), ids = c.openingSpaces.get(o.id) ?? [];
    if (traversable(o) && !c.invalidOpenings.has(o.id) && o.sillMm === 0 && w?.baseOffsetMm === 0 && ids.length === 2) graph.edges.push({ from: ids[0]!, to: ids[1]!, via: o.id, kind: o.kind === 'door' ? 'door' : 'passage' });
  }
  graph.edges.sort((a, b) => compareText(`${a.from}/${a.to}/${a.via}`, `${b.from}/${b.to}/${b.via}`));
  const entrySpaces = [...c.options.entrySpaceIds, ...c.options.rulePacks.flatMap(p => p.entrySpaceIds ?? [])];
  const entryOpenings = [...c.options.entryOpeningIds, ...c.options.rulePacks.flatMap(p => p.entryOpeningIds ?? [])];
  const entries = new Set<string>();
  for (const id of entrySpaces) {
    if (!c.spaces.has(id)) c.add('QA_ENTRY_REFERENCE', 'circulation', [id], 'Caller-supplied entry space does not exist.', 'existing space', id);
    else entries.add(id);
  }
  for (const id of entryOpenings) {
    const o = c.openings.get(id), w = o && c.walls.get(o.wallId), ids = c.openingSpaces.get(id) ?? [];
    if (!o || !w || !traversable(o) || c.invalidOpenings.has(id) || o.sillMm !== 0 || w.baseOffsetMm !== 0 || ids.length !== 1) c.add('QA_ENTRY_OPENING_INVALID', 'circulation', [id], 'Entry opening must be a valid floor-level door/passage adjoining exactly one modeled space.', 'one-sided traversable opening', ids);
    else entries.add(ids[0]!);
  }
  graph.entrySpaceIds = [...entries].sort(compareText);
  if (!entries.size) {
    c.add('QA_ENTRANCE_NOT_SPECIFIED', 'circulation', [], 'No valid entrance policy is available; reachability was not evaluated.', 'explicit entrySpaceIds or entryOpeningIds', null, {}, c.options.requireReachability ? 'ERROR' : 'WARNING');
    c.partial('circulation', 'Entrance-connected reachability not evaluated');
    return;
  }
  graph.evaluated = true;
  const adjacency = new Map(graph.nodes.map(id => [id, [] as string[]]));
  for (const e of graph.edges) { adjacency.get(e.from)?.push(e.to); adjacency.get(e.to)?.push(e.from); }
  const reached = new Set(entries), queue = [...entries];
  for (let i = 0; i < queue.length; i++) for (const next of adjacency.get(queue[i]!) ?? []) {
    if (!reached.has(next)) { reached.add(next); queue.push(next); }
  }
  graph.reachableSpaceIds = [...reached].sort(compareText);
  graph.unreachableSpaceIds = graph.nodes.filter(id => !reached.has(id));
  if (c.options.requireReachability) {
    const selected = c.model.spaces.filter(s => !c.options.occupiedSpacesOnly || (s.occupancy !== undefined && s.occupancy > 0));
    if (c.options.occupiedSpacesOnly && c.model.spaces.some(s => s.occupancy === undefined)) c.add('QA_OCCUPANCY_NOT_EVALUATED', 'coverage', [], 'Some spaces lack occupancy; occupied-only reachability does not classify them as empty.', 'explicit occupancy', null, {}, 'WARNING');
    const required = new Set(selected.map(s => s.id));
    for (const id of graph.unreachableSpaceIds.filter(id => required.has(id))) c.add('QA_UNREACHABLE_SPACE', 'circulation', [id], 'Space has no entrance-connected path through valid doors, passages and stairs.', 'reachable from declared entries', 'unreachable', { entrySpaceIds: graph.entrySpaceIds });
    for (const level of c.model.levels) {
      const spaces = selected.filter(s => s.levelId === level.id);
      if (spaces.length && spaces.every(s => !reached.has(s.id))) c.add('QA_DISCONNECTED_LEVEL', 'circulation', [level.id], 'No required space on this level is connected to a declared entrance.', 'entrance-connected level', 'disconnected');
    }
  }
}

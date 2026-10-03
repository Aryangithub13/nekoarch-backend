import type { BlueprintV2Requirements } from '@designflow/generator';
export const rectangleSite = (width = 12000, depth = 16000) => [{ x: 0, z: 0 }, { x: width, z: 0 }, { x: width, z: depth }, { x: 0, z: depth }];
export const lSite = [{ x: 0, z: 0 }, { x: 16000, z: 0 }, { x: 16000, z: 8000 }, { x: 10000, z: 8000 }, { x: 10000, z: 18000 }, { x: 0, z: 18000 }];
export const uSite = [{ x: 0, z: 0 }, { x: 18000, z: 0 }, { x: 18000, z: 18000 }, { x: 12000, z: 18000 }, { x: 12000, z: 8000 }, { x: 6000, z: 8000 }, { x: 6000, z: 18000 }, { x: 0, z: 18000 }];
export function solverInput(overrides: Partial<BlueprintV2Requirements> = {}): BlueprintV2Requirements {
  return { site: { boundary: rectangleSite(), northMilliDegrees: 0 }, rooms: [
    { type: 'bedroom', count: 2 }, { type: 'living', count: 1 }, { type: 'kitchen', count: 1 }, { type: 'bathroom', count: 1 },
  ], seed: 'phase19-acceptance', layoutV2: {}, ...overrides };
}
export const relationshipInput = () => solverInput({ rooms: [{ type: 'living', count: 1 }, { type: 'dining', count: 1 }, { type: 'kitchen', count: 1 }, { type: 'bedroom', count: 1 }], relationships: [
  { from: { type: 'living' }, to: { type: 'dining' }, kind: 'connected', strength: 'hard' },
  { from: { type: 'dining' }, to: { type: 'kitchen' }, kind: 'passage', strength: 'hard' },
], solver: { maxCandidates: 128 } });

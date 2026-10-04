import type { ParametricRequirements } from '@designflow/generator';
export function parametricInput(twoFloors = false): ParametricRequirements {
  return { site: { boundary: [{ x: 0, z: 0 }, { x: 22000, z: 0 }, { x: 22000, z: 22000 }, { x: 0, z: 22000 }], northMilliDegrees: 0 },
    floors: twoFloors ? 2 : 1,
    rooms: twoFloors ? [{ type: 'bedroom', count: 2, level: 1 }, { type: 'living', count: 1, level: 0 }, { type: 'kitchen', count: 1, level: 0 }] : [{ type: 'bedroom', count: 2 }, { type: 'living', count: 1 }, { type: 'kitchen', count: 1 }],
    seed: 'phase22', parametricArchitecture: { version: 1, shape: 'L', origin: { x: 1000, z: 1000 }, floors: [
      { level: 0, widthMm: 18000, depthMm: 18000, westWingWidthMm: 9000, southWingDepthMm: 8000 },
      ...(twoFloors ? [{ level: 1 as const, widthMm: 16000, depthMm: 16000, westWingWidthMm: 8500, southWingDepthMm: 7000 }] : []),
    ] } };
}

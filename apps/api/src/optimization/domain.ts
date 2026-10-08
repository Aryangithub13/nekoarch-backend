import { costHash } from '@designflow/boq-cost';
import type { ParametricArchitecture } from '@designflow/shared';
import { OPTIMIZATION_CANDIDATE_VERSION, OPTIMIZATION_LIMITS, OptimizationError, PARAMETERS, SLOT_COUNT, slotOf, type OptimizationInput, type Variable } from './contracts.js';

/** Full 8-slot parameter vector (L0 then L1, PARAMETERS order); absent level-1 slots are null. */
export type Vector = (number | null)[];
export interface CandidateBinding { projectId: string; sourceRevisionId: string; sourceModelHash: string; generatorVersion: string; seed: string }

export function domainValues(v: Variable): number[] {
  const d = v.domain;
  if (d.kind === 'VALUES') return [...d.valuesMm];
  return Array.from({ length: (d.maximumMm - d.minimumMm) / d.stepMm + 1 }, (_, i) => d.minimumMm + i * d.stepMm);
}
/** Exact product of domain cardinalities; never a float. */
export const candidateSpaceSize = (variables: Variable[]) => variables.reduce((n, v) => n * BigInt(domainValues(v).length), 1n);

export function preflightSpace(input: OptimizationInput): bigint {
  const size = candidateSpaceSize(input.variables);
  if (input.strategy.kind === 'GRID' && size > BigInt(OPTIMIZATION_LIMITS.maxGridCandidates))
    throw new OptimizationError('OPTIMIZATION_RESOURCE_LIMIT', 'Declared GRID search space exceeds the candidate limit',
      { limit: 'candidateSpaceSize', value: size.toString(), max: String(OPTIMIZATION_LIMITS.maxGridCandidates) });
  return size;
}

export function vectorOf(p: ParametricArchitecture): Vector {
  const v: Vector = Array(SLOT_COUNT).fill(null);
  for (const f of p.floors) for (const parameter of PARAMETERS) v[slotOf(f.level, parameter)] = f[parameter];
  return v;
}
/** Canonical order: lexicographic over the 8 slots, null first. */
export function compareVectors(a: Vector, b: Vector): number {
  for (let i = 0; i < SLOT_COUNT; i++) {
    const x = a[i] ?? null, y = b[i] ?? null;
    if (x === y) continue;
    if (x === null) return -1;
    if (y === null) return 1;
    return x - y;
  }
  return 0;
}
export const vectorKey = (v: Vector) => v.map(x => x ?? '-').join(',');

const slot = (v: Variable) => slotOf(v.target.level, v.target.parameter);
export function withValues(base: Vector, variables: Variable[], values: number[]): Vector {
  const v = [...base];
  variables.forEach((variable, i) => { v[slot(variable)] = values[i]!; });
  return v;
}
export function gridVectors(variables: Variable[], base: Vector): Vector[] {
  const domains = variables.map(domainValues), out: Vector[] = [];
  const walk = (i: number, values: number[]): void => {
    if (i === domains.length) { out.push(withValues(base, variables, values)); return; }
    for (const x of domains[i]!) walk(i + 1, [...values, x]);
  };
  walk(0, []);
  return out.sort(compareVectors);
}
export const inDomain = (variables: Variable[], v: Vector) => variables.every(x => domainValues(x).includes(v[slot(x)]!));
/** ±1 domain-index moves per variable, canonical order. */
export function neighbours(variables: Variable[], current: Vector): Vector[] {
  const out: Vector[] = [];
  for (const x of variables) {
    const values = domainValues(x), i = values.indexOf(current[slot(x)]!);
    for (const j of [i - 1, i + 1]) if (j >= 0 && j < values.length) { const v = [...current]; v[slot(x)] = values[j]!; out.push(v); }
  }
  return out.sort(compareVectors);
}

export function architectureFor(base: ParametricArchitecture, v: Vector): ParametricArchitecture {
  return { ...base, origin: { ...base.origin }, floors: base.floors.map(f => {
    const g = { ...f };
    for (const parameter of PARAMETERS) g[parameter] = v[slotOf(f.level, parameter)]!;
    return g;
  }) };
}
export const assignmentOf = (variables: Variable[], v: Vector) => Object.fromEntries(variables.map(x => [x.variableId, v[slot(x)]!]));
/** Changed slots only; must be applied atomically (intermediate single edits may be invalid L shapes). */
export function adoptionEdits(base: Vector, v: Vector) {
  const edits: { level: 0 | 1; parameter: typeof PARAMETERS[number]; valueMm: number }[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) if (v[i] !== base[i] && v[i] !== null)
    edits.push({ level: i < 4 ? 0 : 1, parameter: PARAMETERS[i % 4]!, valueMm: v[i]! });
  return edits;
}
export const candidateId = (binding: CandidateBinding, v: Vector) =>
  costHash({ version: OPTIMIZATION_CANDIDATE_VERSION, ...binding, parameters: v });

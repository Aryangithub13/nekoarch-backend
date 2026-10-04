import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { generateBlueprint, generateBlueprintV2, BlueprintError, type BlueprintV2Requirements } from '@designflow/generator';
import { auditBlueprint } from '@designflow/blueprint-qa';
import { modelHash } from '../apps/api/src/lib/generation-identity.js';
import { solverV2QaOptions } from '../apps/api/src/services/solver-v2-qa.js';
import { normalizeBlueprintV2Requirements } from '@designflow/generator';
import { solverInput, rectangleSite, lSite, uSite, relationshipInput } from '../test-support/solver-v2-fixtures.js';

const cases: { name: string; input: BlueprintV2Requirements; compareV1: boolean }[] = [
  ...[1, 2, 3].map(bedrooms => ({ name: `${bedrooms}BHK`, input: solverInput({ rooms: [{ type: 'bedroom' as const, count: bedrooms }, { type: 'living' as const, count: 1 }, { type: 'kitchen' as const, count: 1 }, { type: 'bathroom' as const, count: 1 }] }), compareV1: true })),
  { name: '24-rooms', input: solverInput({ site: { boundary: rectangleSite(60000, 60000), northMilliDegrees: 0 }, rooms: [{ type: 'bedroom', count: 20 }, { type: 'bathroom', count: 2 }, { type: 'kitchen', count: 1 }, { type: 'living', count: 1 }] }), compareV1: true },
  { name: 'two-floor', input: solverInput({ floors: 2 }), compareV1: true },
  { name: 'L-site', input: solverInput({ site: { boundary: lSite, northMilliDegrees: 0 } }), compareV1: false },
  { name: 'U-site', input: solverInput({ site: { boundary: uSite, northMilliDegrees: 0 } }), compareV1: false },
  { name: 'relationship-chain', input: relationshipInput(), compareV1: true },
  { name: 'dense-infeasible-graph', input: solverInput({ rooms: [{ type: 'bedroom', count: 5 }], relationships: Array.from({ length: 5 }, (_, i) => Array.from({ length: i }, (_, j) => ({ from: { type: 'bedroom' as const, ordinal: i + 1 }, to: { type: 'bedroom' as const, ordinal: j + 1 }, kind: 'connected' as const, strength: 'hard' as const }))).flat(), solver: { maxCandidates: 128 } }), compareV1: true },
  { name: 'infeasible-area', input: solverInput({ site: { boundary: rectangleSite(2500, 2500), northMilliDegrees: 0 } }), compareV1: true },
  { name: 'candidate-limit', input: solverInput({ solver: { maxCandidates: 128 } }), compareV1: true },
];
const measurements = [];
for (const sample of cases) {
  const versions = sample.compareV1 ? ['v1', 'v2'] as const : ['v2'] as const;
  for (const version of versions) {
    const runs = [];
    for (let repeat = 0; repeat < 3; repeat++) {
      const start = performance.now();
      try {
        const { layoutV2: _v2, ...legacy } = sample.input;
        const result = version === 'v2' ? generateBlueprintV2(sample.input) : generateBlueprint(legacy);
        const solverMs = performance.now() - start, qaStart = performance.now();
        const qa = auditBlueprint(result.model, { requireReachability: true, entryOpeningIds: result.model.openings.filter(o => o.kind === 'door' && o.levelId === 'level-0' && result.model.walls.some(w => w.id === o.wallId && w.classification === 'exterior')).map(o => o.id), ...(version === 'v2' ? solverV2QaOptions(normalizeBlueprintV2Requirements(sample.input)) : {}) });
        runs.push({ solverMs, qaMs: performance.now() - qaStart, hash: modelHash(result.model), qa: qa.status, candidates: result.metadata.candidateAttempts, operations: result.metadata.iterations, validCandidates: result.metadata.validCandidates, rejectedCandidates: result.metadata.candidateAttempts - result.metadata.validCandidates, searchComplete: result.metadata.searchComplete, candidateBudgetUtilization: result.metadata.candidateAttempts / (sample.input.solver?.maxCandidates ?? 32), operationBudgetUtilization: result.metadata.iterations / (sample.input.solver?.maxIterations ?? 20000), processPeakRssKiB: process.resourceUsage().maxRSS });
      } catch (error) {
        if (!(error instanceof BlueprintError)) throw error;
        runs.push({ solverMs: performance.now() - start, failure: error.code, diagnostics: error.diagnostics, processPeakRssKiB: process.resourceUsage().maxRSS });
      }
    }
    const signatures = runs.map(r => 'hash' in r ? r.hash : JSON.stringify({ failure: r.failure, diagnostics: r.diagnostics }));
    measurements.push({ name: sample.name, version, deterministic: signatures.every(s => s === signatures[0]), runs });
  }
}
const outputPath = process.env.PHASE19_PERFORMANCE_PATH ?? 'docs/phase19-evidence/resume/performance.json';
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify({ capturedAt: new Date().toISOString(), node: process.version, platform: process.platform, repeats: 3, notes: ['Sequential measurements; timing is observational and not authoritative.', 'processPeakRssKiB is the cumulative process high-water mark, not isolated per-case allocation.', 'V1 iterations and V2 charged operations use different accounting; they are not directly comparable.', 'Inscribed envelopes only; no global optimality claim.'], measurements }, null, 2) + '\n');
process.stdout.write(`Recorded ${measurements.length} engine/case groups with three repeats each.\n`);

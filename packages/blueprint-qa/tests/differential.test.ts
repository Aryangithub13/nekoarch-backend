import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { generateBlueprint } from '@designflow/generator';
import { BuildingModelV2Schema, dimensionMeasurements, grossFloorAreaMm2, polygonAreaMm2, segmentLengthMm } from '@designflow/shared';
import { auditBlueprint } from '../src/index.js';
import { freeze, generatorOptions, rect, requirements } from './fixtures.js';
import fixtures from '../../generator/tests/fixtures/blueprint/cases.json' with { type: 'json' };

describe('Phase 10 producer differential corpus', () => {
  for (const f of fixtures.filter(f => !f.failure)) it(`golden ${f.name}`, () => {
    const input = requirements(f.floors as 1 | 2, f.seed); input.site.boundary = rect(0, 0, f.width, f.depth); input.rooms[0]!.count = f.bedrooms; input.solver = { maxCandidates: 128 };
    const { model, metadata } = generateBlueprint(input), r = auditBlueprint(freeze(model), generatorOptions);
    expect(r.status).toBe('PASS'); expect(r.findings).toEqual([]);
    for (const d of model.dimensions) {
      const measured = r.measurements.dimensions.find(x => x.entityId === d.id)!;
      expect({ overallMm: measured.overallMm, segmentsMm: measured.segmentsMm }).toEqual(dimensionMeasurements(model, d));
      if (d.constraint.mode === 'controlling') expect({ overallMm: measured.overallMm, segmentsMm: measured.segmentsMm }).toEqual({ overallMm: d.constraint.overallMm, segmentsMm: d.constraint.segmentsMm });
    }
    expect(r.measurements.grossFloorAreaMm2).toBe(grossFloorAreaMm2(model));
    for (const s of model.spaces) expect(r.measurements.spaces.find(m => m.entityId === s.id)?.areaMm2).toBe(polygonAreaMm2(s.boundary));
    for (const w of model.walls) expect(r.measurements.walls.find(m => m.entityId === w.id)?.lengthMm).toBe(segmentLengthMm(w.path));
    expect(r.circulation.reachableSpaceIds).toEqual(metadata.circulation.reachableSpaceIds);
    expect(r.measurements.levels.reduce((sum, l) => sum + BigInt(l.envelopeAreaMm2), 0n)).toBe(BigInt(metadata.utilization.totalEnvelopeAreaMm2));
  });
  for (let seed = 0; seed < 48; seed++) it(`fixed supported corpus seed ${seed}`, () => {
    const input = requirements(seed % 2 ? 2 : 1, `qa-property-${seed}`);
    input.site.boundary = rect(-2500 + seed, 700 + seed, 12000 + seed * 3, 14000 + seed * 7);
    input.rooms[0]!.count = 1 + seed % 4;
    input.exteriorWallThicknessMm = 200 + 2 * (seed % 3); input.interiorWallThicknessMm = 100 + 2 * (seed % 4);
    input.floorToFloorHeightMm = 3000 + seed; input.windows = { enabled: seed % 3 !== 0 };
    const { model } = generateBlueprint(input);
    expect(BuildingModelV2Schema.safeParse(model).success).toBe(true);
    const report = auditBlueprint(freeze(model), generatorOptions);
    expect(report.findings).toEqual([]); expect(report.status).toBe('PASS'); expect(report.circulation.reachableSpaceIds).toHaveLength(model.spaces.length);
  });
  it('large supported Phase 10 plan completes within the deterministic work budget', () => {
    const input = requirements(2, 'large'); input.site.boundary = rect(0, 0, 60000, 60000); input.rooms = [{ type: 'bedroom', count: 24 }];
    const r = auditBlueprint(generateBlueprint(input).model, generatorOptions); expect(r.status).toBe('PASS'); expect(r.measurements.spaces).toHaveLength(28);
  });
  it('generator diagnostics cannot alter the audited document result', () => {
    const result = generateBlueprint(requirements(2)); const before = auditBlueprint(result.model, generatorOptions);
    result.metadata.circulation.reachableSpaceIds = []; result.metadata.circulation.unreachableSpaceIds = result.model.spaces.map(s => s.id);
    result.metadata.utilization.totalEnvelopeAreaMm2 = 1;
    expect(auditBlueprint(result.model, generatorOptions)).toEqual(before);
  });
  it('audits all authored Phase 9 fixture documents through the public boundary', () => {
    const dir = new URL('../../shared/tests/fixtures/building-v2/', import.meta.url);
    for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
      const value: unknown = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
      const result = auditBlueprint(value); expect(result.qaVersion).toBe('blueprint-qa-v1');
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    }
  });
  it('actual concurrent workers produce identical compiled-package reports', async () => {
    const model = generateBlueprint(requirements(2)).model;
    const run = () => new Promise<unknown>((resolve, reject) => {
      const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads'); import('@designflow/blueprint-qa').then(({auditBlueprint}) => parentPort.postMessage(auditBlueprint(workerData.model, workerData.options)));`, { eval: true, workerData: { model, options: generatorOptions } });
      worker.once('message', resolve); worker.once('error', reject); worker.once('exit', code => { if (code !== 0) reject(new Error(`Worker exit ${code}`)); });
    });
    const reports = await Promise.all([run(), run(), run()]); expect(reports[0]).toEqual(reports[1]); expect(reports[1]).toEqual(reports[2]); expect(reports[0]).toEqual(auditBlueprint(model, generatorOptions));
  });
});

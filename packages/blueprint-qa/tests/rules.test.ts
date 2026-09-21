import { describe, expect, it } from 'vitest';
import { auditBlueprint, PRODUCT_DEFAULTS_RULE_PACK, type ArchitecturalRule, type ArchitecturalRulePack } from '../src/index.js';
import { authored, authoredOptions, generated, generatorOptions, rect } from './fixtures.js';
const base = { id: 'test-rule', version: '1', severity: 'WARNING' as const };
const pack = (rule: ArchitecturalRule): ArchitecturalRulePack => ({ id: 'custom', version: '3', description: 'Caller policy; not law', rules: [rule] });
describe('policy separate from core integrity', () => {
  it('product-defaults demonstration is opt-in, versioned and passes generated plans', () => {
    const r = auditBlueprint(generated(2), { ...generatorOptions, rulePacks: [PRODUCT_DEFAULTS_RULE_PACK] });
    expect(r.status).toBe('PASS'); expect(r.ruleResults.every(result => result.outcome === 'PASS')).toBe(true); expect(r.rulePacks).toEqual([{ id: 'designflow-product-defaults', version: '1' }]);
  });
  it('minimum door width can warn without failing core geometry', () => {
    const r = auditBlueprint(authored(), { ...authoredOptions, rulePacks: [pack({ ...base, kind: 'minimum-door-width', minimumMm: 1000 })] });
    expect(r.status).toBe('PASS_WITH_WARNINGS'); expect(r.summary.errors).toBe(0); expect(r.ruleResults.every(x => x.outcome === 'FAIL')).toBe(true); expect(r.findings.every(f => f.category === 'policy')).toBe(true);
  });
  it('policy ERROR determines overall FAIL', () => {
    const r = auditBlueprint(authored(), { ...authoredOptions, rulePacks: [pack({ ...base, severity: 'ERROR', kind: 'minimum-door-width', minimumMm: 1000 })] }); expect(r.status).toBe('FAIL');
  });
  it('no applicable stairs is NOT_APPLICABLE', () => {
    const r = auditBlueprint(authored(), { ...authoredOptions, rulePacks: [pack({ ...base, kind: 'maximum-riser-height', maximumMm: 200 })] }); expect(r.ruleResults[0]!.outcome).toBe('NOT_APPLICABLE');
  });
  it('missing entrance is NOT_EVALUATED, never PASS', () => {
    const r = auditBlueprint(authored(), { rulePacks: [pack({ ...base, kind: 'reachable-spaces' })] }); expect(r.ruleResults.every(r => r.outcome === 'NOT_EVALUATED')).toBe(true);
  });
  it('schema failure still identifies every unevaluated selected rule', () => {
    const r = auditBlueprint(null, { rulePacks: [PRODUCT_DEFAULTS_RULE_PACK] }); expect(r.ruleResults).toHaveLength(2); expect(r.ruleResults.every(r => r.outcome === 'NOT_EVALUATED')).toBe(true);
  });
  it('multiple packs preserve independent versions and same-named rule identity', () => {
    const first = pack({ ...base, kind: 'minimum-door-width', minimumMm: 800 }), second = { ...pack({ ...base, kind: 'minimum-door-width', minimumMm: 1000 }), id: 'second', version: '5' };
    const r = auditBlueprint(authored(), { ...authoredOptions, rulePacks: [second, first] });
    expect(r.rulePacks).toEqual([{ id: 'custom', version: '3' }, { id: 'second', version: '5' }]); expect(r.summary.rulePass).toBe(2); expect(r.summary.ruleFail).toBe(2);
  });
  it('rejects duplicate pack IDs rather than merge ambiguous policies', () => {
    const r = auditBlueprint(authored(), { rulePacks: [PRODUCT_DEFAULTS_RULE_PACK, PRODUCT_DEFAULTS_RULE_PACK] }); expect(r.findings[0]?.code).toBe('QA_OPTIONS_INVALID');
  });
  it('rule pack can supply explicit entry semantics', () => {
    const p = { ...pack({ ...base, kind: 'reachable-spaces' }), entryOpeningIds: ['entry-door'] };
    expect(auditBlueprint(authored(), { rulePacks: [p] }).status).toBe('PASS');
  });
  it('window absence fails only an explicitly supplied window policy', () => {
    const m = authored(); m.openings = m.openings.filter(o => o.kind !== 'window');
    expect(auditBlueprint(m, authoredOptions).status).toBe('PASS');
    const r = auditBlueprint(m, { ...authoredOptions, rulePacks: [pack({ ...base, kind: 'required-window', classifications: ['studio'] })] }); expect(r.ruleResults[0]?.outcome).toBe('FAIL');
  });
  it('internal window fails an exterior-window policy using geometric adjacency', () => {
    const m = authored(); const o = m.openings.find(o => o.kind === 'window')!; o.wallId = 'partition'; o.offsetMm = 4000;
    const r = auditBlueprint(m, { ...authoredOptions, rulePacks: [pack({ ...base, kind: 'exterior-windows' })] }); expect(r.ruleResults[0]?.outcome).toBe('FAIL');
  });
  it('centerline room area and rectangular spans use explicit caller minima', () => {
    const p = pack({ ...base, kind: 'minimum-space-area', minimumMm2: 30_000_000 }); p.rules.push({ ...base, id: 'span', kind: 'minimum-space-span', axis: 'x', minimumMm: 4000 });
    const r = auditBlueprint(authored(), { ...authoredOptions, rulePacks: [p] }); expect(r.summary.ruleFail).toBe(4);
  });
  it('nonrectangular space minimum width is NOT_EVALUATED, not bounding-box certification', () => {
    const m = authored(); m.spaces[0]!.boundary = [{ x: 100, z: 100 }, { x: 3900, z: 100 }, { x: 3900, z: 5900 }, { x: 2000, z: 5900 }, { x: 2000, z: 3000 }, { x: 100, z: 3000 }];
    m.walls = []; m.openings = []; m.dimensions = [];
    const r = auditBlueprint(m, { entrySpaceIds: ['foyer'], rulePacks: [pack({ ...base, kind: 'minimum-space-span', axis: 'x', minimumMm: 1000, classifications: ['entry'] })] }); expect(r.ruleResults[0]?.outcome).toBe('NOT_EVALUATED');
  });
  it('column inside a room is allowed until a column-free-space policy applies', () => {
    const m = authored(); m.columns.push({ id: 'column', levelId: 'ground', crossSection: { outer: rect(5000, 1000, 200, 200), voids: [] }, baseOffsetMm: 0, heightMm: 2800 });
    expect(auditBlueprint(m, authoredOptions).status).toBe('PASS');
    const r = auditBlueprint(m, { ...authoredOptions, rulePacks: [pack({ ...base, kind: 'column-free-spaces', classifications: ['studio'] })] }); expect(r.ruleResults[0]?.outcome).toBe('FAIL');
  });
  it('invalid geometry is not reported as a passing rule', () => {
    const m = authored(); m.openings[1]!.offsetMm = 10000;
    const r = auditBlueprint(m, { ...authoredOptions, rulePacks: [pack({ ...base, kind: 'minimum-door-width', minimumMm: 800 })] });
    expect(r.ruleResults.find(r => r.entityIds.includes('studio-door'))?.outcome).toBe('NOT_EVALUATED');
  });
});

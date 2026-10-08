#!/usr/bin/env python3
"""Phase 28 mutation campaign (parallel core). Plants each mutant, runs the optimization suite,
records the failing tests, checks an intended killer failed, restores the file and verifies its sha256.
Usage: python3 docs/phase28/mutation-test.py [M01 M05 ...]   (no args = all)"""
import hashlib, json, subprocess, sys, tempfile, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = 'apps/api/src/optimization/'
OUT = ROOT / 'docs/phase28/evidence/mutation-testing.json'
# (id, plan item, file, find (must be unique), replace, intended killer test-name substring)
MUTANTS = [
    ('M01', 'skip candidate', 'study.ts', 'for (const v of gridVectors(input.variables, base)) evaluate(v);', 'for (const v of gridVectors(input.variables, base).slice(1)) evaluate(v);', 'one variable'),
    ('M02', 'duplicate candidate', 'study.ts', 'const primaries = [...entries.values()].filter(e => !e.primary)', 'const primaries = [...entries.values()].filter(e => e === e)', 'deduplicates by modelHash'),
    ('M03', 'alter candidate identity', 'domain.ts', 'costHash({ version: OPTIMIZATION_CANDIDATE_VERSION, ...binding, parameters: v })', 'costHash({ version: OPTIMIZATION_CANDIDATE_VERSION, ...binding, parameters: v.slice(0, 4) })', 'candidateId is deterministic'),
    ('M04', 'bypass hard constraint', 'rank.ts', "(c.operator === 'LE' ? order <= 0 : order >= 0)", 'true', 'metric bounds pass and fail'),
    ('M05', 'reverse MINIMIZE comparison', 'rank.ts', 'best: max ? hi : lo, worst: max ? lo : hi', 'best: max ? hi : hi, worst: max ? lo : lo', 'MINIMIZE and MAXIMIZE'),
    ('M06', 'reverse MAXIMIZE comparison', 'rank.ts', 'best: max ? hi : lo, worst: max ? lo : hi', 'best: max ? lo : lo, worst: max ? hi : hi', 'MINIMIZE and MAXIMIZE'),
    ('M07', 'corrupt target distance', 'rank.ts', 'abs(sub(metric.value, parseDecimal(o.goal.target)))', 'sub(metric.value, parseDecimal(o.goal.target))', 'TARGET uses'),
    ('M08', 'ignore objective weight', 'rank.ts', 'contribution = div(mul(rat(BigInt(weight)), n), rat(BigInt(total)))',
     'contribution = div(n, rat(BigInt(input.objectives.filter(o => (o.weight ?? 0) > 0).length)))', 'weighted contributions'),
    ('M09', 'alter normalization', 'rank.ts', 'n = div(sub(b.worst!, v), sub(b.worst!, b.best!));', 'n = div(sub(v, b.best!), sub(b.worst!, b.best!));', 'EXPLICIT_BOUNDS clamps'),
    ('M10', 'select dominated Pareto candidate', 'rank.ts', "pareto.flatMap((p, i) => (p.paretoStatus === 'NON_DOMINATED' ? [i] : []))", "pareto.flatMap((p, i) => (p.paretoStatus !== 'NOT_ELIGIBLE' ? [i] : []))", 'dominance: the smallest'),
    ('M11', 'drop non-dominated candidate', 'rank.ts', 'a.every((x, k) => cmp(x, b[k]!) <= 0) && a.some((x, k) => cmp(x, b[k]!) < 0)', 'a.every((x, k) => cmp(x, b[k]!) <= 0)', 'identical objective vectors'),
    ('M12', 'trust invalid geometry (skip schema)', 'candidate.ts', 'const parsed = ArchitecturalBuildingModelV2Schema.safeParse(raw);',
     'const parsed = { success: true, data: raw } as { success: true; data: BuildingModelV2; error?: never } | { success: false; error: { issues: { path: string[]; message: string }[] } };', 'schema-invalid and QA-failing'),
    ('M13', 'skip QA', 'candidate.ts', "if (qaReport.status === 'FAIL' || qaReport.inputStatus !== 'SCHEMA_VALID' || qaReport.summary.errors)", 'if (false)', 'schema-invalid and QA-failing'),
    ('M14', 'ignore unsupported metric', 'study.ts', '(DEFERRED_METRIC_KINDS as readonly string[]).includes(m.kind)', "(DEFERRED_METRIC_KINDS as readonly string[]).includes('NONE')", 'refuses deferred'),
    ('M15', 'treat missing cost as zero', 'candidate.ts', "if (cost.unpricedLines) return incomplete('COST_UNPRICED_LINES');", '', 'never zero'),
    ('M16', 'accept candidate-space overflow', 'domain.ts', "if (input.strategy.kind === 'GRID' && size > BigInt(OPTIMIZATION_LIMITS.maxGridCandidates))", 'if (false)', 'refuses search-space overflow'),
    ('M17', 'alter deterministic ordering', 'domain.ts', '    return x - y;\n', '    return y - x;\n', 'canonical order'),
    ('M18', 'bypass deduplication', 'study.ts', "primary = generated.kind === 'GENERATED' ? byModel.get(generated.modelHash) : undefined;", 'primary = undefined as string | undefined;', 'deduplicates by modelHash'),
    ('M19', 'validator trusts optimizer score', 'validate.ts', 'if (!same(c.objectives, objs) || !same(c.score, ex(score))) fail', 'if (false) fail', 'rejects tampered score'),
    ('M20', 'mutate accepted revision', 'study.ts', '  const baseline = evaluate(base);\n', "  const baseline = evaluate(base);\n  (source.model as { name: string }).name += ' (optimized)';\n", 'never mutates the source'),
    ('M21', 'lose provenance (adoption edits)', 'study.ts', "adoption: { parametricEdits: adoptionEdits(base, e.vector), apply: 'ATOMIC' }", "adoption: { parametricEdits: [], apply: 'ATOMIC' }", 'adoption edits reproduce'),
    ('M22', 'change claims', 'study.ts', "input.strategy.kind === 'GRID' ? 'BEST_IN_EVALUATED_SEARCH_SPACE' : 'BEST_FOUND'", "'BEST_FOUND'", 'claims are fixed'),
]

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def run_suite():
    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f: report = pathlib.Path(f.name)
    subprocess.run(['npx', 'vitest', 'run', 'apps/api/tests/optimization.test.ts', '--reporter=json', f'--outputFile={report}'], cwd=ROOT, capture_output=True, text=True, timeout=900)
    data = json.loads(report.read_text()); report.unlink()
    tests = [t for r in data['testResults'] for t in r['assertionResults']]
    failing = sorted(t['fullName'] for t in tests if t['status'] != 'passed')
    validator = sum(1 for t in tests if any('Independent validation rejected' in m for m in t.get('failureMessages', [])))
    return {'tests': len(tests), 'failed': len(failing), 'failingTests': failing, 'failuresFromIndependentValidator': validator,
            'suiteError': [r.get('message', '')[:300] for r in data['testResults'] if r.get('status') == 'failed' and not r['assertionResults']]}

def main():
    wanted = set(sys.argv[1:])
    results = [{'mutation': 'none (control)', **run_suite()}]
    for mid, plan, file, find, replace, killer in MUTANTS:
        if wanted and mid not in wanted: continue
        path = ROOT / SRC / file; original = path.read_bytes(); digest = sha(path); text = original.decode()
        if text.count(find) != 1: results.append({'id': mid, 'plan': plan, 'error': f'target occurs {text.count(find)} times'}); print(mid, 'TARGET ERROR'); continue
        try:
            path.write_text(text.replace(find, replace)); r = run_suite()
        finally:
            path.write_bytes(original)
        restored = sha(path) == digest
        killed = r['failed'] > 0 or bool(r['suiteError'])
        results.append({'id': mid, 'plan': plan, 'file': SRC + file, 'intendedKiller': killer, 'killed': killed,
                        'killedForIntendedReason': any(killer in t for t in r['failingTests']), 'restored': restored, **r})
        print(mid, plan, 'KILLED' if killed else 'SURVIVED', 'intended' if results[-1]['killedForIntendedReason'] else 'NOT-intended', 'restored' if restored else 'NOT-RESTORED', flush=True)
    results.append({'mutation': 'none (after restore)', **run_suite()})
    OUT.parent.mkdir(parents=True, exist_ok=True); OUT.write_text(json.dumps(results, indent=2) + '\n')
    bad = [r for r in results if 'id' in r and not (r.get('killedForIntendedReason') and r.get('restored'))]
    controls = [r for r in results if 'mutation' in r]
    ok = not bad and all(c['failed'] == 0 for c in controls)
    print(json.dumps({'mutants': len([r for r in results if 'id' in r]), 'problems': [r.get('id') for r in bad], 'controlsPass': all(c['failed'] == 0 for c in controls), 'ok': ok}))
    sys.exit(0 if ok else 1)

if __name__ == '__main__': main()

#!/usr/bin/env python3
"""Phase 28 mutation campaign (core + integration). Plants each mutant, runs its killer suite,
records the failing tests, checks an intended killer failed, restores the file and verifies its sha256.
Usage: python3 docs/phase28/mutation-test.py [M01 M05 ...]   (no args = all)"""
import hashlib, json, subprocess, sys, tempfile, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = 'apps/api/src/optimization/'
OUT = ROOT / 'docs/phase28/evidence/mutation-testing.json'
SUITES = {'core': ['apps/api/tests/optimization.test.ts'],
          'integration': ['apps/api/tests/optimization-pool.test.ts', 'apps/api/tests/optimization.integration.test.ts']}
# (id, plan item, file (relative to SRC, or repo path), find (must be unique), replace, intended killer test-name substring[, suite])
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
    # Integration mutants (§29): worker pool, persistence/RLS (migration 0018), service, validator.
    ('M23', 'worker bypass (study on the request thread)', 'apps/api/src/services/optimization-service.ts', 'try { result = await pool.run(source, input); }',
     "try { result = { ...(await import('../optimization/study.js')).runOptimizationStudy(source, input), queueMs: 0, workerMs: 0, timingsMs: {} } as PoolResult; }", 'crash → 503', 'integration'),
    ('M24', 'queue overflow bypass', 'pool.ts', 'if (!capacity && this.queue.length >= this.options.queueLimit)', 'if (false)', 'bounds the queue', 'integration'),
    ('M25', 'timeout bypass', 'pool.ts', '        this.options.timeoutMs);', '        this.options.timeoutMs * 1000);', 'timed-out study fails', 'integration'),
    ('M26', 'failed worker still yields a result', 'pool.ts', 'this.release(slot)?.reject(error);',
     'this.release(slot)?.resolve({ study: {} as Study, timingsMs: {}, queueMs: 0, workerMs: 0 });', 'crashed or throwing worker', 'integration'),
    ('M27', 'malformed worker study accepted', 'pool.ts', 'const parsed = StudySchema.safeParse(reply.study);',
     'const parsed = { success: true as const, data: reply.study as Study };', 'malformed (forged) study', 'integration'),
    # Dropping only the owner predicate is an EQUIVALENT mutant: revisions_owner_read (0006) already scopes the policy subquery to the owner
    # (RLS applies inside policy subqueries). The predicate stays as defense in depth (as in 0014–0017); the non-equivalent bypass is mutated instead.
    ('M28', 'RLS owner-read bypass (policy opened to every authenticated user)', 'supabase/migrations/0018_optimization_studies.sql',
     "create policy optimization_owner_read on public.project_revision_optimization_studies for select to authenticated using (\n exists",
     "create policy optimization_owner_read on public.project_revision_optimization_studies for select to authenticated using (\n true or exists", 'foreign/anonymous reads', 'integration'),
    ('M29', 'write binding bypass (seed)', 'supabase/migrations/0018_optimization_studies.sql', " and snap->'binding'->>'seed'=r.normalized_requirements->>'seed'",
     ' and true', 'rejects forged binding', 'integration'),
    ('M30', 'result-hash forgery accepted', 'supabase/migrations/0018_optimization_studies.sql', " and snap->>'resultHash'=project_private.cost_hash(snap - 'resultHash')",
     ' and true', 'rejects forged binding', 'integration'),
    ('M31', 'candidate identity recompute bypass', 'supabase/migrations/0018_optimization_studies.sql',
     "   if c->>'candidateId' <> project_private.cost_hash(identity || jsonb_build_object('parameters',c->'parameters')) then", '   if false then', 'rejects forged binding', 'integration'),
    ('M32', 'stale-check bypass', 'apps/api/src/services/optimization-service.ts', "if (requireCurrent && c.status !== 'CURRENT')", 'if (false)', 'studies then become STALE', 'integration'),
    ('M33', 'nondeterministic result accepted for an identical input', 'supabase/migrations/0018_optimization_studies.sql',
     "   if o.result_hash<>snap->>'resultHash' then raise", '   if false then raise', 'refuses a different result', 'integration'),
    ('M34', 'architecture-mutation guard removed', 'supabase/migrations/0018_optimization_studies.sql',
     '   and not jsonb_path_exists(snapshot_json,\'$.candidates[*] ? (@.architectureMutation != "NONE")\')) is true)', '   and true) is true)', 'claim more than the bounded result', 'integration'),
    ('M35', 'validator imports optimizer arithmetic (independence)', 'validate.ts', "import { modelHash } from '../lib/generation-identity.js';",
     "import { modelHash } from '../lib/generation-identity.js';\nimport { cmp as _cmp } from './rank.js';", 'stays independent', 'core'),
    ('M36', 'validator gate re-derivation bypass', 'validate.ts', 'if (!same(derived, { stage, code: c.rejection!.code, details: c.rejection!.details })) fail', 'if (false) fail', 're-derives every pre-QA', 'core'),
    ('M37', 'malformed input mapped to 422 instead of 400', 'apps/api/src/services/optimization-service.ts', 'OPTIMIZATION_INPUT_INVALID: 400,', 'OPTIMIZATION_INPUT_INVALID: 422,', 'typed refusals', 'integration'),
]

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def run_suite(files=SUITES['core'] + SUITES['integration']):
    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f: report = pathlib.Path(f.name)
    subprocess.run(['npx', 'vitest', 'run', *files, '--reporter=json', f'--outputFile={report}'], cwd=ROOT, capture_output=True, text=True, timeout=900)
    data = json.loads(report.read_text()); report.unlink()
    tests = [t for r in data['testResults'] for t in r['assertionResults']]
    failing = sorted(t['fullName'] for t in tests if t['status'] != 'passed')
    validator = sum(1 for t in tests if any('Independent validation rejected' in m for m in t.get('failureMessages', [])))
    return {'tests': len(tests), 'failed': len(failing), 'failingTests': failing, 'failuresFromIndependentValidator': validator,
            'suiteError': [r.get('message', '')[:300] for r in data['testResults'] if r.get('status') == 'failed' and not r['assertionResults']]}

def main():
    wanted = set(sys.argv[1:])
    results = [{'mutation': 'none (control)', **run_suite()}]
    for mid, plan, file, find, replace, killer, *suite in MUTANTS:
        if wanted and mid not in wanted: continue
        path = ROOT / file if '/' in file else ROOT / SRC / file; original = path.read_bytes(); digest = sha(path); text = original.decode()
        if text.count(find) != 1: results.append({'id': mid, 'plan': plan, 'error': f'target occurs {text.count(find)} times'}); print(mid, 'TARGET ERROR'); continue
        try:
            path.write_text(text.replace(find, replace)); r = run_suite(SUITES[suite[0] if suite else 'core'])
        finally:
            path.write_bytes(original)
        restored = sha(path) == digest
        killed = r['failed'] > 0 or bool(r['suiteError'])
        results.append({'id': mid, 'plan': plan, 'file': str(path.relative_to(ROOT)), 'suite': suite[0] if suite else 'core', 'intendedKiller': killer, 'killed': killed,
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

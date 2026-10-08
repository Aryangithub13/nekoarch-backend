"""Phase 27 mutation testing (design §23): plant one defect at a time, run the knowledge suites (or the G-indep gate), require failure
for the intended reason (an expected test or gate fails), and restore every file byte-identically.  `--dry-run` only checks targets."""
import hashlib, json, pathlib, subprocess, sys, tempfile

root = pathlib.Path.cwd()
K = 'apps/api/src/knowledge/'
EVA, FAC, CON, UNI, VAL, PAC, CTR = K + 'evaluate.ts', K + 'facts.ts', K + 'conflicts.ts', K + 'units.ts', K + 'validate.ts', K + 'packs.ts', K + 'contracts.ts'
SVC, SQL = 'apps/api/src/services/knowledge-service.ts', 'supabase/migrations/0017_specialized_knowledge_analyses.sql'
G1, FORGE, TRUTH, LIMITS = 'reproduces the hand-computed table', 'rejects every forgery', 'status algebra', 'resource-limit'
HTTP_G1, PRIM, SQLT, FACTS = 'G1: catalog, validation', 'primitives at their boundaries', 'recomputes revision binding', 'model validator re-derives'
# (id, name, file, old, new, expected failing-test name fragments)
MUTATIONS = [
    ('M01', 'evaluator GTE >= becomes >', EVA, "p.op === 'GTE' ? cmp(v, t) >= 0 : cmp(v, t) <= 0", "p.op === 'GTE' ? cmp(v, t) > 0 : cmp(v, t) <= 0", [G1, PRIM]),
    ('M02', 'evaluator LTE <= becomes <', EVA, "p.op === 'GTE' ? cmp(v, t) >= 0 : cmp(v, t) <= 0", "p.op === 'GTE' ? cmp(v, t) >= 0 : cmp(v, t) < 0", [G1, PRIM]),
    ('M03', 'literal unit conversion skipped', EVA, "const t = toCanonical(parseExact(p.right.decimal), p.right.unit), sym", "const t = parseExact(p.right.decimal), sym", [G1, PRIM]),
    ('M04', 'missing fact treated as pass', EVA, "if (!present || present.value?.kind !== 'DECIMAL') return node('I', 'MISSING_FACT', { observed: f ? observedOf(f) : null, threshold });",
     "if (!present || present.value?.kind !== 'DECIMAL') return node('T', 'MISSING_FACT', { observed: f ? observedOf(f) : null, threshold });", [G1]),
    ('M05', 'NOT_APPLICABLE treated as pass', EVA, "if (app && app.status === 'F') { status = 'NOT_APPLICABLE';", "if (app && app.status === 'F') { status = 'MEETS_RULE';", [G1]),
    ('M06', 'applicability skipped', EVA, "const app = rule.applicability ? predicate(rule.applicability, s, ctx) : null;", "const app: Trace | null = null;", [G1]),
    ('M07', 'one selected rule ignored', EVA, ".sort((a, b) => order(ruleRef(a), ruleRef(b)));\n  const versions", ".sort((a, b) => order(ruleRef(a), ruleRef(b))).slice(0, -1);\n  const versions", [G1, FORGE]),
    ('M08', 'bundled pack checksum altered', PAC, "checksum: 'b79bb8532683625eda9c14be6d82f25c7d6499a1302cbe1aa569d4764b0dcbe8'", "checksum: 'c79bb8532683625eda9c14be6d82f25c7d6499a1302cbe1aa569d4764b0dcbe8'", ['does not match its recorded checksum']),
    ('M09', 'evidence link dropped', EVA, "evidence: observedFacts.map(id => { const f = byId.get(id)!;", "evidence: observedFacts.slice(1).map(id => { const f = byId.get(id)!;", ['explanations, evidence', FORGE]),
    ('M10', 'conflict detection bypassed', CON, "    if (!empty(intersect(x.nf, y.nf))) continue; // NO_CONFLICT", "    if (true) continue; // NO_CONFLICT", [G1]),
    ('M11', 'cross-revision upstream source allowed (SQL)', SQL,
     "select * into y from public.project_revision_building_systems_analyses where id=(snap->'binding'->'systems'->>'analysisId')::uuid and project_revision_id=r.id;",
     "select * into y from public.project_revision_building_systems_analyses where id=(snap->'binding'->'systems'->>'analysisId')::uuid;", [SQLT]),
    ('M12', 'stale check bypassed', SVC, "if (requireCurrent && c.status !== 'CURRENT')", "if (false && requireCurrent && c.status !== 'CURRENT')", ['STALE (never reused)']),
    ('M13', 'evaluator trusted without independent recomputation', VAL,
     "for (const k of ['results', 'conflicts', 'missingInputs', 'unsupported', 'disciplineSummary', 'summary'] as const) diff(",
     "for (const k of [] as ('results')[]) diff(", [FORGE]),
    ('M14', 'exact ratio arithmetic replaced by floats', EVA, "const v = div(n, d), observed = { value: show(v)",
     "const v = parseExact(String(Number(n[0]) * Number(d[1]) / (Number(n[1]) * Number(d[0])))), observed = { value: show(v)", [G1, 'explanations, evidence']),
    ('M15', 'canonical result order lost', EVA, "  results.sort((a, b) => order(a.packId, b.packId) ||", "  results.reverse().slice(0, 0).sort((a, b) => order(a.packId, b.packId) ||", [FORGE, HTTP_G1]),
    ('M16', 'unsupported rule returns success', EVA, "push(null, 'UNSUPPORTED', 'UNSUPPORTED_FACT'); continue;", "push(null, 'MEETS_RULE', 'UNSUPPORTED_FACT'); continue;", [G1]),
    ('M17', 'NOT_CLAIMED claim dropped', CTR, "buildingCodeCompliance: 'NOT_CLAIMED', legalCompliance: 'NOT_CLAIMED',", "buildingCodeCompliance: 'NOT_CLAIMED',", ['every claim NOT_CLAIMED', HTTP_G1]),
    ('M18', 'result budget exceeded without rejection', EVA, "> KNOWLEDGE_LIMITS.subjectResults)", "> Infinity)", [LIMITS]),
    ('M19', 'observed fact value forged', FAC, "emit('SYS_EGRESS_DISTANCE', s, e.distance === null ? null : dec(fromStored(e.distance.value), 'mm')",
     "emit('SYS_EGRESS_DISTANCE', s, e.distance === null ? null : dec(fromStored(e.distance.value + 1), 'mm')", ['extracts typed facts', HTTP_G1]),
    ('M20', 'validator GTE >= becomes >', VAL, "return (c.op === 'GTE' ? s >= 0 : s <= 0) ? 'T' : 'F';", "return (c.op === 'GTE' ? s > 0 : s <= 0) ? 'T' : 'F';", [FORGE, HTTP_G1]),
    ('M21', 'ALL turns an unknown into T', EVA, "T: { T: 'T', F: 'F', R: 'R', I: 'I', E: 'E' }, F: { T: 'F', F: 'F'", "T: { T: 'T', F: 'F', R: 'R', I: 'T', E: 'E' }, F: { T: 'F', F: 'F'", [TRUTH, G1]),
    ('M22', 'NOT(INPUT_INCOMPLETE) becomes T', EVA, "const NOT: Record<Truth, Truth> = { T: 'F', F: 'T', R: 'R', I: 'I', E: 'E' };", "const NOT: Record<Truth, Truth> = { T: 'F', F: 'T', R: 'R', I: 'T', E: 'E' };", [TRUTH, G1]),
    ('M23', 'label near-match silently out of scope', EVA, "return labels.some(l => nearKey(l) === nearKey(label)) ? 'NEAR' : 'OUT';", "return labels.some(l => nearKey(l) === nearKey(label)) ? 'OUT' : 'OUT';", ['Amendment 3']),
    ('M24', 'UPSTREAM_FLOAT provenance mislabelled', FAC, "precision: FACT_CATALOG[factType].precision!, source: { ...source, pointer }",
     "precision: factType === 'SYS_EGRESS_DISTANCE' ? 'EXACT_INTEGER' : FACT_CATALOG[factType].precision!, source: { ...source, pointer }", ['extracts typed facts', HTTP_G1]),
    ('M25', 'validator conflict recomputation skipped', VAL, "    if (!impossible(meet(a.shape!, b.shape!))) continue;", "    if (true) continue;", [FORGE, HTTP_G1]),
    ('M26', 'evaluator decimal parser drops a fractional digit', UNI, "const decimals = m[3] ?? '', exponent", "const decimals = (m[3] ?? '').slice(0, -1), exponent", ['parses, normalises', G1]),
    ('M27', 'SQL pack checksum recompute removed', SQL, "   if (project_private.cost_hash(snap->'packs'->i->'pack') = snap->'packs'->i->>'checksum'\n", "   if (true\n", [SQLT]),
    ('M28', 'validator kW factor wrong', VAL, "W: '1', kW: '1000',", "W: '1', kW: '100',", ['parses, normalises', HTTP_G1]),
    ('M29', 'fact pointer drops the array index', FAC, "emit('ARCH_OPENING_WIDTH', s, dec(int(o.widthMm), 'mm'), arch, `/geometry/openings/${i}/widthMm`);",
     "emit('ARCH_OPENING_WIDTH', s, dec(int(o.widthMm), 'mm'), arch, `/geometry/openings/widthMm`);", [FACTS, HTTP_G1]),
    ('M30', 'float ambiguity check removed', UNI, "return { ambiguous: cmp(diff, band) <= 0,", "return { ambiguous: false,", ['16-ulp ambiguity band', G1]),
    ('M31', 'float ambiguity check reversed', UNI, "return { ambiguous: cmp(diff, band) <= 0,", "return { ambiguous: cmp(diff, band) > 0,", ['16-ulp ambiguity band', G1]),
    ('M32', 'float ambiguity band widened (K=32)', UNI, "mul(q(BigInt(FLOAT_BOUNDARY_ULPS)), spacing)", "mul(q(BigInt(FLOAT_BOUNDARY_ULPS * 2)), spacing)", ['16-ulp ambiguity band', '14.9 and 17.1 ulp']),
    ('M33', 'float ambiguity band narrowed (K=8)', UNI, "mul(q(BigInt(FLOAT_BOUNDARY_ULPS)), spacing)", "mul(q(BigInt(FLOAT_BOUNDARY_ULPS / 2)), spacing)", ['16-ulp ambiguity band', '14.9 and 17.1 ulp']),
    ('M34', 'validator float band removed', VAL, "const ambiguous = sign(gap, band) <= 0;", "const ambiguous = false;", ['14.9 and 17.1 ulp', HTTP_G1]),
    ('M35', 'transitive upstream consistency skipped', SVC, "    checkUpstreamConsistency(binding, up);\n", "    void checkUpstreamConsistency;\n", ['G6–G8']),
    ('M36', 'ANY propagation wrong (R or F = F)', EVA, "R: { T: 'T', F: 'R', R: 'R', I: 'I', E: 'E' },", "R: { T: 'T', F: 'F', R: 'R', I: 'I', E: 'E' },", ['Amendment 1', TRUTH]),
    ('M37', 'validator imports evaluator arithmetic (G-indep)', VAL, "import { createHash } from 'node:crypto';\n", "import { createHash } from 'node:crypto';\nimport { cmp } from './units.js';\nvoid cmp;\n", ['GATE:validator-independence']),
]
SUITES = ['apps/api/tests/knowledge.test.ts', 'apps/api/tests/knowledge.integration.test.ts']

def run_suites():
    with tempfile.NamedTemporaryFile(suffix='.json') as report:
        subprocess.run(['npx', 'vitest', 'run', *SUITES, '--reporter=json', f'--outputFile={report.name}'], cwd=root, capture_output=True, timeout=1800)
        data = json.loads(pathlib.Path(report.name).read_text() or '{}')
    failed = [t['fullName'] for f in data.get('testResults', []) for t in f['assertionResults'] if t['status'] == 'failed']
    # A suite that cannot load (e.g. the registry refusing a tampered checksum) is recorded with its error message.
    suite_errors = [f"SUITE:{f['name']}:{(f.get('message') or '')[:300]}" for f in data.get('testResults', []) if f.get('status') == 'failed' and not f['assertionResults']]
    return data.get('numTotalTests', 0), failed + suite_errors

def run_gate():
    r = subprocess.run(['node', 'docs/phase27/validator-independence.mjs'], cwd=root, capture_output=True, timeout=120)
    return 1, ([] if r.returncode == 0 else ['GATE:validator-independence'])

def main():
    dry = '--dry-run' in sys.argv
    rows, ok = [], True
    for mid, name, rel, old, new, _ in MUTATIONS:
        n = (root / rel).read_text().count(old)
        if n != 1: print(json.dumps({'id': mid, 'error': f'target occurs {n} times'})); ok = False
    if dry: print(json.dumps({'targets': len(MUTATIONS), 'ok': ok})); return 0 if ok else 1
    total, failed = run_suites()
    rows.append({'mutation': 'none (control)', 'tests': total, 'failed': len(failed), 'failingTests': failed}); ok &= total > 0 and not failed
    for mid, name, rel, old, new, expected in MUTATIONS:
        path = root / rel; original = path.read_bytes(); digest = hashlib.sha256(original).hexdigest(); text = original.decode()
        try:
            path.write_text(text.replace(old, new))
            total, failed = run_gate() if expected == ['GATE:validator-independence'] else run_suites()
        finally:
            path.write_bytes(original)
        restored = hashlib.sha256(path.read_bytes()).hexdigest() == digest
        reason = any(any(e in f for e in expected) for f in failed)
        rows.append({'id': mid, 'mutation': name, 'file': rel, 'tests': total, 'failed': len(failed), 'killed': bool(failed), 'killedForReason': reason,
                     'expected': expected, 'restored': restored, 'failingTests': failed[:12]})
        ok &= bool(failed) and reason and restored
        print(json.dumps(rows[-1])[:500], flush=True)
    total, failed = run_suites(); rows.append({'mutation': 'none (after restore)', 'tests': total, 'failed': len(failed), 'failingTests': failed}); ok &= not failed
    out = root / 'docs/phase27/evidence'; out.mkdir(parents=True, exist_ok=True)
    (out / 'mutation-testing.json').write_text(json.dumps(rows, indent=2) + '\n')
    print(json.dumps({'killedForReason': sum(1 for r in rows if r.get('killedForReason')), 'mutations': len(MUTATIONS), 'ok': ok}))
    return 0 if ok else 1

if __name__ == '__main__': sys.exit(main())

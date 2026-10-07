"""Audit-repair mutation testing: plant one defect at a time, run the structural suites, require failures, restore byte-identically."""
import hashlib, json, pathlib, subprocess, sys, tempfile

root = pathlib.Path.cwd()
V, M, A, S = 'apps/api/src/structural/validate.ts', 'apps/api/src/structural/model.ts', 'apps/api/src/structural/analysis.ts', 'apps/api/src/structural/frame-solver.ts'
MUTATIONS = [
    ('A01 fabricated displacement: translation relations dropped', V, 'if (relations.some(', 'if (relations.filter((_, i) => i !== 0 && i !== 3 && i !== 5).some('),
    ('A01 fabricated rotation: rotation relations dropped', V, 'if (relations.some(', 'if (relations.filter((_, i) => i !== 1 && i !== 2 && i !== 4).some('),
    ('A01 fabricated endpoint force: raw J-end statics removed', A, 'if (forces.some(r => !(Math.abs(r) <= 1e-6 * fScale))', 'if (false && forces.some(r => !(Math.abs(r) <= 1e-6 * fScale))'),
    ('A01 reaction on unrestrained DOF accepted', V, 'if (s && DOF.some(', 'if (false && s && DOF.some('),
    ('A01 combination superposition removed', V, "if (!ok) error('COMBINATION'", "if (false) error('COMBINATION'"),
    ('A02 fabricated interior stations: only end stations checked', V, 'for (const st of mf.stations) {', 'for (const st of [s0, s1]) {'),
    ('A02 wrong force curve in production result recovery', A, 'q[1] * x * x / 2) };', 'q[1] * x * x / 3) };'),
    ('A03 missing crossing connection: builder accepts unconnected crossing', M, "&& !nodes.has(`${at.x},${at.y},${at.z}`))", "&& false)"),
    ('A03 missing crossing connection: validator crossing check removed', V, 'if (p.k !== q.k && within(p, alongP)', 'if (false && p.k !== q.k && within(p, alongP)'),
    ('A03 fabricated crossing connection: builder silently inserts a joint', M,
     "fail('STRUCTURAL_MODEL_INVALID', 'Members cross without a shared node; split a wall at the crossing to connect them, or map only one of them');",
     "nodes.set(`${at.x},${at.y},${at.z}`, { point: at, memberIds: new Set() });"),
    ('A04 valid fully restrained system rejected again', S, '  // n === 0 is a fully restrained system',
     "  if (n === 0) throw new StructuralError('STRUCTURAL_SUPPORT_INVALID', 'Every degree of freedom is restrained');\n  // n === 0 is a fully restrained system"),
    ('A05 derived resource expansion not preflighted', M, 'if (expanded > EXPANDED_MEMBER_LOADS)', 'if (false && expanded > EXPANDED_MEMBER_LOADS)'),
    ('A06 contradictory mass status accepted', V, ": mm.quantities.mass.status !== 'EVALUATED' || !close(", ': !close('),
    ('A06 contradictory section description accepted', V,
     "\n      || props.some((p, i) => p.method !== want.methods[i]) || x.shape !== is.shape || x.requestKey !== is.key\n"
     "      || (want.dims ? x.dimensions?.width.value !== want.dims[0] || x.dimensions?.depth.value !== want.dims[1] : x.dimensions !== null))", ')'),
]
SUITES = ['apps/api/tests/structural.test.ts', 'apps/api/tests/structural.integration.test.ts']

def run_suites():
    with tempfile.NamedTemporaryFile(suffix='.json') as report:
        subprocess.run(['npx', 'vitest', 'run', *SUITES, '--reporter=json', f'--outputFile={report.name}'], cwd=root, capture_output=True, timeout=1200)
        data = json.loads(pathlib.Path(report.name).read_text() or '{}')
    failed = [t['fullName'] for f in data.get('testResults', []) for t in f['assertionResults'] if t['status'] == 'failed']
    return data.get('numTotalTests', 0), failed

def main():
    rows, ok = [], True
    total, failed = run_suites()
    rows.append({'mutation': 'none (control)', 'tests': total, 'failed': len(failed)}); ok &= total > 0 and not failed
    for name, rel, old, new in MUTATIONS:
        path = root / rel; original = path.read_bytes(); digest = hashlib.sha256(original).hexdigest(); text = original.decode()
        if text.count(old) != 1: rows.append({'mutation': name, 'error': f'target occurs {text.count(old)} times'}); ok = False; continue
        try:
            path.write_text(text.replace(old, new)); total, failed = run_suites()
        finally:
            path.write_bytes(original)
        restored = hashlib.sha256(path.read_bytes()).hexdigest() == digest
        rows.append({'mutation': name, 'file': rel, 'tests': total, 'failed': len(failed), 'killed': bool(failed), 'restored': restored, 'failingTests': failed[:12]})
        ok &= bool(failed) and restored
        print(json.dumps(rows[-1])[:400], flush=True)
    out = root / 'docs/phase24-audit-repair/evidence'; out.mkdir(parents=True, exist_ok=True)
    total, failed = run_suites(); rows.append({'mutation': 'none (after restore)', 'tests': total, 'failed': len(failed)}); ok &= not failed
    (out / 'mutation-testing.json').write_text(json.dumps(rows, indent=2) + '\n')
    print(json.dumps({'killed': sum(1 for r in rows if r.get('killed')), 'mutations': len(MUTATIONS), 'ok': ok}))
    return 0 if ok else 1

if __name__ == '__main__': sys.exit(main())

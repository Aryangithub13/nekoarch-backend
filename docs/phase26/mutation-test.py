"""Phase 26 mutation testing: plant one defect at a time, run the building-systems suites, require failures, restore byte-identically."""
import hashlib, json, pathlib, subprocess, sys, tempfile

root = pathlib.Path.cwd()
S = 'apps/api/src/systems/'
ROU, ANA, EGR, CLA, VER, VAL, MOD, SVC = S + 'routing.ts', S + 'analysis.ts', S + 'egress.ts', S + 'clash.ts', S + 'vertical.ts', S + 'validate.ts', S + 'model.ts', 'apps/api/src/services/systems-service.ts'
MUTATIONS = [
    ('reversed plumbing slope', ROU, "return e.get(u)! - BigInt(Math.abs(a.x - b.x) + Math.abs(a.z - b.z)) * S;", "return e.get(u)! + BigInt(Math.abs(a.x - b.x) + Math.abs(a.z - b.z)) * S;"),
    ('validator uphill check disabled', VAL, "if (q.y > a.y + TOL) fail('SLOPE'", "if (false) fail('SLOPE'"),
    ('omitted terminal', ROU, "  for (const t of members) {", "  for (const t of members.slice(1)) {"),
    ('disconnected route accepted', VAL, "if (bi === 0 ? !atRoot : !atRoot && !joined) fail('ROUTE'", "if (false) fail('ROUTE'"),
    ('wrong electrical load sum', ANA, "  for (const l of group) {", "  for (const l of group.slice(1)) {"),
    ('demand factor ignored', ANA, "const d = mul(p, fromNumber(l.demandFactor));", "const d = p;"),
    ('wrong Q/A airflow velocity', ROU, "rational(BigInt(size.widthMm * size.heightMm), 1_000_000n)", "rational(BigInt(size.widthMm * size.heightMm), 1_000n)"),
    ('unit factor error (L/s to m3/s)', ROU, "div(fromNumber(value), rational(1000n))", "div(fromNumber(value), rational(100n))"),
    ('egress edge removed', EGR, "  for (const o of openings) if (o.spaceIds.length === 2)", "  for (const o of openings.slice(1)) if (o.spaceIds.length === 2)"),
    ('stale result served current', SVC, "if (requireCurrent && c.status !== 'CURRENT')", "if (false && requireCurrent && c.status !== 'CURRENT')"),
    ('structural clash ignored', CLA, "if (o.kind === 'STRUCTURE') physicalOrClearance(", "if (o.kind === 'STRUCTURE') void ("),
    ('shaft vertical misalignment accepted', VER, "const inside = levels.every(l => ringContains(l.boundary, ringOf(rect)));", "const inside = levels.slice(0, 1).every(l => ringContains(l.boundary, ringOf(rect)));"),
    ('router clearance ignored', ROU, "const pad = sp + Math.max(c, s.clearance);", "const pad = sp;"),
    ('wall penetration not proposed', ROU, "if (Math.min(a.y, p.y) - sv < w.topY && Math.max(a.y, p.y) + sv > w.bottomY) add('walls'", "if (false) add('walls'"),
    ('structural envelope halved', MOD, "halfSizeMm: d ? Math.max(d.width.value, d.depth.value) / 2 : null,", "halfSizeMm: d ? Math.max(d.width.value, d.depth.value) / 4 : null,"),
    ('validator clash recomputation disabled', VAL, "if (digest(expectedClashes) !== digest(co.clashes) || co.blocking !== expectedClashes.filter(c => c.severity === 'BLOCKING').length) fail('CLASH'", "if (false) fail('CLASH'"),
    ('validator egress recomputation disabled', VAL, "if (rep.distance?.value !== far / 2 || remote === undefined || dist[remote] !== far) fail('EGRESS'", "if (false) fail('EGRESS'"),
    ('validator electrical recomputation disabled', VAL, "if (!el.total || digest(seen(el.total)) !== digest(sum(e.loads.map(l => l.key))))", "if (false)"),
    ('validator penetration recomputation disabled', VAL, "if (digest(pens) !== digest(r.coordination.penetrations))", "if (false)"),
]
SUITES = ['apps/api/tests/systems.test.ts', 'apps/api/tests/systems.integration.test.ts']

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
    out = root / 'docs/phase26/evidence'; out.mkdir(parents=True, exist_ok=True)
    total, failed = run_suites(); rows.append({'mutation': 'none (after restore)', 'tests': total, 'failed': len(failed)}); ok &= not failed
    (out / 'mutation-testing.json').write_text(json.dumps(rows, indent=2) + '\n')
    print(json.dumps({'killed': sum(1 for r in rows if r.get('killed')), 'mutations': len(MUTATIONS), 'ok': ok}))
    return 0 if ok else 1

if __name__ == '__main__': sys.exit(main())

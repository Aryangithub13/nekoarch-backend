"""Phase 25 mutation testing: plant one defect at a time, run the environmental suites, require failures, restore byte-identically."""
import hashlib, json, pathlib, subprocess, sys, tempfile

root = pathlib.Path.cwd()
E = 'apps/api/src/environmental/'
SOL, MOD, ANA, SHA, VAL, UNI, SVC = E + 'solar.ts', E + 'model.ts', E + 'analysis.ts', E + 'shading.ts', E + 'validate.ts', E + 'units.ts', 'apps/api/src/services/environmental-service.ts'
MUTATIONS = [
    ('flipped north orientation', SOL, "north: [Math.sin(t), 0, -Math.cos(t)]", "north: [Math.sin(t), 0, Math.cos(t)]"),
    ('east/west solar azimuth sign', SOL, "Math.atan2(Math.sin(H), Math.cos(H)", "Math.atan2(-Math.sin(H), Math.cos(H)"),
    ('DST fold or gap accepted', SOL, "if (hits.length !== 1) throw", "if (hits.length === 0 && false) throw"),
    ('reversed surface normal', MOD, "const out = exteriorLeft ? n : { x: -n.x, z: -n.z }", "const out = exteriorLeft ? { x: -n.x, z: -n.z } : n"),
    ('omitted window', MOD, "    for (const o of hosted) {", "    for (const o of hosted.filter(x => x.kind !== 'window')) {"),
    ('duplicate surface', MOD, "    used.add(`slabs:${s.id}`);", "    used.add(`slabs:${s.id}`); if (roof) surfaces.push({ ...surfaces[surfaces.length - 1]! });"),
    ('mm2 to m2 error', UNI, "export const mm2ToM2 = (mm2: number) => mm2 / 1e6;", "export const mm2ToM2 = (mm2: number) => mm2 / 1e3;"),
    ('Celsius/Kelvin offset in a difference', UNI, "(aCelsius: number, bCelsius: number) => aCelsius - bCelsius;", "(aCelsius: number, bCelsius: number) => aCelsius + KELVIN_OFFSET - bCelsius;"),
    ('wrong energy integration factor', UNI, "(powerW: number, hours: number) => powerW * hours;", "(powerW: number, hours: number) => powerW * hours * 60;"),
    ('irradiance x1000', ANA, "incident: { value: sample.dni * Math.max(cos, 0) * fraction, unit", "incident: { value: sample.dni * Math.max(cos, 0) * fraction * 1000, unit"),
    ('ground temperature confused with outdoor', ANA, "const dT = s.boundary === 'GROUND' ? dGround : dOut;", "const dT = dOut;"),
    ('grazing and back faces counted as facing', ANA, "cos <= SHADING.facingCos ? 'NOT_FACING' as const", "cos < -2 ? 'NOT_FACING' as const"),
    ('antimeridian longitude not wrapped', ANA, "Math.abs(((w.provenance.station.longitude - loc.longitude.value) % 360 + 540) % 360 - 180)", "Math.abs(w.provenance.station.longitude - loc.longitude.value)"),
    ('malformed calculator output accepted', ANA, "if (!parsed.success) return invalid('Calculator output is malformed", "if (false) return invalid('Calculator output is malformed"),
    ('orientation-only heuristic instead of ray casting', SHA, "    if (!others.some(occ => hit(o, sun, occ))) lit++;", "    lit++;"),
    ('stale result served as current', SVC, "if (requireCurrent && c.status !== 'CURRENT')", "if (false && requireCurrent && c.status !== 'CURRENT')"),
    ('validator solar comparison disabled', VAL, "if (dAlt > 0.05 || dAz > 0.05) error(", "if (false) error("),
    ('validator independent ray recount disabled', VAL, "if (Math.abs(lit - e.sunlitSamples) > 1) error(", "if (false) error("),
    ('validator heat-flow recomputation disabled', VAL, "if (!row.heatFlow || !close(row.heatFlow.value, q)) error(", "if (false) error("),
]
SUITES = ['apps/api/tests/environmental.test.ts', 'apps/api/tests/environmental.integration.test.ts']

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
    out = root / 'docs/phase25/evidence'; out.mkdir(parents=True, exist_ok=True)
    total, failed = run_suites(); rows.append({'mutation': 'none (after restore)', 'tests': total, 'failed': len(failed)}); ok &= not failed
    (out / 'mutation-testing.json').write_text(json.dumps(rows, indent=2) + '\n')
    print(json.dumps({'killed': sum(1 for r in rows if r.get('killed')), 'mutations': len(MUTATIONS), 'ok': ok}))
    return 0 if ok else 1

if __name__ == '__main__': sys.exit(main())

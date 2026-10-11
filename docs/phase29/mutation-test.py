#!/usr/bin/env python3
"""Phase 29 mutation campaign (scene compiler, validator, GLB writer, worker pool, persistence/RLS, service).
Plants each mutant, runs its killer suite, records failing tests, checks an intended killer failed, restores the file and verifies its sha256.
Usage: python3 docs/phase29/mutation-test.py [M01 M05 ...]   (no args = all; unknown arguments are refused)"""
import hashlib, json, re, subprocess, sys, tempfile, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = 'apps/api/src/scene3d/'
OUT = ROOT / 'docs/phase29/evidence/mutation-testing.json'
SQL = 'supabase/migrations/0019_scene_artifacts.sql'
SVC = 'apps/api/src/services/scene-service.ts'
SUITES = {'core': ['apps/api/tests/scene3d.test.ts'],
          'integration': ['apps/api/tests/scene-pool.test.ts', 'apps/api/tests/scene.integration.test.ts']}
VALID = 'compiles every supported fixture to a scene the independent validator accepts'
# (id, plan item (§38), file (relative to SRC, or repo path), find (must be unique), replace, intended killer test-name substring[, suite])
MUTANTS = [
    ('M01', 'remove a wall opening', 'compile.ts', '!holes.some(h => h.a[0] <= along[i]!', '!holes.slice(1).some(h => h.a[0] <= along[i]!', VALID),
    ('M02', 'alter door width', 'compile.ts', 'a1 = a0 + dir * o.widthMm * 2', 'a1 = a0 + dir * (o.widthMm + (o.kind === \'door\' ? 50 : 0)) * 2', VALID),
    ('M03', 'alter window sill elevation', 'compile.ts', 'y0 = base + o.sillMm * 2', "y0 = base + (o.kind === 'window' ? o.sillMm + 20 : o.sillMm) * 2", VALID),
    ('M04', 'alter wall thickness', 'compile.ts', 't = w.thicknessMm, base = ', 't = w.thicknessMm + 10, base = ', 'places every wall at its centerline'),
    ('M05', 'shift floor Y coordinate', 'compile.ts', 'top = (lv.elevationMm + s.topOffsetMm) * 2', 'top = (lv.elevationMm + s.topOffsetMm + (s.kind === \'floor\' ? 20 : 0)) * 2', VALID),
    ('M06', 'fill a slab void', 'compile.ts', 'vs.every(v => pointLocation(c, v) === -1)', 'true', VALID),
    ('M07', 'omit a stair', 'compile.ts', 'for (const s of [...m.stairs].sort(', 'for (const s of [...m.stairs].slice(1).sort(', VALID),
    ('M08', 'reverse mesh triangle winding', 'mesh.ts', 'sign > 0 ? corners : [...corners].reverse()', 'sign < 0 ? corners : [...corners].reverse()', VALID),
    ('M09', 'corrupt a mesh index', 'mesh.ts', 'p.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);', 'p.indices.push(base, base + 1, base + 2, base, base + 3, base + 2);', VALID),
    ('M10', 'drop semantic source ID', 'gltf.ts', 'sourceEntityId: m.sourceEntityId, bimElementId: m.bimElementId, modelHash', 'bimElementId: m.bimElementId, modelHash', 'traceable source and BIM identities'),
    ('M11', 'change scene scale', 'gltf.ts', '(i % 3 === 0 ? o.x : i % 3 === 1 ? o.y : o.z)) / 1000;', '(i % 3 === 0 ? o.x : i % 3 === 1 ? o.y : o.z)) / 999;', 'independent glTF implementation'),
    # Dropping only the explicit modelHash comparison is an EQUIVALENT mutant: the reused Phase 23 projectBim → bindingFor recomputes the model and
    # parameter hashes and refuses the binding (SCENE_SOURCE_MISMATCH). The comparison stays as defense in depth; the non-equivalent bypass —
    # the compiler silently re-binding a forged hash to the recomputed one — is mutated instead.
    ('M12', 'alter (accept forged) model hash', 'compile.ts',
     "      throw new SceneError('SCENE_SOURCE_MISMATCH', 'Source revision hash mismatch');\n    bim = projectBim(raw, { ...b, generationId: null, requirementsHash: null });",
     "      void 0;\n    bim = projectBim(raw, { ...b, modelHash: modelHash(raw as BuildingModelV2), parameterHash: model.parametricArchitecture ? costHash(model.parametricArchitecture) : null, generationId: null, requirementsHash: null });",
     'mismatched bindings'),
    ('M13', 'alter GLB bytes without updating checksum (validator accepts)', 'validate.ts', "check(createHash('sha256').update(glb).digest('hex') === manifest.binary.sha256 && glb.length === manifest.binary.bytes,", 'check(true,', 'binds manifest, binary and source'),
    ('M14', 'bypass independent validation', 'job.ts', "if (validation.status !== 'VALID') throw", 'if (false) throw', 'never returns a scene the independent validator rejects'),
    ('M15', 'change material/provenance status', 'compile.ts', "geometryRole: o.kind === 'door' ? 'door-leaf' : 'window-pane', fidelity: 'VISUAL_PLACEHOLDER',", "geometryRole: o.kind === 'door' ? 'door-leaf' : 'window-pane', fidelity: 'FULL_GEOMETRY',", 'visual placeholder'),
    ('M16', 'skip an architectural entity', 'compile.ts', 'for (const w of [...m.walls].sort((p, q) => compare(p.id, q.id))) {', 'for (const w of [...m.walls].sort((p, q) => compare(p.id, q.id)).slice(1)) {', 'never silently omits'),
    ('M17', 'break camera target', 'compile.ts', 'const target = { x: r.interiorPoint.x, y: r.floorElevationMm + 1000, z: r.interiorPoint.z };', 'const target = { x: r.interiorPoint.x, y: r.floorElevationMm + 1000, z: r.interiorPoint.z + 100_000 };', VALID),
    ('M18', 'corrupt room-to-scene mapping', 'compile.ts', 'interiorPoint: { x: ip.x, y: lv.elevationMm, z: ip.z }', 'interiorPoint: { x: ip.x, y: lv.elevationMm + 1, z: ip.z }', VALID),
    ('M19', 'disable node/resource limit', 'compile.ts', 'if (compiled.length > limits.objects)', 'if (false)', 'enforces object, triangle'),
    ('M20', 'leak foreign artifact access (read RPC ownership)', SQL, 'select * into p from public.projects where id=p_project_id and owner_id=auth.uid();', 'select * into p from public.projects where id=p_project_id;', "another owner's scene", 'integration'),
    ('M21', 'bypass owner-only storage (blob table readable)', SQL, 'revoke all on public.project_revision_scene_blobs from public,anon,authenticated,service_role;', 'grant select on public.project_revision_scene_blobs to authenticated;', 'unreachable except through the owner-scoped RPC', 'integration'),
    ('M22', 'serve incomplete artifact as READY (row without bytes)', SQL, '   insert into public.project_revision_scene_blobs(artifact_id,glb) values(a.id,glb);\n', '', 'persists an immutable READY artifact', 'integration'),
    ('M23', 'bypass stale check', SVC, "if (requireCurrent && c.status !== 'CURRENT')", 'if (false)', 'marks them STALE', 'integration'),
    ('M24', 'nondeterministic serialization order', 'gltf.ts', '    for (const layer of LAYERS) {', '    for (const layer of [...LAYERS].sort(() => Math.random() - 0.5)) {', 'byte-identical across repeated compiles'),
    ('M25', 'validator imports the compiler (independence)', 'validate.ts', "import { modelHash } from '../lib/generation-identity.js';", "import { modelHash } from '../lib/generation-identity.js';\nimport { compileScene as _compile } from './compile.js';", 'validator independent'),
    ('M26', 'validator aperture probe disabled', 'validate.ts', 'check(!rayHits(prims, across as 0 | 2, P(axis, a, y, c)), `opening', 'check(true || !rayHits(prims, across as 0 | 2, P(axis, a, y, c)), `opening', 'real door and window apertures'),
    ('M27', 'worker bypass (compile on the request thread)', SVC, 'try { run = await pool.run({ model, binding }, input); }',
     "try { const { runSceneJob } = await import('../scene3d/job.js'); const r = runSceneJob({ model, binding }, input); run = { ...r, glb: Buffer.from(r.glb), queueMs: 0, workerMs: 0 }; }", 'stores nothing when the worker', 'integration'),
    ('M28', 'pool accepts unvalidated worker output', 'pool.ts', "if (!shape.success || shape.data.validation.status !== 'VALID') return null;", 'if (!shape.success) return null;', 'unvalidated and tampered', 'integration'),
    ('M29', 'SQL binary hash check removed (forged artifact hash accepted)', SQL, " and substring(glb from 1 for 4)='\\x676c5446'::bytea and encode(pg_catalog.sha256(glb),'hex')=man->'binary'->>'sha256'\n", '\n', 'forged artifact hash', 'integration'),
    ('M30', 'SQL coverage check bypass', SQL, "   if (select count(*) from jsonb_array_elements(man->'coverage') c where c->>'entityType'=kind)", "   if false and (select count(*) from jsonb_array_elements(man->'coverage') c where c->>'entityType'=kind)", 'rejects missing coverage on a revision with no artifact', 'integration'),
    ('M31', 'RLS owner-read bypass (policy opened to every authenticated user)', SQL,
     'create policy scene_owner_read on public.project_revision_scene_artifacts for select to authenticated using (\n exists',
     'create policy scene_owner_read on public.project_revision_scene_artifacts for select to authenticated using (\n true or exists', 'unreachable except through the owner-scoped RPC', 'integration'),
]

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def run_suite(files=SUITES['core'] + SUITES['integration']):
    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f: report = pathlib.Path(f.name)
    subprocess.run(['npx', 'vitest', 'run', *files, '--reporter=json', f'--outputFile={report}'], cwd=ROOT, capture_output=True, text=True, timeout=900)
    data = json.loads(report.read_text()); report.unlink()
    tests = [t for r in data['testResults'] for t in r['assertionResults']]
    failing = sorted(t['fullName'] for t in tests if t['status'] != 'passed')
    validator = sum(1 for t in tests if any('SCENE_VALIDATION_FAILED' in m or "'INVALID'" in m for m in t.get('failureMessages', [])))
    return {'tests': len(tests), 'failed': len(failing), 'failingTests': failing, 'failuresMentioningValidation': validator,
            'suiteError': [r.get('message', '')[:300] for r in data['testResults'] if r.get('status') == 'failed' and not r['assertionResults']]}

def main():
    ids = {m[0] for m in MUTANTS}
    if any(not re.fullmatch(r'M\d\d', a) or a not in ids for a in sys.argv[1:]): sys.exit('usage: mutation-test.py [M01 ... M31]')
    wanted = set(sys.argv[1:])
    results = [{'mutation': 'none (control)', **run_suite()}]
    for mid, plan, file, find, replace, killer, *suite in MUTANTS:
        if wanted and mid not in wanted: continue
        path = ROOT / file if '/' in file else ROOT / SRC / file; original = path.read_bytes(); digest = sha(path); text = original.decode()
        if text.count(find) != 1: results.append({'id': mid, 'plan': plan, 'error': f'target occurs {text.count(find)} times'}); print(mid, 'TARGET ERROR', flush=True); continue
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
    ok = not bad and all(c['failed'] == 0 and not c['suiteError'] for c in controls)
    print(json.dumps({'mutants': len([r for r in results if 'id' in r]), 'problems': [r.get('id') for r in bad], 'controlsPass': all(c['failed'] == 0 for c in controls), 'ok': ok}))
    sys.exit(0 if ok else 1)

if __name__ == '__main__': main()

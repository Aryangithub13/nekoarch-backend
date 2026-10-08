"""Phase 27 final verification on frozen source (derived from docs/phase26/verify-phase26.py).
Records exact commands, exits and timings; re-hashes the tested source around every gate and stops if it changes.
Earlier phases' evidence is never written: Phase 23 fixtures go to a temporary tree; benchmark:structural, benchmark:environmental, benchmark:systems
and the Phase 25/26 mutation runs are excluded."""
import hashlib, json, pathlib, shlex, shutil, subprocess, sys, tempfile, time
root = pathlib.Path.cwd()
here = root / 'docs/phase27'
out = here / 'evidence/final'; out.mkdir(parents=True, exist_ok=True)
ifc_python = '/tmp/designflow-phase23-ifc/bin/python'
image = 'designflow-api:phase27'
base = '4d1f431b4eabcf7fdd3b9f88c3c4a5cdc3f3c7e7'      # backend-v1-phase26-complete
phase24 = 'd93aaa9d660ec5bc441188d768a46da98a2b52d6'   # backend-v1-phase24-complete
phase25 = 'ec77974aece4f1b4d60328985fdee904df53a92c'   # backend-v1-phase25-complete
phase26 = base
historical = [*(f'supabase/migrations/{p.name}' for p in sorted((root / 'supabase/migrations').glob('00*.sql')) if p.name < '0017'),
              'docs/phase23-evidence', 'docs/phase24', 'docs/phase24-audit-repair', 'docs/phase25', 'docs/phase26', 'docs/backend-repair-1-23']
untouched = ['docs/backend-repair-1-23/', 'docs/phase24/evidence/final/phase23/fixtures/', 'docs/phase26/evidence/']
NEW_TABLE = 'project_revision_specialized_knowledge_analyses'

def manifest():
    files = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z']).decode().split('\0')
    keep = lambda f: f and pathlib.Path(f).is_file() and not f.startswith(('docs/backend-audit-1-23/', 'docs/backend-repair-1-23/', 'docs/phase24/evidence/',
        'docs/phase24-audit-repair/evidence/', 'docs/phase25/evidence/', 'docs/phase26/evidence/', 'docs/phase27/evidence/')) and (not f.startswith('docs/') or pathlib.Path(f).suffix in {'.py', '.mjs', '.js', '.ts', '.mts', '.sh'})
    return {f: hashlib.sha256(pathlib.Path(f).read_bytes()).hexdigest() for f in sorted(set(files)) if keep(f)}

def untouched_digest():
    return {d: hashlib.sha256(b''.join(p.relative_to(root).as_posix().encode() + p.read_bytes() for p in sorted((root / d).rglob('*')) if p.is_file())).hexdigest() for d in untouched}

def preserved():
    """Every pre-existing local row digest (including Phase 24–26 analysis rows) survives; RLS on everywhere; pre-existing policies unchanged; only 0017 added."""
    before = json.loads((here / 'evidence/database-before.json').read_text()); after = json.loads((here / 'evidence/database-after-verification.json').read_text())
    missing = {t: len(set(v['rowDigests']) - set(after['tables'][t]['rowDigests'])) for t, v in before['tables'].items()}
    migrations = [m['version'] for m in after['migrationHistory']] == [m['version'] for m in before['migrationHistory']] + ['0017']
    ok = all(n == 0 for n in missing.values()) and all(r['relrowsecurity'] for r in after['rls']) and after['policiesDigest'] == before['policiesDigest'] \
        and migrations and set(after['tables']) == set(before['tables']) | {NEW_TABLE}
    print(json.dumps({'missingPreexistingRows': missing, 'countsBefore': {t: v['count'] for t, v in before['tables'].items()},
                      'countsAfter': {t: v['count'] for t, v in after['tables'].items()}, 'migrations': [m['version'] for m in after['migrationHistory']],
                      'rlsEnabledEverywhere': all(r['relrowsecurity'] for r in after['rls']), 'preexistingPoliciesUnchanged': after['policiesDigest'] == before['policiesDigest'],
                      'onlyMigration0017Added': migrations, 'preserved': ok}, indent=2))
    return 0 if ok else 1

def architecture_identical(work):
    """Regenerated Phase 23 fixtures: IFC byte-identical and model/BIM (hashes, semantic ids) equal to the committed Phase 23 evidence."""
    rows, ok = [], True
    for ifc in sorted((root / 'docs/phase23-evidence/fixtures').glob('*.ifc')):
        new_ifc, old_json, new_json = work / 'docs/phase23-evidence/fixtures' / ifc.name, ifc.with_suffix('.json'), work / 'docs/phase23-evidence/fixtures' / (ifc.stem + '.json')
        a, b = json.loads(old_json.read_text()), json.loads(new_json.read_text())
        row = {'fixture': ifc.stem, 'ifcSha256': hashlib.sha256(new_ifc.read_bytes()).hexdigest(), 'ifcByteIdentical': new_ifc.read_bytes() == ifc.read_bytes(),
               'modelIdentical': a['model'] == b['model'], 'bimIdentical': a['bim'] == b['bim'], 'modelHash': b['bim']['binding']['modelHash']}
        rows.append(row); ok &= row['ifcByteIdentical'] and row['modelIdentical'] and row['bimIdentical']
    print(json.dumps(rows, indent=2)); return 0 if ok and len(rows) == 7 else 1

def main():
    if sys.argv[1:] == ['--preserved']: return preserved()
    if sys.argv[1:2] == ['--architecture']: return architecture_identical(pathlib.Path(sys.argv[2]))
    work = pathlib.Path(tempfile.mkdtemp(prefix='designflow-phase27-verification-'))
    (work / 'docs/phase23-evidence').mkdir(parents=True)
    scripts = ['build', 'typecheck', 'lint', 'test:unit', 'test:generator', 'test:blueprint', 'test:blueprint-qa', 'test:solver-v2', 'test:parametric', 'test:projects',
               'test:takeoff', 'test:construction', 'test:cost', 'test:workflows', 'test:interpretation', 'test:conversations', 'test:ai-orchestration',
               'test:integration', 'test:bim', 'test:structural', 'test:environmental', 'test:systems', 'test:knowledge', 'test:supabase', 'db:test', 'check', 'benchmark:knowledge']
    envsrc = 'apps/api/src/environmental apps/api/src/services/environmental-service.ts apps/api/src/routes/environmental.ts apps/api/src/lib/environmental-repository.ts'
    syssrc = 'apps/api/src/systems apps/api/src/services/systems-service.ts apps/api/src/routes/systems.ts apps/api/src/lib/systems-repository.ts'
    knowsrc = 'apps/api/src/knowledge apps/api/src/services/knowledge-service.ts apps/api/src/routes/knowledge.ts apps/api/src/lib/knowledge-repository.ts'
    commands = [{'argv': ['git', 'rev-parse', 'backend-v1-phase24-complete^{commit}'], 'name': 'phase24-tag', 'expect': phase24},
                {'argv': ['git', 'rev-parse', 'backend-v1-phase25-complete^{commit}'], 'name': 'phase25-tag', 'expect': phase25},
                {'argv': ['git', 'rev-parse', 'backend-v1-phase26-complete^{commit}'], 'name': 'phase26-tag', 'expect': phase26},
                {'argv': ['git', 'merge-base', '--is-ancestor', base, 'HEAD'], 'name': 'phase26-baseline-ancestor'},
                {'argv': ['node', '--import', 'tsx', 'docs/phase24-audit-repair/reproduce-audit.mts'], 'name': 'phase24-audit-reproductions'},
                {'argv': ['python3', 'scripts/test-phase23-runner.py'], 'name': 'runner-controls'}]
    commands += [{'argv': ['npm', 'run', s], 'name': s.replace(':', '-')} for s in scripts]
    commands += [
        {'argv': ['python3', 'docs/phase27/mutation-test.py'], 'name': 'mutation-testing'},
        {'argv': ['node', '--import', 'tsx', '--input-type=module', '-e', f'process.chdir({json.dumps(str(work))}); await import({json.dumps((root / "scripts/benchmark-bim.ts").as_uri())});'], 'name': 'phase23-bim-fixtures'},
        {'argv': [ifc_python, str(root / 'scripts/verify-ifc.py')], 'name': 'ifc-roundtrip', 'cwd': str(work)},
        {'argv': [ifc_python, str(root / 'docs/phase23-evidence/verify-ifc-profiles.py')], 'name': 'ifc-profiles', 'cwd': str(work)},
        {'argv': ['python3', 'docs/phase27/verify-phase27.py', '--architecture', str(work)], 'name': 'phase23-architecture-identical'},
        {'argv': ['sh', '-c', f'git diff --exit-code {base} -- {" ".join(historical)} && test "$(git ls-files --others --exclude-standard supabase/migrations)" = supabase/migrations/0017_specialized_knowledge_analyses.sql'],
         'name': 'historical-artifacts-unchanged'},
        {'argv': ['sh', '-c', f"! grep -rnE \"from '\\.\\./(ai|workflows)/\" apps/api/src/structural apps/api/src/services/structural-service.ts apps/api/src/routes/structural.ts {envsrc} {syssrc} {knowsrc}"], 'name': 'ai-boundary'},
        {'argv': ['sh', '-c', "! grep -rnE \"node:(http|https|net|dgram|child_process|fs|worker_threads)|fetch\\(|XMLHttpRequest|process\\.env\" apps/api/src/environmental"], 'name': 'environmental-offline-no-io'},
        {'argv': ['sh', '-c', "! grep -rnE \"node:(http|https|net|dgram|child_process|fs|worker_threads)|fetch\\(|XMLHttpRequest|process\\.env|Math\\.random|Date\\.now\" apps/api/src/systems"], 'name': 'systems-offline-no-io-no-clock'},
        {'argv': ['sh', '-c', "! grep -nE \"from '\\./(model|solar|shading|analysis)\\.js'\" apps/api/src/environmental/validate.ts"], 'name': 'validator-independence'},
        {'argv': ['sh', '-c', "! grep -nE \"from '\\./(model|routing|egress|vertical|clash|analysis|units)\\.js'\" apps/api/src/systems/validate.ts"], 'name': 'systems-validator-independence'},
        {'argv': ['sh', '-c', "! grep -rnE \"node:(http|https|net|dgram|child_process|fs|worker_threads)|fetch\\(|XMLHttpRequest|process\\.env|Math\\.random|Date\\.now\" apps/api/src/knowledge"], 'name': 'knowledge-offline-no-io-no-clock'},
        {'argv': ['node', 'docs/phase27/validator-independence.mjs'], 'name': 'knowledge-validator-independence'},
        {'argv': ['docker', 'build', '-t', image, '.'], 'name': 'docker-build'},
        {'argv': ['node', 'scripts/smoke-container.mjs', image], 'name': 'docker-smoke'},
        {'argv': ['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'sh', image, '-c',
                  'test "$(id -u)" != 0 && test -f apps/api/dist/structural/frame-solver.js && test -f apps/api/dist/structural/validate.js && test -f apps/api/dist/routes/structural.js '
                  '&& test -f apps/api/dist/bim/ifc.js && test -f apps/api/dist/environmental/solar.js && test -f apps/api/dist/environmental/validate.js && test -f apps/api/dist/routes/environmental.js '
                  '&& test -f apps/api/dist/systems/routing.js && test -f apps/api/dist/systems/validate.js && test -f apps/api/dist/routes/systems.js '
                  '&& test -f apps/api/dist/knowledge/evaluate.js && test -f apps/api/dist/knowledge/validate.js && test -f apps/api/dist/routes/knowledge.js '
                  '&& grep -q specialized-knowledge-result-validator-v1 apps/api/dist/knowledge/contracts.js '
                  '&& grep -q structural-result-validator-v2 apps/api/dist/structural/contracts.js '
                  '&& test ! -e node_modules/vitest && test ! -e node_modules/tsx && test ! -e node_modules/embedded-postgres && echo non-root-compiled-bim-structural-environmental-systems-knowledge-no-dev-deps'], 'name': 'docker-runtime-contents'},
        {'argv': ['docker', 'run', '--rm', '-i', '--network', 'none', image, 'node', '--input-type=module'], 'name': 'docker-phase23-acceptance', 'stdin': 'docs/phase23-evidence/compiled-acceptance.mjs'},
        {'argv': ['docker', 'run', '--rm', '-i', '--network', 'none', image, 'node', '--input-type=module'], 'name': 'docker-phase24-acceptance', 'stdin': 'docs/phase24/compiled-acceptance.mjs'},
        {'argv': ['docker', 'run', '--rm', '-i', '--network', 'none', image, 'node', '--input-type=module'], 'name': 'docker-phase25-acceptance', 'stdin': 'docs/phase25/compiled-acceptance.mjs'},
        {'argv': ['docker', 'run', '--rm', '-i', '--network', 'none', image, 'node', '--input-type=module'], 'name': 'docker-phase26-acceptance', 'stdin': 'docs/phase26/compiled-acceptance.mjs'},
        {'argv': ['docker', 'run', '--rm', '-i', '--network', 'none', image, 'node', '--input-type=module'], 'name': 'docker-phase27-acceptance', 'stdin': 'docs/phase27/compiled-acceptance.mjs'},
        {'argv': ['python3', 'docs/phase27/snapshot-local-db.py', 'database-after-verification'], 'name': 'database-snapshot'},
        {'argv': ['python3', 'docs/phase27/verify-phase27.py', '--preserved'], 'name': 'database-preservation'},
        {'argv': ['git', 'diff', '--check'], 'name': 'diff-check'}]
    initial = manifest(); encoded = (json.dumps(initial, sort_keys=True, indent=2) + '\n').encode(); source_hash = hashlib.sha256(encoded).hexdigest()
    (out / 'tested-source-sha256.json').write_bytes(encoded); kept = untouched_digest()
    rows = []
    try:
        for item in commands:
            start = time.perf_counter(); before = manifest() == initial
            receipts = set((root / 'docs/phase16-evidence').glob('supabase-*.json'))
            stdin = (root / item['stdin']).open('rb') if item.get('stdin') else subprocess.DEVNULL
            try:
                with (out / (item['name'] + '.txt')).open('w') as log:
                    code = subprocess.run(item['argv'], cwd=item.get('cwd', root), stdin=stdin, stdout=log, stderr=subprocess.STDOUT, timeout=2400).returncode
            except subprocess.TimeoutExpired: code = 124
            except OSError: code = 127
            finally:
                if item.get('stdin'): stdin.close()
            if 'expect' in item and code == 0: code = 0 if (out / (item['name'] + '.txt')).read_text().strip() == item['expect'] else 1
            for receipt in set((root / 'docs/phase16-evidence').glob('supabase-*.json')) - receipts:
                (out / 'supabase-receipts').mkdir(exist_ok=True); shutil.move(receipt, out / 'supabase-receipts' / receipt.name)
            for name in ['benchmark.json', 'ifc-verification.json', 'ifc-profile-verification.json']:
                if (work / 'docs/phase23-evidence' / name).exists(): (out / 'phase23').mkdir(exist_ok=True); shutil.copy(work / 'docs/phase23-evidence' / name, out / 'phase23' / name)
            row = {'command': shlex.join(item['argv']) + (' < ' + item['stdin'] if item.get('stdin') else ''), 'cwd': str(item.get('cwd', root)), 'exitCode': code,
                   'seconds': round(time.perf_counter() - start, 3), 'log': str((out / (item['name'] + '.txt')).relative_to(root)), 'sourceManifestSha256': source_hash,
                   'sourceUnchanged': before and manifest() == initial, 'untouchedDirectoriesUnchanged': untouched_digest() == kept}
            rows.append(row); (out / 'verification.json').write_text(json.dumps(rows, indent=2) + '\n'); print(json.dumps(row), flush=True)
            if not row['sourceUnchanged'] or not row['untouchedDirectoriesUnchanged']: return 1
        return int(any(r['exitCode'] for r in rows))
    finally: shutil.rmtree(work)

if __name__ == '__main__': sys.exit(main())

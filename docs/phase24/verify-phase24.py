"""Phase 24 final verification on frozen source. Records exact commands, exits and timings; stops if source changes."""
import hashlib, json, pathlib, shlex, shutil, subprocess, sys, tempfile, time
root = pathlib.Path.cwd()
out = root / 'docs/phase24/evidence/final'; out.mkdir(parents=True, exist_ok=True)
ifc_python = '/tmp/designflow-phase23-ifc/bin/python'
image = 'designflow-api:phase24'
base = '208d56c264f4425022831c8d78d27fd9e4e023b6'
historical = [f'supabase/migrations/{p.name}' for p in sorted((root / 'supabase/migrations').glob('00*.sql')) if p.name < '0014']

def manifest():
    files = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z']).decode().split('\0')
    keep = lambda f: f and pathlib.Path(f).is_file() and not f.startswith(('docs/backend-audit-1-23/', 'docs/backend-repair-1-23/', 'docs/phase24/evidence/')) \
        and (not f.startswith('docs/') or pathlib.Path(f).suffix in {'.py', '.mjs', '.js', '.ts', '.mts', '.sh'})
    return {f: hashlib.sha256(pathlib.Path(f).read_bytes()).hexdigest() for f in sorted(set(files)) if keep(f)}

def preserved():
    """Every pre-existing local row digest must survive migration and verification."""
    before = json.loads((root / 'docs/phase24/evidence/database-before.json').read_text())
    after = json.loads((root / 'docs/phase24/evidence/database-after-verification.json').read_text())
    missing = {t: len(set(v['rowDigests']) - set(after['tables'][t]['rowDigests'])) for t, v in before['tables'].items()}
    ok = all(n == 0 for n in missing.values()) and all(r['relrowsecurity'] for r in after['rls']) and after['policiesDigest'] == before['policiesDigest'] \
        and [m['version'] for m in after['migrationHistory']] == [m['version'] for m in before['migrationHistory']] + ['0014']
    print(json.dumps({'missingPreexistingRows': missing, 'counts': {t: v['count'] for t, v in after['tables'].items()}, 'preserved': ok}, indent=2))
    return 0 if ok else 1

def main():
    if sys.argv[1:] == ['--preserved']: return preserved()
    work = pathlib.Path(tempfile.mkdtemp(prefix='designflow-phase24-verification-'))
    (work / 'docs').mkdir(); (out / 'phase23').mkdir(exist_ok=True); (work / 'docs/phase23-evidence').symlink_to(out / 'phase23', target_is_directory=True)
    scripts = ['build', 'typecheck', 'lint', 'test:unit', 'test:generator', 'test:blueprint', 'test:blueprint-qa', 'test:solver-v2', 'test:parametric', 'test:projects',
               'test:takeoff', 'test:construction', 'test:cost', 'test:workflows', 'test:interpretation', 'test:conversations', 'test:ai-orchestration',
               'test:integration', 'test:bim', 'test:structural', 'test:supabase', 'db:test', 'check', 'benchmark:structural']
    commands = [{'argv': ['python3', 'scripts/test-phase23-runner.py'], 'name': 'runner-controls'}]
    commands += [{'argv': ['npm', 'run', s], 'name': s.replace(':', '-')} for s in scripts]
    commands += [
        {'argv': ['node', '--import', 'tsx', '--input-type=module', '-e', f'process.chdir({json.dumps(str(work))}); await import({json.dumps((root / "scripts/benchmark-bim.ts").as_uri())});'], 'name': 'benchmark-bim'},
        {'argv': [ifc_python, str(root / 'scripts/verify-ifc.py')], 'name': 'ifc-roundtrip', 'cwd': str(work)},
        {'argv': [ifc_python, str(root / 'docs/phase23-evidence/verify-ifc-profiles.py')], 'name': 'ifc-profiles', 'cwd': str(work)},
        {'argv': ['git', 'diff', '--exit-code', base, '--', *historical, 'docs/phase23-evidence'], 'name': 'historical-migrations-and-phase23-evidence-unchanged'},
        {'argv': ['sh', '-c', "! grep -rnE \"from '\\.\\./(ai|workflows)/\" apps/api/src/structural apps/api/src/services/structural-service.ts apps/api/src/routes/structural.ts"], 'name': 'ai-boundary'},
        {'argv': ['docker', 'build', '-t', image, '.'], 'name': 'docker-build'},
        {'argv': ['node', 'scripts/smoke-container.mjs', image], 'name': 'docker-smoke'},
        {'argv': ['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'sh', image, '-c',
                  'test "$(id -u)" != 0 && test -f apps/api/dist/structural/frame-solver.js && test -f apps/api/dist/routes/structural.js && test -f apps/api/dist/bim/ifc.js '
                  '&& test ! -e node_modules/vitest && test ! -e node_modules/tsx && test ! -e node_modules/embedded-postgres && echo non-root-compiled-no-dev-deps'], 'name': 'docker-runtime-contents'},
        {'argv': ['docker', 'run', '--rm', '-i', '--network', 'none', image, 'node', '--input-type=module'], 'name': 'docker-phase23-acceptance', 'stdin': 'docs/phase23-evidence/compiled-acceptance.mjs'},
        {'argv': ['docker', 'run', '--rm', '-i', '--network', 'none', image, 'node', '--input-type=module'], 'name': 'docker-phase24-acceptance', 'stdin': 'docs/phase24/compiled-acceptance.mjs'},
        {'argv': ['python3', 'docs/phase24/snapshot-local-db.py', 'database-after-verification'], 'name': 'database-snapshot'},
        {'argv': ['python3', 'docs/phase24/verify-phase24.py', '--preserved'], 'name': 'database-preservation'},
        {'argv': ['git', 'diff', '--check'], 'name': 'diff-check'}]
    initial = manifest(); encoded = (json.dumps(initial, sort_keys=True, indent=2) + '\n').encode(); source_hash = hashlib.sha256(encoded).hexdigest()
    (out / 'tested-source-sha256.json').write_bytes(encoded)
    rows = []
    try:
        for item in commands:
            start = time.perf_counter(); before = manifest() == initial
            receipts = set((root / 'docs/phase16-evidence').glob('supabase-*.json'))
            stdin = (root / item['stdin']).open('rb') if item.get('stdin') else subprocess.DEVNULL
            try:
                with (out / (item['name'] + '.txt')).open('w') as log:
                    code = subprocess.run(item['argv'], cwd=item.get('cwd', root), stdin=stdin, stdout=log, stderr=subprocess.STDOUT, timeout=1500).returncode
            except subprocess.TimeoutExpired: code = 124
            except OSError: code = 127
            finally:
                if item.get('stdin'): stdin.close()
            for receipt in set((root / 'docs/phase16-evidence').glob('supabase-*.json')) - receipts:
                (out / 'supabase-receipts').mkdir(exist_ok=True); shutil.move(receipt, out / 'supabase-receipts' / receipt.name)
            row = {'command': shlex.join(item['argv']) + (' < ' + item['stdin'] if item.get('stdin') else ''), 'cwd': str(item.get('cwd', root)), 'exitCode': code,
                   'seconds': round(time.perf_counter() - start, 3), 'log': str((out / (item['name'] + '.txt')).relative_to(root)), 'sourceManifestSha256': source_hash,
                   'sourceUnchanged': before and manifest() == initial}
            rows.append(row); (out / 'verification.json').write_text(json.dumps(rows, indent=2) + '\n'); print(json.dumps(row), flush=True)
            if not row['sourceUnchanged']: return 1
        return int(any(r['exitCode'] for r in rows))
    finally: shutil.rmtree(work)

if __name__ == '__main__': sys.exit(main())

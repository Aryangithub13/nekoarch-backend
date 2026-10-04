"""Requested local verification only; no reset, deploy, git mutation or remote service."""
import subprocess, time, json, pathlib, hashlib, sys
out = pathlib.Path('docs/phase22-evidence')
scripts = ['build','typecheck','lint','test:unit','test:generator','test:blueprint','test:blueprint-qa','test:solver-v2','test:projects','test:takeoff','test:construction','test:cost','test:workflows','test:interpretation','test:conversations','test:ai-orchestration','test:parametric','test:integration','test:supabase','db:test','check','benchmark:parametric']
def source_manifest():
    files=[]
    for root in ['apps/api/src','apps/api/tests','packages','test-support','scripts','supabase/migrations']:
        files.extend(p for p in pathlib.Path(root).rglob('*') if p.is_file() and 'dist' not in p.parts and 'node_modules' not in p.parts and p.suffix in ['.ts','.json','.sql','.mjs'])
    files += [pathlib.Path(p) for p in ['package.json','package-lock.json','Dockerfile','eslint.config.js','tsconfig.json','vitest.config.ts']]
    return {str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(set(files))}
initial=source_manifest()
(out/'tested-source-sha256.json').write_text(json.dumps(initial,indent=2)+'\n')
results=json.loads((out/'verification.json').read_text()) if len(sys.argv)>1 and (out/'verification.json').exists() else []
for previous in results: previous.setdefault('sourceManifest','superseded-dispatch-gates/tested-source-sha256.json')
if len(sys.argv)>1: scripts=sys.argv[1:]
for script in scripts:
    started=time.monotonic(); log=out/(script.replace(':','-')+'.txt')
    with log.open('w') as handle:
        result=subprocess.run(['npm','run',script],stdout=handle,stderr=subprocess.STDOUT)
    record={'command':'npm run '+script,'exitCode':result.returncode,'seconds':round(time.monotonic()-started,3),'log':str(log),'sourceUnchanged':source_manifest()==initial,'sourceManifest':'tested-source-sha256.json'}
    results=[old for old in results if old['command']!=record['command']]
    results.append(record);(out/'verification.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps(record),flush=True)
    if not record['sourceUnchanged'] or (script in ['build','typecheck','lint'] and result.returncode): break

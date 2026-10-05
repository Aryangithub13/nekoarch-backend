"""Run the complete Phase 23 release gates against one frozen source snapshot.

Generated documentation/evidence may change; executable verification helpers in
any directory are source and must remain unchanged. No Git mutation or DB reset.
"""
import hashlib
import json
import os
import pathlib
import shlex
import subprocess
import sys
import time

out=pathlib.Path('docs/phase23-evidence');out.mkdir(exist_ok=True)
ifc_python='/tmp/designflow-phase23-ifc/bin/python'

def manifest():
    # Concurrent, unrelated audit artifacts are outside the Phase 23 release.
    files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z']).decode().split('\0')
    return {f:hashlib.sha256(pathlib.Path(f).read_bytes()).hexdigest() for f in sorted(set(files))
            if f and not f.startswith('docs/backend-audit-1-23/') and pathlib.Path(f).is_file() and (not f.startswith('docs/') or pathlib.Path(f).suffix in {'.py','.mjs','.js','.ts','.sh'})}

def main():
    scripts=['build','typecheck','lint','test:unit','test:generator','test:blueprint','test:blueprint-qa','test:solver-v2','test:parametric','test:projects','test:takeoff','test:construction','test:cost','test:workflows','test:interpretation','test:conversations','test:ai-orchestration','test:integration','test:bim','test:supabase','db:test','check','benchmark:bim']
    commands=[{'argv':['python3','scripts/test-phase23-runner.py'],'name':'runner-controls'}]
    commands.extend({'argv':['npm','run',script],'name':script.replace(':','-')} for script in scripts)
    commands.extend([
        {'argv':['npm','run','test:ifc'],'name':'ifc-roundtrip','ifc':True},
        {'argv':[ifc_python,'docs/phase23-evidence/verify-ifc-profiles.py'],'name':'ifc-profiles'},
        {'argv':['docker','build','-t','designflow-api:phase23','.'],'name':'docker-build'},
        {'argv':['node','scripts/smoke-container.mjs','designflow-api:phase23'],'name':'docker-smoke'},
        {'argv':['docker','run','--rm','-i','--network','none','designflow-api:phase23','node','--input-type=module'],'name':'docker-acceptance','stdin':'docs/phase23-evidence/compiled-acceptance.mjs'},
        {'argv':['git','diff','--check'],'name':'diff-check'},
    ])
    initial=manifest();encoded=(json.dumps(initial,sort_keys=True,indent=2)+'\n').encode()
    source_hash=hashlib.sha256(encoded).hexdigest()
    (out/'tested-source-sha256.json').write_bytes(encoded)
    rows=[]
    for item in commands:
        start=time.perf_counter();argv=item['argv'];env=os.environ.copy()
        command=shlex.join(argv)
        if item.get('ifc'):
            env['PATH']=str(pathlib.Path(ifc_python).parent)+os.pathsep+env['PATH']
            command='PATH=/tmp/designflow-phase23-ifc/bin:$PATH '+command
        if item.get('stdin'):command+=' < '+item['stdin']
        unchanged_before=manifest()==initial
        stdin=pathlib.Path(item['stdin']).open('rb') if item.get('stdin') else subprocess.DEVNULL
        try:
            with (out/(item['name']+'.txt')).open('w') as log:
                p=subprocess.run(argv,env=env,stdin=stdin,stdout=log,stderr=subprocess.STDOUT)
            code=p.returncode
        except OSError as error:
            (out/(item['name']+'.txt')).write_text(type(error).__name__+': could not execute gate\n')
            code=127
        finally:
            if item.get('stdin'):stdin.close()
        rows.append({'command':command,'exitCode':code,'seconds':round(time.perf_counter()-start,3),'log':str(out/(item['name']+'.txt')),'sourceManifestSha256':source_hash,'sourceUnchanged':unchanged_before and manifest()==initial})
        (out/'verification.json').write_text(json.dumps(rows,indent=2)+'\n')
        print(json.dumps(rows[-1]),flush=True)
        if code:print('Gate failed; continuing independent gates.',flush=True)
    return 1 if any(r['exitCode'] or not r['sourceUnchanged'] for r in rows) else 0

if __name__=='__main__':
    sys.exit(main())

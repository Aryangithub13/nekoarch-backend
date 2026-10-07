"""Run release gates on frozen repair source without rewriting Phase 23 evidence."""
import hashlib,json,os,pathlib,shlex,shutil,subprocess,sys,tempfile,time
root=pathlib.Path.cwd()
out=root/'docs/backend-repair-1-23/evidence/final';out.mkdir(parents=True,exist_ok=True)
ifc_python='/tmp/designflow-phase23-ifc/bin/python'

def manifest():
 files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z']).decode().split('\0')
 return {f:hashlib.sha256(pathlib.Path(f).read_bytes()).hexdigest() for f in sorted(set(files)) if f and pathlib.Path(f).is_file() and not f.startswith('docs/backend-audit-1-23/') and (not f.startswith('docs/') or pathlib.Path(f).suffix in {'.py','.mjs','.js','.ts','.mts','.sh'})}

def main():
 work=pathlib.Path(tempfile.mkdtemp(prefix='designflow-repair-verification-'))
 (work/'docs').mkdir();(out/'phase23').mkdir(exist_ok=True);(work/'docs/phase23-evidence').symlink_to(out/'phase23',target_is_directory=True)
 scripts=['build','typecheck','lint','test:unit','test:generator','test:blueprint','test:blueprint-qa','test:solver-v2','test:parametric','test:projects','test:takeoff','test:construction','test:cost','test:workflows','test:interpretation','test:conversations','test:ai-orchestration','test:integration','test:bim','test:supabase','db:test','check']
 commands=[{'argv':['python3','scripts/test-phase23-runner.py'],'name':'runner-controls'}]
 commands.extend({'argv':['npm','run',s],'name':s.replace(':','-')} for s in scripts)
 commands.extend([
 {'argv':['node','--import','tsx','--input-type=module','-e',f'process.chdir({json.dumps(str(work))}); await import({json.dumps((root/"scripts/benchmark-bim.ts").as_uri())});'],'name':'benchmark-bim'},
 {'argv':[ifc_python,str(root/'scripts/verify-ifc.py')],'name':'ifc-roundtrip','cwd':str(work)},
 {'argv':[ifc_python,str(root/'docs/phase23-evidence/verify-ifc-profiles.py')],'name':'ifc-profiles','cwd':str(work)},
 {'argv':['docker','build','-t','designflow-api:repair-1-23','.'],'name':'docker-build'},
 {'argv':['node','scripts/smoke-container.mjs','designflow-api:repair-1-23'],'name':'docker-smoke'},
 {'argv':['docker','run','--rm','-i','--network','none','designflow-api:repair-1-23','node','--input-type=module'],'name':'docker-acceptance','stdin':'docs/phase23-evidence/compiled-acceptance.mjs'},
 {'argv':['git','diff','--check'],'name':'diff-check'}])
 initial=manifest();encoded=(json.dumps(initial,sort_keys=True,indent=2)+'\n').encode();source_hash=hashlib.sha256(encoded).hexdigest();(out/'tested-source-sha256.json').write_bytes(encoded)
 rows=[]
 try:
  for item in commands:
   start=time.perf_counter();before=manifest()==initial
   receipts=set((root/'docs/phase16-evidence').glob('supabase-*.json'))
   stdin=(root/item['stdin']).open('rb') if item.get('stdin') else subprocess.DEVNULL
   try:
    with (out/(item['name']+'.txt')).open('w') as log:
     p=subprocess.run(item['argv'],cwd=item.get('cwd',root),stdin=stdin,stdout=log,stderr=subprocess.STDOUT,timeout=600)
    code=p.returncode
   except subprocess.TimeoutExpired:code=124
   except OSError:code=127
   finally:
    if item.get('stdin'):stdin.close()
   for receipt in set((root/'docs/phase16-evidence').glob('supabase-*.json'))-receipts:
    (out/'supabase-receipts').mkdir(exist_ok=True);shutil.move(receipt,out/'supabase-receipts'/receipt.name)
   row={'command':shlex.join(item['argv'])+(' < '+item['stdin'] if item.get('stdin') else ''),'cwd':str(item.get('cwd',root)),'exitCode':code,'seconds':round(time.perf_counter()-start,3),'log':str(out/(item['name']+'.txt')),'sourceManifestSha256':source_hash,'sourceUnchanged':before and manifest()==initial}
   rows.append(row);(out/'verification.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(row),flush=True)
   if not row['sourceUnchanged']:return 1
  return int(any(r['exitCode'] for r in rows))
 finally:shutil.rmtree(work)
if __name__=='__main__':sys.exit(main())

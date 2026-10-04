import subprocess,time,json,pathlib,datetime,os,sys,hashlib
root=pathlib.Path('/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow');out=root/'docs/phase21-evidence';out.mkdir(exist_ok=True)
env=os.environ.copy();env.update({'PHASE21_EVIDENCE_DIR':str(out),'PHASE20_EXAMPLE_PATH':str(out/'phase20-postgres.json'),'PHASE20_SUPABASE_EXAMPLE_PATH':str(out/'phase20-supabase.json')})
special={'benchmark':['node','--import','tsx','scripts/benchmark-ai-orchestration.ts'],'docker-build':['docker','build','-t','designflow-api:phase21','.'],'docker-smoke':['node','scripts/smoke-container.mjs','designflow-api:phase21'],'docker-acceptance':['docker','run','--rm','-i','--network','none','designflow-api:phase21','node','--input-type=module'],'diff-check':['git','diff','--check']}
def source_hashes():
 paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],cwd=root,text=True).splitlines()
 return {p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in sorted(set(paths)) if not p.startswith('docs/') and (root/p).is_file()}
for label in sys.argv[1:]:
 cmd=special.get(label,['npm','run',label]);start=time.monotonic();date=datetime.datetime.now(datetime.timezone.utc).isoformat();before=source_hashes()
 result=subprocess.run(cmd,cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,input=(out/'container-acceptance.mjs').read_bytes() if label=='docker-acceptance' else None)
 # Preserve output verbatim, including terminal whitespace; do not rewrite historical evidence.
 (out/(label+'.txt')).write_bytes(result.stdout)
 record={'label':label,'command':cmd,'startedAt':date,'durationSeconds':round(time.monotonic()-start,3),'exitCode':result.returncode,'log':label+'.txt','logSha256':hashlib.sha256(result.stdout).hexdigest(),'sourceSha256':before,'sourcesUnchangedDuringRun':before==source_hashes()}
 (out/(label+'.json')).write_text(json.dumps(record,indent=2)+'\n');print(json.dumps({k:v for k,v in record.items() if k!='sourceSha256'}),flush=True)
 if result.returncode or not record['sourcesUnchangedDuringRun']: sys.exit(1)

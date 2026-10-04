import subprocess,time,json,pathlib,datetime,os,sys
root=pathlib.Path('/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow'); out=root/'docs/stabilization-evidence'
env=os.environ.copy();env.update({'PHASE19_EVIDENCE_DIR':str(out/'solver-postgres'),'PHASE19_SUPABASE_EVIDENCE_DIR':str(out/'solver-supabase'),'SUPABASE_EVIDENCE_DIRECTORY':str(out/'supabase-observations'),'PHASE20_EXAMPLE_PATH':str(out/'conversation-postgres.json'),'PHASE20_SUPABASE_EXAMPLE_PATH':str(out/'conversation-supabase.json'),'PHASE19_PERFORMANCE_PATH':str(out/'solver-performance.json'),'PHASE20_PERFORMANCE_PATH':str(out/'conversation-performance.json')})
special={
 'integration-repeat':['npm','run','test:integration'],
 'docker-build':['docker','build','-t','designflow-api:stabilization','.'],
 'docker-acceptance':['docker','run','--rm','-i','--network','none','designflow-api:stabilization','node','--input-type=module'],
 'docker-smoke':['node','scripts/smoke-container.mjs','designflow-api:stabilization'],
 'benchmark-solver':['node','--import','tsx','scripts/benchmark-solver-v2.ts'],
 'benchmark-conversations':['node','--import','tsx','scripts/benchmark-conversations.ts'],
 'diff-check':['git','diff','--check'],
}
for label,cmd in [(label,special.get(label,['npm','run',label])) for label in sys.argv[1:]]:
 start=time.monotonic(); date=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (out/(label+'.txt')).open('w') as f:
  p=subprocess.run(cmd,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,input=(out/'container-acceptance.mjs').read_bytes() if label=='docker-acceptance' else None)
 record={'label':label,'command':cmd,'startedAt':date,'durationSeconds':round(time.monotonic()-start,3),'exitCode':p.returncode,'log':label+'.txt'}
 (out/(label+'.json')).write_text(json.dumps(record,indent=2)+'\n'); print(json.dumps(record),flush=True)

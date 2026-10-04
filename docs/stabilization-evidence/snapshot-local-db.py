import subprocess,json,pathlib,sys,hashlib
out=pathlib.Path('/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/docs/stabilization-evidence')
def sql(q):
 p=subprocess.run(['docker','exec','supabase_db_designflow','psql','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c',q],capture_output=True,text=True,check=True)
 return p.stdout.strip()
tables=sql("select tablename from pg_tables where schemaname='public' order by tablename").splitlines()
result={'tables':{}}
for t in tables:
 if not t.replace('_','').isalnum():raise ValueError(t)
 hashes=sql('select md5(row_to_json(t)::text) from public."'+t+'" t order by 1').splitlines()
 result['tables'][t]={'count':len(hashes),'rowDigests':hashes}
result['migrationHistory']=json.loads(sql('select coalesce(json_agg(x),\'[]\'::json) from (select version,name from supabase_migrations.schema_migrations order by version) x'))
result['rls']=json.loads(sql("select json_agg(x) from (select c.relname,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname) x"))
result['policiesDigest']=hashlib.sha256(sql("select row_to_json(p) from pg_policies p where schemaname='public' order by tablename,policyname").encode()).hexdigest()
(out/(sys.argv[1]+'.json')).write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'snapshot':sys.argv[1],'counts':{k:v['count'] for k,v in result['tables'].items()},'migrationHistory':result['migrationHistory']}))

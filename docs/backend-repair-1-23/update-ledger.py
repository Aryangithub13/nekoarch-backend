import json,pathlib,sys
root=pathlib.Path(__file__).parent
p=root/'repair-ledger.json'
rows=json.loads(p.read_text()) if p.exists() else []
if len(sys.argv)>1:
 entry=json.loads(sys.argv[1]); rows=[r for r in rows if r['id']!=entry['id']]+[entry]
rows.sort(key=lambda r:r['id'])
p.write_text(json.dumps(rows,indent=2)+'\n')
lines=['# Phase 1–23 repair ledger','','Findings are revalidated against ddf08f864521dfdb52428e75950cde09674c9b65. Historical audit claims are candidates, not authority. In-progress records do not imply full release verification.','']
for r in rows:
 lines.extend(['## '+r['id']+' — '+r['claim'],''])
 for k,v in r.items():
  if k not in ['id','claim']: lines.extend(['**'+k+':** '+(v if isinstance(v,str) else json.dumps(v)),''])
(root/'repair-ledger.md').write_text('\n'.join(lines))

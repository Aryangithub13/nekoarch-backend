"""Finalize release evidence only after every frozen-source gate has passed.

This script writes reports/evidence, never stages, commits, tags or resets data.
"""
import collections
import hashlib
import json
import pathlib
import re
import subprocess

out=pathlib.Path('docs/phase23-evidence')
def read(name):return json.loads((out/name).read_text())
def write(name,value):(out/name).write_text(json.dumps(value,indent=2)+'\n')
def sha(path):return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()

rows=read('verification.json')
assert len(rows)==30 and all(r['exitCode']==0 and r['sourceUnchanged'] for r in rows),'Mandatory gate failed or source drifted'
manifest=read('tested-source-sha256.json')
assert all(sha(f)==h for f,h in manifest.items()),'Source changed after tests'
assert all(r['sourceManifestSha256']==sha(out/'tested-source-sha256.json') for r in rows)
ifc=read('ifc-verification.json');profiles=read('ifc-profile-verification.json')
assert ifc['version']=='0.8.5' and len(ifc['fixtures'])==7 and len(profiles)==7
for fixture in ifc['fixtures']:
    assert fixture['schemaDiagnostics']==0
    for key in ['duplicateGuidNegativeControl','missingProjectNegativeControl','wrongUnitsNegativeControl','invalidGuidNegativeControl','wrongHostNegativeControl','wrongStoreyPlacementNegativeControl','missingRelationshipTargetNegativeControl','sourceBindingNegativeControl','missingBoundaryNegativeControl']:
        assert fixture[key]=='REJECTED',key
assert all(r['unchanged'] and sha(f)==r['currentSha256'] for f,r in read('source-preservation.json').items())

after=read('database-release-after.json');preservation={}
for name in ['database-before.json','database-continuation-before.json','database-release-before.json']:
    before=read(name);tables={}
    for key,value in before['tables'].items():
        missing=collections.Counter(value['rowDigests'])-collections.Counter(after['tables'][key]['rowDigests'])
        tables[key]={'beforeCount':value['count'],'afterCount':after['tables'][key]['count'],'missingOriginalRows':sum(missing.values())}
    result={'tables':tables,'migrationHistoryUnchanged':before['migrationHistory']==after['migrationHistory'],'rlsUnchanged':before['rls']==after['rls'],'policiesUnchanged':before['policiesDigest']==after['policiesDigest']}
    assert all(result[k] for k in ['migrationHistoryUnchanged','rlsUnchanged','policiesUnchanged'])
    assert all(t['missingOriginalRows']==0 for t in tables.values())
    preservation[name]=result
write('release-data-preservation.json',preservation)
write('supplementary-verification.json',[r for r in rows if any(word in r['command'] for word in ['benchmark:bim','test:ifc','verify-ifc-profiles','docker','smoke-container'])])

report=pathlib.Path('docs/phase23-review-report.md');text=report.read_text()
gates=['| Command | Exit | Passed tests | Seconds | Evidence |','|---|---:|---:|---:|---|']
for r in rows:
    log=pathlib.Path(r['log']).read_text()
    counts=re.findall(r'\bTests\s+(\d+) passed',log) or re.findall(r'Tests=(\d+)',log)
    gates.append(f"| `{r['command']}` | {r['exitCode']} | {' / '.join(counts) or '—'} | {r['seconds']:.3f} | [log](phase23-evidence/{pathlib.Path(r['log']).name}) |")
text=text.replace('<!-- GATES -->','\n'.join(gates))
perf=['| Fixture | Elements / edges | BIM bytes | Projection ms | Validation ms | IFC + validation ms | Self-diff ms | IFC bytes |','|---|---:|---:|---:|---:|---:|---:|---:|']
measurements=read('benchmark.json')['measurements']
for b in measurements:
    perf.append(f"| {b['name']} | {b['elements']} / {b['relationships']} | {b['bimModelBytes']} | {b['projectionAndRelationshipsMs']:.2f} | {b['validationMs']:.2f} | {b['ifcSerializationAndValidationMs']:.2f} | {b['diffMs']:.2f} | {b['exportBytes']} |")
text=text.replace('<!-- BENCHMARK -->','\n'.join(perf))
parsers=['| Fixture | Parse ms | EXPRESS ms | Geometry + relationships ms | Full round-trip/control ms |','|---|---:|---:|---:|---:|']
for f in ifc['fixtures']:
    parsers.append(f"| {f['fixture']} | {f['parseMs']:.2f} | {f['schemaValidationMs']:.2f} | {f['geometryAndRelationshipsMs']:.2f} | {f['roundTripMs']:.2f} |")
text=text.replace('<!-- PARSERS -->','\n'.join(parsers))
peak=max(b['processPeakRssBytes'] for b in measurements);parser_peak=max(f['parserPeakRssBytes'] for f in ifc['fixtures'])
text=text.replace('<!-- MEMORY -->',f'Node peak RSS: {peak} bytes ({peak/1048576:.1f} MiB). Independent parser peak RSS: {parser_peak} bytes ({parser_peak/1048576:.1f} MiB). These are process observations, not per-request allocations.')
before=read('database-release-before.json')
text=text.replace('<!-- DATABASE -->',f"Release verification began with **{before['tables']['projects']['count']} projects and {before['tables']['project_revisions']['count']} revisions** and ended with **{after['tables']['projects']['count']} projects and {after['tables']['project_revisions']['count']} revisions**. Every pre-existing row digest survived. The same check passes against the original Phase 23 and continuation baselines. All 12 migration records, RLS flags and policy digests are unchanged. Per-table QA, takeoff, construction, cost and workflow counts are in [release-data-preservation.json](phase23-evidence/release-data-preservation.json).")
text=text.replace('<!-- CLASSIFICATION -->','**FULLY IMPLEMENTED AND VERIFIED**')
text=text.replace('<!-- MANIFEST -->',sha(out/'tested-source-sha256.json'))
assert '<!--' not in text
report.write_text(text)
subprocess.run(['git','diff','--check'],check=True)
git={'stage':'pre-release audit; final commit and annotated tag are verified through Git after checkpoint creation','branch':subprocess.check_output(['git','branch','--show-current']).decode().strip(),'headBeforeRelease':subprocess.check_output(['git','rev-parse','HEAD']).decode().strip(),'phase22Tag':subprocess.check_output(['git','rev-parse','backend-v1-phase22-complete']).decode().strip(),'phase23TagsBeforeRelease':subprocess.check_output(['git','tag','--list','backend-v1-phase23-complete']).decode().splitlines(),'stagedFilesBeforeRelease':subprocess.check_output(['git','diff','--cached','--name-only']).decode().splitlines()}
assert git['branch']=='main' and git['headBeforeRelease']==git['phase22Tag']=='7086209efd9e337a2c175b9bed1e562fde54ca68'
assert not git['phase23TagsBeforeRelease'] and not git['stagedFilesBeforeRelease']
write('release-git-preflight.json',git)
write('changed-files.json',[])
write('evidence-sha256.json',{})
changed=set(subprocess.check_output(['git','diff','--name-only','HEAD','-z']).decode().split('\0'))|set(subprocess.check_output(['git','ls-files','--others','--exclude-standard','-z']).decode().split('\0'))
write('changed-files.json',sorted(f for f in changed if f and not f.startswith('docs/backend-audit-1-23/')))
write('evidence-sha256.json',{str(f):sha(f) for f in sorted(out.rglob('*')) if f.is_file() and f.name!='evidence-sha256.json'})
print(json.dumps({'classification':'FULLY IMPLEMENTED AND VERIFIED','gates':len(rows),'sourceManifestSha256':sha(out/'tested-source-sha256.json'),'ifcFixtures':len(ifc['fixtures']),'changedFiles':len(read('changed-files.json'))}))

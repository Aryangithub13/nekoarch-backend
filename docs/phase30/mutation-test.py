#!/usr/bin/env python3
"""Phase 30 mutation campaign (appearance pass, independent validator, worker job, planner, service, routes, SQL invariants).
Plants each mutant, runs its killer suite, records failing tests, checks an intended killer failed, restores the file and verifies its sha256.
Usage: python3 docs/phase30/mutation-test.py [M01 M05 ...]   (no args = all; unknown arguments are refused; existing evidence is never overwritten)"""
import hashlib, json, re, subprocess, sys, tempfile, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/phase30/evidence/mutation-testing.json'
SQL = 'supabase/migrations/0020_revision_operations.sql'
R = 'apps/api/src/revision/'
SUITES = {'core': ['apps/api/tests/revision.test.ts'], 'integration': ['apps/api/tests/revision.integration.test.ts']}
# (id, defect, file, find (must be unique), replace, intended killer test-name substring[, suite])
MUTANTS = [
    ('M01', 'protected wall moved (geometry BIN check removed)', R + 'verify.ts', "check(Buffer.compare(b!.bin, c!.bin) === 0, 'geometry BIN chunk changed');", "check(true, 'geometry BIN chunk changed');", 'protected wall moved'),
    ('M02', 'material override on a protected object accepted', R + 'verify.ts', 'if (k === undefined) { preserved++; check(!moved, ', 'if (k === undefined) { preserved++; check(true, ', 'material override applied to a protected object'),
    ('M03', 'BIM element id swap accepted', R + 'verify.ts',
     'return !!o && o.sourceEntityType === t.sourceEntityType && o.sourceEntityId === t.sourceEntityId && o.bimElementId === t.bimElementId && o.levelId === t.levelId; }),', 'return !!o; }),', 'BIM element id swapped'),
    ('M04', 'incorrect candidate binding accepted', R + 'verify.ts', 'check(isDeepStrictEqual(m.source, base.manifest.source), ', 'check(true, ', 'incorrect candidate binding'),
    ('M05', 'validator imports the appearance pass (independence lost)', R + 'verify.ts', "import { costHash } from '@designflow/boq-cost';", "import { costHash } from '@designflow/boq-cost';\nimport { applyAppearance as _apply } from './appearance.js';", 'validator is independent'),
    # Runs 1 and 2 (evidence/preliminary/) each removed ONE of the two independent target guards (scene layer, wall classification): both are
    # EQUIVALENT because the other guard still excludes interior walls. The real defect needs both guards gone; the independent validator must reject it.
    ('M06', 'finish applied beyond the exterior shell (both target guards removed)', R + 'appearance.ts',
     ["    if (wall.classification !== 'exterior') continue;\n    if (target.levelIds", "    if (o.layer !== 'EXTERIOR_SHELL') continue;\n    if (o.sourceEntityType === 'wall') {"],
     ["    if (target.levelIds", "    if (o.layer === 'ROOM_VOLUMES') continue;\n    if (o.sourceEntityType === 'wall') {"], 'exactly the exterior shell targets'),
    ('M07', 'façade orientation inverted', R + 'appearance.ts', 'const modelBearing = horizontal ? (plus ? 0 : 180) : (plus ? 270 : 90);', 'const modelBearing = horizontal ? (plus ? 180 : 0) : (plus ? 90 : 270);', 'labels bounding-box façades'),
    ('M08', 'validator bypass in the worker job', R + 'job.ts', "if (validation.status !== 'VALID') throw", 'if (false) throw', 'cannot be bypassed in-process'),
    ('M09', 'lock conflicts ignored by the planner', R + 'plan.ts', "if (blockers.length) return preflight('BLOCKED_BY_LOCK'", "if (false) return preflight('BLOCKED_BY_LOCK'", 'BLOCKED_BY_LOCK'),
    ('M10', 'appearance falsely invalidates engineering results', R + 'plan.ts',
     "...ENGINES.map(artifact => ({ artifact, action: ids(ctx.baseOutputs, artifact).length ? 'REUSE_SOURCE_EQUIVALENT' as const : 'NOT_AFFECTED' as const,",
     "...ENGINES.map(artifact => ({ artifact, action: 'INVALIDATED' as const,", 'source-equivalent impacts'),
    ('M11', 'interior finish silently accepted', R + 'plan.ts', "  if (changes.includes('INTERIOR_APPEARANCE')) {", '  if (false) {', 'warmer finish in the bedroom'),
    ('M12', 'stale engineering output marked newly verified', 'apps/api/src/services/revision-service.ts', 'recomputed: false, newlyVerified: false,', 'recomputed: false, newlyVerified: true,', 'Scenarios 4/5/12', 'integration'),
    ('M13', 'candidate presented as accepted', 'apps/api/src/routes/revisions.ts',
     "reply.header('Content-Type', 'model/gltf-binary').header('Cache-Control', 'private, no-store').header('X-Candidate-Status', c.operation.status === 'COMMITTED' ? 'COMMITTED' : 'UNACCEPTED')",
     "reply.header('Content-Type', 'model/gltf-binary').header('Cache-Control', 'private, no-store').header('X-Candidate-Status', 'COMMITTED')", 'Scenario 16', 'integration'),
    ('M14', 'semantic model lock removed at approval (SQL)', SQL,
     "and project_private.revision_model_hash(p_input->'commit'->'model') = project_private.revision_model_hash(src.model_json)) is not true then", ") is not true then", 'SQL invariants', 'integration'),
    ('M15', 'stale approval allowed (SQL base check removed)', SQL,
     "message = 'The approval does not match the reviewed candidate'; end if;\n     if p.current_revision_id is distinct from o.base_revision_id then",
     "message = 'The approval does not match the reviewed candidate'; end if;\n     if false then", 'Scenario 8', 'integration'),
    ('M16', 'cross-user read allowed (read RPC ownership removed)', SQL, 'select * into p from public.projects where id = p_project_id and owner_id = uid;', 'select * into p from public.projects where id = p_project_id;', 'Scenario 10', 'integration'),
    ('M17', 'forged candidate binding accepted (SQL)', SQL, "and man->'source'->>'revisionId' = base.id::text\n", '\n', 'forged candidate', 'integration'),
    ('M18', 'state machine opened (transition trigger)', SQL, " if not ((old.status = 'AWAITING_CONSENT' and new.status in", " if false and ((old.status = 'AWAITING_CONSENT' and new.status in", 'SQL invariants', 'integration'),
    ('M19', 'RLS owner policy opened', SQL, 'create policy revision_operation_owner_read on public.project_revision_operations for select to authenticated using (\n exists',
     'create policy revision_operation_owner_read on public.project_revision_operations for select to authenticated using (\n true or exists', 'Scenario 10', 'integration'),
    ('M20', 'unvalidated candidate accepted by the SQL function', SQL,
     " and val->>'status' = 'VALID' and val->>'validatorVersion' = 'revision-appearance-validator-v1' and (val->'geometryLock'->>'identical')::boolean) is not true then",
     ") is not true then", 'forged candidate', 'integration'),
    ('M21', 'approval of a different candidate than reviewed', SQL, "if p_input->>'candidateHash' is distinct from o.candidate_hash then raise exception using errcode = 'P3005'",
     "if false then raise exception using errcode = 'P3005'", 'Scenario 16', 'integration'),
    ('M22', 'duplicate commit allowed (already-committed check removed in SQL)', SQL, "     if o.status = 'COMMITTED' then raise exception using errcode = 'P3003', message = 'Revision operation already committed'; end if;\n     if o.status <> 'CANDIDATE_READY' then",
     "     if o.status not in ('CANDIDATE_READY','COMMITTED') then", 'SQL invariants', 'integration'),
]

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def run_suite(files):
    with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as f: report = pathlib.Path(f.name)
    subprocess.run(['npx', 'vitest', 'run', *files, '--reporter=json', f'--outputFile={report}'], cwd=ROOT, capture_output=True, text=True, timeout=1200)
    data = json.loads(report.read_text()); report.unlink()
    tests = [t for r in data['testResults'] for t in r['assertionResults']]
    failing = sorted(t['fullName'] for t in tests if t['status'] != 'passed')
    return {'tests': len(tests), 'failed': len(failing), 'failingTests': failing,
            'suiteError': [r.get('message', '')[:300] for r in data['testResults'] if r.get('status') == 'failed' and not r['assertionResults']]}

def main():
    ids = {m[0] for m in MUTANTS}
    if any(not re.fullmatch(r'M\d\d', a) or a not in ids for a in sys.argv[1:]): sys.exit('usage: mutation-test.py [M01 ... M22]')
    if OUT.exists(): sys.exit(f'refusing to overwrite existing evidence: {OUT.relative_to(ROOT)}')
    wanted, every = set(sys.argv[1:]), SUITES['core'] + SUITES['integration']
    results = [{'mutation': 'none (control)', **run_suite(every)}]
    for mid, defect, file, find, replace, killer, *suite in MUTANTS:
        if wanted and mid not in wanted: continue
        path = ROOT / file; original = path.read_bytes(); digest = sha(path); text = original.decode()
        edits = list(zip(find, replace)) if isinstance(find, list) else [(find, replace)]
        if any(text.count(f) != 1 for f, _ in edits): results.append({'id': mid, 'defect': defect, 'error': 'a target does not occur exactly once'}); print(mid, 'TARGET ERROR', flush=True); continue
        mutated = text
        for f, rep in edits: mutated = mutated.replace(f, rep)
        try:
            path.write_text(mutated); r = run_suite(SUITES[suite[0] if suite else 'core'])
        finally:
            path.write_bytes(original)
        restored = sha(path) == digest
        results.append({'id': mid, 'defect': defect, 'file': file, 'suite': suite[0] if suite else 'core', 'intendedKiller': killer, 'killed': r['failed'] > 0 or bool(r['suiteError']),
                        'killedForIntendedReason': any(killer in t for t in r['failingTests']), 'restored': restored, **r})
        print(mid, defect, 'KILLED' if results[-1]['killed'] else 'SURVIVED', 'intended' if results[-1]['killedForIntendedReason'] else 'NOT-intended', 'restored' if restored else 'NOT-RESTORED', flush=True)
    results.append({'mutation': 'none (after restore)', **run_suite(every)})
    OUT.parent.mkdir(parents=True, exist_ok=True); OUT.write_text(json.dumps(results, indent=2) + '\n')
    bad = [r for r in results if 'id' in r and not (r.get('killedForIntendedReason') and r.get('restored'))]
    controls = [r for r in results if 'mutation' in r]
    ok = not bad and all(c['failed'] == 0 and not c['suiteError'] for c in controls)
    print(json.dumps({'mutants': len([r for r in results if 'id' in r]), 'problems': [r.get('id') for r in bad], 'controlsPass': all(c['failed'] == 0 for c in controls), 'ok': ok}))
    sys.exit(0 if ok else 1)

if __name__ == '__main__': main()

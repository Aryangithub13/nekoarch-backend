import collections, hashlib, json, pathlib, re, statistics, subprocess
out=pathlib.Path('docs/phase22-evidence')
before=json.loads((out/'database-before.json').read_text());after=json.loads((out/'database-after.json').read_text())
rows={}
for table,old in before['tables'].items():
    new=after['tables'][table]
    missing=collections.Counter(old['rowDigests'])-collections.Counter(new['rowDigests'])
    rows[table]={'before':old['count'],'after':new['count'],'allOriginalRowsPreserved':not missing,'missingDigestCount':sum(missing.values())}
preservation={'tables':rows,'migrationHistoryUnchanged':before['migrationHistory']==after['migrationHistory'],'rlsUnchanged':before['rls']==after['rls'],'policiesUnchanged':before['policiesDigest']==after['policiesDigest']}
(out/'data-preservation.json').write_text(json.dumps(preservation,indent=2)+'\n')
assert all(x['allOriginalRowsPreserved'] for x in rows.values())
assert all(preservation[k] for k in ['migrationHistoryUnchanged','rlsUnchanged','policiesUnchanged'])
gates=json.loads((out/'verification.json').read_text())
assert len(gates)==22 and all(x['exitCode']==0 and x['sourceUnchanged'] for x in gates)
manifest=json.loads((out/'tested-source-sha256.json').read_text())
assert all(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==digest for p,digest in manifest.items())
previous=json.loads((out/'superseded-dispatch-gates/tested-source-sha256.json').read_text())
delta=[p for p in manifest if previous.get(p)!=manifest[p]]
assert delta==['apps/api/src/services/project-service.ts'],delta
bench=json.loads((out/'benchmark.json').read_text())
performance=[]
for name in dict.fromkeys(r['case'] for r in bench['measurements']):
    sample=[r for r in bench['measurements'] if r['case']==name]
    hashes={r['modelHash'] for r in sample if 'modelHash' in r}
    assert len(hashes)<=1
    performance.append({'case':name,'samples':len(sample),'medianFullMs':round(statistics.median(r['fullMs'] for r in sample),3),'medianGenerationMs':round(statistics.median(r.get('generationMs',r['fullMs']) for r in sample),3),'medianQaMs':round(statistics.median(r.get('qaMs',0) for r in sample),3),'candidateCount':sample[0].get('candidateCount'),'operations':sample[0].get('operations'),'outcome':sample[0]['outcome'],'stableHash':len(hashes)==1})
(out/'performance-summary.json').write_text(json.dumps(performance,indent=2)+'\n')
def counts(path):
    text=pathlib.Path(path).read_text()
    return ' / '.join(re.findall(r'Tests\s+(\d+) passed',text)) or ('51 pgTAP' if 'Tests=51' in text else '—')
order=['build','typecheck','lint','test:unit','test:generator','test:blueprint','test:blueprint-qa','test:solver-v2','test:projects','test:takeoff','test:construction','test:cost','test:workflows','test:interpretation','test:conversations','test:ai-orchestration','test:parametric','test:integration','test:supabase','db:test','check','benchmark:parametric']
testtable='\n'.join(f"| `{r['command']}` | 0 | {counts(r['log'])} | {r['seconds']:.3f} | [log]({pathlib.Path(r['log']).name if False else 'phase22-evidence/'+pathlib.Path(r['log']).name}) |" for name in order for r in gates if r['command']=='npm run '+name)
perftable='\n'.join(f"| {r['case']} | {r['medianGenerationMs']} | {r['medianQaMs']} | {r['medianFullMs']} | {r['candidateCount'] or '—'} | {r['operations'] or '—'} | {r['outcome']} |" for r in performance)
changed=set(subprocess.check_output(['git','diff','--name-only'],text=True).splitlines())|set(subprocess.check_output(['git','ls-files','--others','--exclude-standard'],text=True).splitlines())
changed|={'docs/phase22-review-report.md','docs/phase22-evidence/changed-files.json'}
(out/'changed-files.json').write_text(json.dumps(sorted(changed),indent=2)+'\n')
sourcefiles=[p for p in sorted(changed) if not p.startswith('docs/')]
filelist='\n'.join('- `'+p+'`' for p in sourcefiles)
maxrss=max(r.get('rssBytes',0) for r in bench['measurements'])
report=f'''# Phase 22 engineering review

**Classification: FULLY IMPLEMENTED AND VERIFIED**

This classification applies to the documented bounded L-shaped architecture family and the existing rectangular engines. U-shapes, enclosed courtyards, cantilevers, balconies and accessible terraces are explicitly unavailable. The implementation provides real occupied nonrectangular geometry and genuinely different supported floor footprints; it does not claim unrestricted architectural or structural feasibility.

## Repository baseline

Repository: `/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow`.
Independently observed initial state: branch `main`, HEAD `f39dbbc36325449979bcfe96dac434ba7ea61f82`, tag `backend-v1-phase21-complete`, clean working tree. The experimental NekoArch repository was not modified. No frontend, deployment, commit, staging, tag, push, reset, checkout, rebase or Phase 23 work was performed.

The [source audit and implementation matrix](phase22-audit.md) records the reusable systems, rectangular assumptions, QA gaps, integration boundaries and tests before implementation. The [design document](phase22-design.md) specifies the actual contracts, algorithm, lifecycle and limitations.

## Architecture reused and extended

Reusable Phase 1–21 functionality includes strict native room schemas, exact millimetre geometry, BigInt predicates, seeded ordering, integer partition reconciliation, wall interval splitting, opening jamb placement, straight stairs/landings, canonical V2 models, independent QA, signed immutable revisions, freshness/idempotency, workflows, quantities, material recipes, cost provenance and the conversation approval lifecycle.

The new `parametric-architecture-v1` path is selected only by explicit native `parametricArchitecture` requirements or explicit version dispatch. V1 remains the default; V2 remains its existing opt-in. An optional version-1 parameter submodel fits existing Building Model V2 geometry without changing historical documents. There is no new persistence system or database migration.

## Shape support

| Family | Status | Actual behavior |
|---|---|---|
| Rectangle | Supported | Historical V1/V2 paths; frozen geometry, metadata and hashes retained |
| L | Supported | Six-vertex connected footprint; occupied rooms in both wings; L circulation |
| Floor-specific L setback | Supported | Two nested L floor polygons, aligned stair, exact destination void and exposed lower roof plates |
| L/U-shaped site using original V2 | Supported as before | Original inscribed rectangular envelopes; no implicit parametric upgrade |
| U building | Unavailable | Explicit unsupported/strict-schema rejection |
| Enclosed courtyard/interior building holes | Unavailable | Rejected; no invented courtyard rooms or slabs |
| Balcony, cantilever, arbitrary floor offset | Unavailable | No upper overhang or unsupported projection accepted |
| Accessible terrace | Unavailable | Exposed lower coverage is a flat roof, with no terrace-use claim |

## Parameters, dependency handling and identity

Each floor has width, depth, west-wing width and south-wing depth in integer millimetres. The origin is shared. Dimensions, clear circulation, room program, relationships, walls, openings, floor height and stair parameters retain bounded native schemas.

Parameter changes produce a normalized copy and a full deterministic rebuild: footprints → room banks/circulation → walls/openings/stair → floor/roof plates → schema and independent QA. A finite pipeline replaces recursive mutations or a user-authored expression graph. Invalid/cyclic/oversized input fails before acceptance. Hard constraints are never traded against a soft score; preferred dimensions/relationships guide only feasible candidates.

Typed wing descriptors derive from persisted parameters, with stable parent/level IDs, reciprocal connections and parameter-rebuild semantics. Room IDs remain semantic type/ordinal identities. Walls and openings use geometry-addressed identities; changed physical intervals get new IDs. Floors, stairs and primary slabs retain semantic roles. No claim is made for general graph matching across arbitrary topology edits. Canonical geometry and hashes repeat across identical inputs; diagnostics/timing do not enter model identity.

## Floor model, room topology and circulation

Each actual floor polygon has its own slab. The allocator fills both L wings with rectangular occupied rooms and joins them through a single connected L circulation polygon. Each floor needs at least two rooms. Two-floor layouts reserve the common straight stair core, both landings, landing doors and the upper flight void. Upper polygons must be wholly contained in the lower footprint. This is geometric support validation, not structural engineering.

Wall intervals are unique and geometrically reconstructed. The verifier confirms complete space-edge coverage, exterior classification at concave boundaries, opening clearance, supported windows and valid real door/stair paths to every space. A score or claimed circulation graph is not accepted as evidence.

## Independent QA and adversarial evidence

The QA package has no generator dependency. It reconstructs expected footprints, inset coverage, room clearances, wall adjacency, actual hosted openings, corridor arms/elbow, stair access, slab support, stair voids and exposed roof coverage. BigInt area/cross-product calculations preserve exact topology within bounded integer coordinates.

New tests cover genuine L rooms, floor variation, controlled edits, seed/hash determinism, explicit unsupported families, site infeasibility, overhang rejection, impossible programs, resource exhaustion and cancellation. Adversarial mutations remove slabs/walls/doors, duplicate IDs, reverse winding, break parents/floor indices, move rooms/flights, fill stair voids, add holes, remove roofs and corrupt opening jambs. Malformed input covers crossing and zero-edge polygons, fractional/overflow dimensions, excessive complexity, cycles and unsupported overlapping/disconnected region declarations. The last two are rejected as unsupported input structures; arbitrary polygon-region assembly is not implemented.

Generated examples and independent PASS reports are available for [single-floor L](phase22-evidence/single-floor-L.json), [two-floor setback](phase22-evidence/two-floor-setback.json), [modified west wing](phase22-evidence/modified-west-wing.json) and [hard-connected rooms](phase22-evidence/hard-connected-rooms.json). These are generated geometry examples, not fabricated database receipts.

## Conversation and AI integration

A conversation on an existing parametric revision records solver `PARAMETRIC`. Typed user-only `nativeUpdate.parametricEdit` supports all four floor dimensions. The verified local grammar includes `Increase the ground floor west wing width to 10000 mm.` Other accepted variants are listed in the design document; broad natural-language architecture editing is not claimed.

The same project-scoped conversation state, exact changed fields, proposal hash/version/base/expiry and explicit approval control generation. Real PostgreSQL and local Supabase acceptance exercise concurrent approvals, immutable ancestry, owner isolation, stale-base rejection and downstream workflow execution. No accepted revision is modified in place.

Providers still cannot return native parametric edits, geometry, QA approval or accepted revisions through their strict intent schema. Phase 21 routing, registries, transport/privacy/cost limits, retry behavior and capability restrictions remain intact. Narrow static import allowlists were extended only for the new parameter schema/helper and QA adapter; no security or geometric assertions were disabled.

## Quantities, construction and cost

Hand-calculated checks establish ground slab 234 m², upper gross slab 188.5 m², stair void 4.2 m², total net floor slabs **418.3 m²**, exposed lower roof **45.5 m²**, all roof plates 234 m², ground exterior centerline 71.2 m, upper exterior centerline 63.2 m and floor slab volume 62.745 m³ at 150 mm thickness. Wall face area, stair risers, floor-specific totals and opening deductions use existing exact quantity machinery.

Parametric stair cores are excluded from ordinary occupied/finish floor-area bases. Their finish coverage is explicitly `NOT_EVALUATED`; flight and landing schedules remain available. Construction propagates this incomplete coverage, and cost retains partial status instead of inventing materials or prices. Wall junction segment-prism limitations and parking-cost limitations remain unchanged. Complete-building workflow acceptance reaches real takeoff, construction and cost artifacts with their honest partial coverage.

## Verification

All requested script equivalents exist and were run. Latest outcomes are below. Counts separated by `/` are separate invocations inside an aggregate script, not additive unique test totals. See [verification.json](phase22-evidence/verification.json) for exit codes, timings and source-manifest attribution.

| Command | Exit | Passed tests | Seconds | Evidence |
|---|---:|---:|---:|---|
{testtable}

The final aggregate `check` reruns the complete test suite as well as build, typecheck, lint, interpretation and conversations. The final affected HTTP/integration/Supabase gates were rerun after restoring historical direct V1/V2 dispatch. Earlier standalone passing gates differ only in that dispatcher call boundary; their precise manifest is retained. Each run's source hashes remained unchanged during execution. The final [source manifest](phase22-evidence/tested-source-sha256.json) was checked against the delivered source.

Initial failures are retained under superseded evidence, not hidden: import allowlists needed explicit new names; requirements hashing had to retain historical arbitrary-version salting; workflow/freshness spies required the original public V1 entry point. These were repaired without weakening assertions. The final targeted dispatch verification passed all 33 tests.

The final Docker image `designflow-api:phase22` built successfully. [Production smoke](phase22-evidence/docker-smoke.txt) verifies non-root runtime, liveness 200, dependency-failure readiness 503 and clean SIGTERM exit 0. [Container acceptance](phase22-evidence/docker-acceptance.txt) runs compiled production code with networking disabled, generates the two-floor L, independently verifies it, proposes/rebuilds a wing edit and checks quantities. Real persistence/RLS tests separately run against actual PostgreSQL and local Supabase, not an in-memory database.

## Performance and limits

Runtime: {bench['runtime']}, {bench['platform']}/{bench['arch']}. Three measured repetitions per case; exact individual observations are in [benchmark.json](phase22-evidence/benchmark.json). Median timings are milliseconds. RSS is a process observation rather than per-request allocation; highest sampled RSS was {maxrss} bytes ({maxrss/1048576:.1f} MiB). Heap deltas, per-stage normalization/layout/construction timing and deterministic hashes are retained in the raw results. Footprint validation is included in normalization; wall/slab/dimension construction is grouped rather than presented as independently isolated phase timings.

| Case | Generation | Independent QA | Full | Candidates | Charged work | Outcome |
|---|---:|---:|---:|---:|---:|---|
{perftable}

The reference V2 case uses a different rectangular room/search family; these observations are not a general speedup or equal-search-quality claim. No order-of-magnitude slowdown was observed in the tested bounded workloads. The maximum supported 24-room case was genuinely generated and independently verified. Repeated geometry hashes and failure codes were stable.

Limits remain two floors, 24 rooms, 32 site vertices, bounded candidate/work counts, 5000 input nodes/depth 12, up to 28 spaces, 200 walls and 32 slabs in parametric QA. A ten-second default execution deadline and cancellation checks supplement deterministic work limits. QA has its own geometry budget. Hard relationship infeasibility in this restricted two-bank family is not proof that all possible architectural layouts are impossible.

## Data preservation

All original public-table row digests were preserved, including **{rows['projects']['before']} projects and {rows['project_revisions']['before']} revisions**. Local acceptance added isolated fixture records according to the existing suite's retention behavior. Final counts are {rows['projects']['after']} projects and {rows['project_revisions']['after']} revisions. Migration history, RLS flags and policy digests are unchanged. See [data-preservation.json](phase22-evidence/data-preservation.json).

All 12 historical migration files and both checked historical fixture artifacts are byte-identical to baseline; [source-preservation.json](phase22-evidence/source-preservation.json) records their hashes. Existing V1 golden models, metadata and requirement/model hashes pass their frozen tests. The intentionally preserved historical Phase 19 tag was not rewritten.

## Changed files

The complete inventory, including every evidence artifact, is [changed-files.json](phase22-evidence/changed-files.json). Production, test, fixture and script changes:

{filelist}

Documentation adds the source audit, bounded design, this report, reproducible examples, benchmark data, logs, source manifests and database preservation evidence. All changes remain available for human review.

## Limitations and release readiness

This implementation supports the defined axis-aligned L family, a shared floor origin, rectangular occupied rooms, one L corridor per floor and one aligned straight stair. It does not support arbitrary connected-region placement, arbitrary room polygons, enclosed courtyard holes, U buildings, floor translations, rotations, overhangs, balconies, accessible terraces, freeform geometry, structural members, MEP or professional construction documentation. Automatic room allocation is bounded and can require explicit floor assignments. Stair finishes and existing unmodeled construction/cost categories remain incomplete.

All required acceptance conditions for the bounded L/setback vertical slice are demonstrated. Human code/design review and any desired release approval remain. Recommend the future tag `backend-v1-phase22-complete` **after approval**; it has not been created. No deployment or publication has occurred.

## Phase 23 readiness

The result provides explicit geometry, levels, physical plates/voids, semantic identities, deterministic rebuilding and immutable provenance that a future BIM adapter can consume. It is not BIM/IFC certification or engineering approval. Phase 23 implementation was not begun.
'''
pathlib.Path('docs/phase22-review-report.md').write_text(report)
print(json.dumps({'classification':'FULLY IMPLEMENTED AND VERIFIED','gates':len(gates),'allOriginalRowsPreserved':True,'changedFileCount':len(changed),'sourceManifestVerified':True}))

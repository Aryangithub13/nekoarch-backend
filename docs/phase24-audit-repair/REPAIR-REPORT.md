# Phase 24 audit repair — A01–A06

**Classification: ALL PHASE 24 AUDIT DEFECTS FIXED AND VERIFIED**

| | |
|---|---|
| Authoritative repository | `/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow` |
| Starting point | `d93aaa9d660ec5bc441188d768a46da98a2b52d6` = `backend-v1-phase24-complete` (tag unchanged; verified by gate `phase24-tag`) |
| Repair branch | `phase24/audit-repair` (from `d93aaa9`; nothing pushed) |
| Audit | Independent Phase 24 audit of 2026-10-06 (`AUDIT COMPLETE — MAJOR DEFECTS FOUND`, 3 × P1, 3 × P2). Its report and probes were left in `/tmp/nekoarch-independent-audit/` by that session; the same probes and inputs are re-run here by `reproduce-audit.mts`. |
| Partial copy | `/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow (Copy)`: uncommitted edits to five structural files at `d93aaa9`, no tests. Used as reference only; nothing copied wholesale. |
| Untouched | `docs/backend-repair-1-23/`, `docs/phase24/evidence/final/phase23/fixtures/` (digests checked around every gate), migrations `0001`–`0014`, Phase 23 and Phase 24 evidence |

## Verdicts

| ID | Sev. | Finding | Verdict |
|---|---|---|---|
| A01 | P1 | Result validation accepted incompatible displacements and wrong stiffness distributions | **FIXED AND VERIFIED** |
| A02 | P1 | Fabricated interior force stations passed validation | **FIXED AND VERIFIED** |
| A03 | P1 | Same-plane crossing beams silently disconnected | **FIXED AND VERIFIED** (rejected as ambiguous unless a node exists at the crossing) |
| A04 | P2 | Valid fully restrained systems rejected | **FIXED AND VERIFIED** |
| A05 | P2 | Supported-size input expanded past an internal limit → HTTP 500 | **FIXED AND VERIFIED** (typed 422 preflight on `/validate` and `/analyses`) |
| A06 | P2 | Contradictory section description / mass status passed validation | **FIXED AND VERIFIED** |

Evidence: `evidence/reproductions.json` (24 probes, all PASS on the repaired source) against `evidence/reproductions-baseline-d93aaa9.json` (the same probes on `d93aaa9`: exactly the 13 defect probes fail, all 11 counter-controls pass).

## Review of the partial copy

| Copy change | Defect | Root cause? | Complete? | Regression? | Decision |
|---|---|---|---|---|---|
| `frame-solver.ts`: remove `n === 0` throw | A04 | Yes | Yes | No — derivation checked: U = 0, element forces = fixed-end actions, reactions = Tᵀf, residual trivially 0 | **Ported** (comment rewritten) |
| `contracts.ts` `EXPANDED_MEMBER_LOADS`; `model.ts` per-case expansion preflight | A05 | Yes | Yes | No | **Ported** (message now states the derived count) |
| `validate.ts` mass status in the density branch; section shape/dimension/method comparison | A06 | Yes | Nearly | No | **Ported**, plus section and material request-key agreement |
| `model.ts` builder crossing rejection | A03 | Partly | No | **Yes**: also rejected crossings that *are* connected because a third member ends at the intersection (both members are split there) | **Rewritten**: rejects only when no node exists at the crossing |
| `validate.ts` crossing check on members | A03 | Partly | No | **Yes**: same false rejection; it inspected members, not the analysis graph | **Rewritten** on segments: two segments may touch only at a node both end at |
| `validate.ts` station loop | A02 | Yes | No | No | **Rewritten tolerance**: the copy scaled the tolerance by the very stations being checked |
| `validate.ts` constitutive relations | A01 | Yes | No | No | **Ported** (all six relations re-derived and confirmed) and **extended**: zero reactions on unrestrained DOFs (otherwise a fabricated pin moment with matching end moments can pass), combination superposition |
| `analysis.ts` raw J-end statics | A01/A02 | Yes | Yes | Tolerance defect: one scale mixed N with N·mm and multiplied by L in mm (≈ 300 kN slack on the authored frame) | **Rewritten** with separate force and moment scales |
| — | — | — | The copy added no tests and kept the v1 validator labels although validation semantics changed | — | Tests and v2 labels added |

## Findings

### A01 — results must be the elastic solution (P1)

- **Reproduced** on `d93aaa9`: free node `uy = 1e12 mm, rx = 1e9 rad` → VALID; a solution of the frame with beam `Iy, Iz × 100`, relabelled with the true analysis-model hash → VALID; raw J-end forces `1e20` → accepted (results are built from the I end only).
- **Counter-controls** (pass on both sources): restrained-DOF corruption, raw NaN / wrong hash / wrong units / missing case → rejected.
- **Root cause**: `validateStructuralResults` checked references, restrained displacements and global/segment/joint equilibrium, but nothing tied displacements or the force distribution to stiffness. Equilibrium alone cannot determine a statically indeterminate response.
- **Fix** (`validate.ts`, `analysis.ts`): per segment and result set, six closed-form integrals of the reported station diagram with the member's own E, G = E/2(1+ν), A, Iy, Iz, J must reproduce the relative end displacements and rotations — EA·Δu = ∫N, GJ·Δθx = ∫T, EIz·Δθz = ∫Mz, EIz(Δv − θz,I·L) = ∫(L−x)Mz, EIy·Δθy = ∫My, EIy(Δw + θy,I·L) = −∫(L−x)My — each to 1e-6 of its largest term (N, mm, rad). Together with station, joint and support checks this is the complete set of conditions whose solution is unique for a stable structure. Reactions on unrestrained DOFs must be exactly zero. Combinations must equal the superposition of their cases (1e-9 relative). The raw boundary checks J-end element statics with separate force (N) and moment (N·mm) scales. The validator still imports nothing from `model.ts`, `analysis.ts` or the solver and uses no stiffness matrix.
- **Tests**: each of the 6 displacement components at a free node in a load-case and a combination set; rotation at every free node and at a cantilever tip (tip deflection wL⁴/8EI and rotation wL³/6EI asserted as independent closed forms); the audit probe; swapped rows; scaled field; the 100× stiffness forgery (asserting that its global equilibrium residuals are within tolerance, i.e. what v1 accepted); raw J-end per index; a statics-preserving end-moment pair; corrupted combination; pinned-end reaction moment (propped-cantilever closed forms 3wL/8, 5wL/8, wL²/8); PostgreSQL/API: a forged free displacement from the adapter returns 422 `STRUCTURAL_RESULT_INVALID` and persists nothing.

### A02 — every station is checked (P1)

- **Reproduced**: all six components at station 0.5 set to ±1e12 → VALID.
- **Counter-control**: end station `mz + 10` → INVALID on both sources.
- **Root cause**: only stations 0 and 1 entered the force equations; interior stations only inflated the tolerance.
- **Fix**: every station is cut-balanced against the I-end values and the uniform member load; tolerances come from trusted scales only: 1e-6 × Σ|applied load| (kN) and × model extent (kN·m).
- **Tests**: every component at stations 0.25/0.5/0.75 in all four sets (72 mutations); the audit probe; a linear moment curve that matches both ends of a uniformly loaded beam.

### A03 — same-plane crossings (P1)

- **Reproduced**: an accepted revision with beams crossing at (6000, 3000, 3000) → two components, VALID, persisted (HTTP 201); reactions 15 / 0 kN instead of 7.193 / 7.807 kN when the wall is split.
- **Root cause**: nodes came only from member endpoints and splitting scanned only that inventory, in both builder and validator.
- **Decision**: structural-model-v1 has no input that distinguishes a rigid joint from a pass-by, so an unresolved crossing is **rejected** (`STRUCTURAL_MODEL_INVALID`, 422 on `/validate` and `/analyses`) and never inferred. A crossing *is* connected, as before, when a node exists there (a wall split there, or a third member's endpoint): splitting then shares that node. T and corner junctions are unchanged. None of the seven native fixtures contains an unresolved crossing, so no fixture changed.
- **Tests**: X crossing in both member orders and both directions; T and corner; crossing resolved by a third member; split wall reproducing the audit counter-control reactions 7.192733544 / 7.807266456 kN (sum 15); validator rejects a hand-built unconnected model with exactly one diagnostic (`Segments intersect away from a shared node`) and a model fabricating a crossing node; storey-to-storey plan crossings on the setback fixture stay separate and VALID; API returns 422 with no rows.

### A04 — fully restrained systems (P2)

- **Reproduced**: fixed–fixed beam → `/validate` 200, `/analyses` 422 `STRUCTURAL_SUPPORT_INVALID`.
- **Root cause**: an unconditional `n === 0` guard conflated an empty reduced system with instability.
- **Fix**: guard removed; the fixed-end recovery and every result check apply unchanged. Mechanisms are still rejected by the pivot test.
- **Tests**: fixed–fixed beam with gravity, lateral and axial line loads and a combination (wL/2, wL²/12 per direction, zero displacements); all-fixed frame with a point load on a restrained node; pinned–pinned beam still `STRUCTURAL_SYSTEM_UNSTABLE`; API 201 with v2 validation.

### A05 — derived expansion (P2)

- **Reproduced**: 142 KB request, 1,000 uniform loads on a beam split into 8 segments → `/validate` 200, `/analyses` 500 (unmapped `ZodError`: 8,000 > 6,000).
- **Root cause**: public limits count semantic loads; the analysis model holds one entry per load per segment (plus self-weight per segment), and its schema limit was not preflighted.
- **Fix**: `EXPANDED_MEMBER_LOADS` (= totalLoads + segments = 6000) is the single source for the schema bound and a per-case preflight in `buildStructuralModel`, so `/validate` and `/analyses` agree and fail with `STRUCTURAL_RESOURCE_LIMIT` (422) before any solver work. Aggregating loads was rejected because it would change the analysis-model hash of existing inputs.
- **Tests**: 750 × 8 = 6000 analyses, 751 → 6008 rejected; with self-weight 5999 accepted, 6007 rejected; the audit request; API 422 on both routes with redacted body and no rows, the limit itself 201.

### A06 — section and mass consistency (P2)

- **Reproduced**: rectangle 9999 × 1 mm with original properties → VALID; rectangle relabelled GENERIC with null dimensions → VALID; evaluated mass relabelled NOT_EVALUATED → VALID.
- **Root cause**: partial comparison — numeric properties and provenance only; the density-present branch checked only the mass number.
- **Fix**: shape, dimensions, per-property derivation method and request key must match the input-derived section; mass must be `EVALUATED` with the density-derived value when density is given, `NOT_EVALUATED`/null otherwise. Kept in the independent validator; the persisted snapshot schema is not tightened, so historical snapshots read exactly as before.
- **Tests**: eight contradictions rejected; legitimate GENERIC section and density-free NOT_EVALUATED mass remain VALID, and their own contradictions are rejected.

## Compatibility

- **Migrations**: unchanged — no new migration; `0001`–`0014` byte-identical to `d93aaa9` (gate `historical-artifacts-unchanged`).
- **Historical hashes**: unchanged. For all seven native fixtures, architectural model hash, structural model digest, input hash, analysis-model hash and result digest are bit-identical between `d93aaa9` and the repair (`evidence/structural-identity-baseline-vs-repaired.json`). Phase 23 IFC byte-identical and model/BIM identical to the committed Phase 23 evidence (gate `phase23-architecture-identical`).
- **Versions**: `structural-model-v1`, `structural-analysis-v1`, solver `nekoarch-reference-frame-3d 1.0.0` and `structural-adapter-v1` unchanged — accepted inputs produce identical output; the only solver change accepts a previously rejected case. New snapshots record `structural-model-validator-v2` / `structural-result-validator-v2`; v1 snapshots stay readable and keep the label they were certified with. Re-submitting an input already analysed before the repair returns that existing row (unique per revision and input hash), which the reference solver computed correctly per the audit's numerical verification.
- **Scope**: `DESIGN_VERIFICATION = NOT_EVALUATED` and the bounded linear-static frame scope unchanged.

## Verification (frozen source)

Runner `python3 docs/phase24-audit-repair/verify-repair.py`; record `evidence/final/verification.json`; tested-source manifest `evidence/final/tested-source-sha256.json` (356 files, sha256 `d0e4fddd7037e2eca1626ce9e8b60ada5ba005098797c49e7f597787b9141546`). The manifest is re-hashed before and after every gate, as are the two untouched directories. **41/41 gates exit 0; `sourceUnchanged` and `untouchedDirectoriesUnchanged` true for all.**

| Gate | Exit | Seconds | Result |
|---|---|---|---|
| `git rev-parse 'backend-v1-phase24-complete^{commit}'` | 0 | 0.028 | tag resolves to d93aaa9 |
| `node --import tsx docs/phase24-audit-repair/reproduce-audit.mts` | 0 | 0.382 | 24/24 probes PASS (baseline d93aaa9: 13 fail) |
| `python3 scripts/test-phase23-runner.py` | 0 | 0.132 | runner failure propagation |
| `npm run build` | 0 | 13.66 |  |
| `npm run typecheck` | 0 | 20.073 |  |
| `npm run lint` | 0 | 3.941 |  |
| `npm run test:unit` | 0 | 50.09 | 1990 passed (1990) |
| `npm run test:generator` | 0 | 16.92 | 526 passed (526) |
| `npm run test:blueprint` | 0 | 7.95 | 137 passed (137) |
| `npm run test:blueprint-qa` | 0 | 15.068 | 198 passed (198) |
| `npm run test:solver-v2` | 0 | 26.342 | 40 passed (40) |
| `npm run test:parametric` | 0 | 20.127 | 36 passed (36) |
| `npm run test:projects` | 0 | 20.579 | 23 passed (23) |
| `npm run test:takeoff` | 0 | 23.082 | 23 passed (23) |
| `npm run test:construction` | 0 | 19.623 | 34 passed (34) |
| `npm run test:cost` | 0 | 21.776 | 39 passed (39) |
| `npm run test:workflows` | 0 | 21.126 | 51 passed (51) |
| `npm run test:interpretation` | 0 | 18.019 | 133 passed (133) |
| `npm run test:conversations` | 0 | 19.875 | 52 passed (52) |
| `npm run test:ai-orchestration` | 0 | 19.124 | 120 passed (120) |
| `npm run test:integration` | 0 | 73.195 | 206 passed (206) |
| `npm run test:bim` | 0 | 27.093 | 41 passed (41) |
| `npm run test:structural` | 0 | 25.334 | 129 passed (129) |
| `npm run test:supabase` | 0 | 85.769 | 92 passed (92) |
| `npm run db:test` | 0 | 2.737 | pgTAP rls.sql ok |
| `npm run check` | 0 | 195.569 | 2238 passed (2238); 133 passed (133); 52 passed (52) |
| `python3 docs/phase24-audit-repair/mutation-test.py` | 0 | 183.35 | 14/14 mutants killed, sources restored |
| `node --import tsx --input-type=module -e 'process.chdir("/tmp/designflow-phase24-repair-ve` | 0 | 2.238 | 7 families regenerated (temporary tree) |
| `/tmp/designflow-phase23-ifc/bin/python /home/aryan/Documents/Codex/2026-09-12/bu/outputs/d` | 0 | 69.641 | IfcOpenShell 7 families |
| `/tmp/designflow-phase23-ifc/bin/python /home/aryan/Documents/Codex/2026-09-12/bu/outputs/d` | 0 | 0.687 | profile verification |
| `python3 docs/phase24-audit-repair/verify-repair.py --architecture /tmp/designflow-phase24-` | 0 | 0.133 | 7/7 IFC byte-identical, model/BIM identical |
| `sh -c 'git diff --exit-code d93aaa9d660ec5bc441188d768a46da98a2b52d6 -- supabase/migration` | 0 | 0.027 | migrations 0001–0014, Phase 23/24 evidence vs d93aaa9; no new migration |
| `sh -c '! grep -rnE "from '"'"'\.\./(ai|workflows)/" apps/api/src/structural apps/api/src/s` | 0 | 0.024 | no ai/ or workflows/ imports |
| `docker build -t designflow-api:phase24-audit-repair .` | 0 | 54.352 | designflow-api:phase24-audit-repair |
| `node scripts/smoke-container.mjs designflow-api:phase24-audit-repair` | 0 | 1.437 | non-root, liveness 200, readiness 503, SIGTERM 0 |
| `docker run --rm --network none --entrypoint sh designflow-api:phase24-audit-repair -c 'tes` | 0 | 0.385 | compiled v2 validator, no dev deps |
| `docker run --rm -i --network none designflow-api:phase24-audit-repair node --input-type=mo` | 0 | 0.986 | --network none, VALID_WITH_INCOMPLETE_DATA |
| `docker run --rm -i --network none designflow-api:phase24-audit-repair node --input-type=mo` | 0 | 0.635 | --network none, tip −11.249999999999993 mm vs −11.25 |
| `python3 docs/phase24-audit-repair/snapshot-local-db.py database-after-verification` | 0 | 2.491 | local Supabase digest |
| `python3 docs/phase24-audit-repair/verify-repair.py --preserved` | 0 | 0.086 | 0 missing pre-existing rows; RLS on; policies, migrations unchanged |
| `git diff --check` | 0 | 0.033 | clean |

Test-count deltas against the Phase 24 release run: `test:unit` 1949 → 1990, `test:structural` 84 → 129, `test:integration` 202 → 206, `check` 2193 → 2238; every other suite unchanged. Live Supabase: 92 passed (Phase 23 and 24 acceptance included).

**Database preservation** (local Supabase, `evidence/database-before.json` → `evidence/database-after-verification.json`): all pre-existing row digests in every table present afterwards, including the 9 pre-repair Phase 24 structural analyses; RLS enabled on all 17 tables; policy digest unchanged; migration history 0001–0014 unchanged (no migration applied).

## Mutation testing

`python3 docs/phase24-audit-repair/mutation-test.py` (structural unit + PostgreSQL suites per mutant; byte-identical restore verified), `evidence/mutation-testing.json`:

| Planted defect | Failing tests | Restored |
|---|---|---|
| A01 fabricated displacement: translation relations dropped | 8 / 129 | True |
| A01 fabricated rotation: rotation relations dropped | 1 / 129 | True |
| A01 fabricated endpoint force: raw J-end statics removed | 1 / 129 | True |
| A01 reaction on unrestrained DOF accepted | 1 / 129 | True |
| A01 combination superposition removed | 1 / 129 | True |
| A02 fabricated interior stations: only end stations checked | 2 / 129 | True |
| A02 wrong force curve in production result recovery | 31 / 129 | True |
| A03 missing crossing connection: builder accepts unconnected crossing | 1 / 129 | True |
| A03 missing crossing connection: validator crossing check removed | 1 / 129 | True |
| A03 fabricated crossing connection: builder silently inserts a joint | 2 / 129 | True |
| A04 valid fully restrained system rejected again | 3 / 129 | True |
| A05 derived resource expansion not preflighted | 3 / 129 | True |
| A06 contradictory mass status accepted | 1 / 129 | True |
| A06 contradictory section description accepted | 6 / 129 | True |

Controls before and after: 0 failures. **14/14 killed.**

## Performance

Audit near-limit grids (8 cases, 16 combinations, self-weight; single samples, not SLOs), `evidence/benchmark-near-limit.json`:

| Grid | Nodes | Segments | Result sets | Solver ms | Model validation ms (d93aaa9 → repair) | Result validation ms (d93aaa9 → repair) | Snapshot bytes |
|---|---|---|---|---|---|---|---|
| 8 | 140 | 189 | 24 | 44.9 | 103 → 95 | 88 → 182 | 6010261 |
| 9 | 174 | 238 | 24 | 54.1 | 129 → 135 | 110 → 235 | 7554170 |
| 10 | 212 | 293 | 24 | 46.0 | 181 → 192 | 131 → 316 | 9278458 |

Grid 10 exceeds the 9 MB snapshot limit in both versions (typed `STRUCTURAL_RESOURCE_LIMIT`), as the audit recorded.

## Failures encountered during the repair

1. Three new tests were wrong on first run (a diagonal "corner" wall; result sets assumed in request-key order instead of id order; `toBe(0)` against `-0`). Fixed in the tests; no production change.
2. First mutation run killed 13/14: dropping the pure-rotation constitutive relations survived, because every perturbed node was also the I-end of some segment, where the deflection relations still see θ. Added the cantilever-tip and every-free-node rotation regression; the mutant is now killed (`evidence/mutation-testing-initial-13of14.json` kept).
3. The first reproduction-script draft double-wrapped raw counter-controls; fixed in the script.

## Changed files

Source: `apps/api/src/structural/{analysis,contracts,frame-solver,model,validate}.ts`. Tests and fixtures: `apps/api/tests/structural.test.ts` (+41), `apps/api/tests/structural.integration.test.ts` (+4), `test-support/structural-fixtures.ts`. Docs: `docs/phase24/phase24-{api,design}.md` (amendment sections), `docs/phase24-audit-repair/` (this report, `reproduce-audit.mts`, `mutation-test.py`, `verify-repair.py`, `snapshot-local-db.py`, `evidence/`). No migration, no Phase 23 file, no historical evidence changed.

## Known limitations

- Unresolved same-plane crossings are rejected, not modelled: a user who wants a connection must split a wall at the crossing (or end another mapped member there). An explicit connection/pass-by input would need a new structural input version.
- Validation tolerances are relative (1e-6). A fabrication smaller than that relative to the governing terms is numerically indistinguishable and is accepted by design.
- Reactions on unrestrained DOFs must be exactly zero; a future external adapter that reports round-off there would be rejected and must zero them.
- Result validation cost rose ~2.4× on the largest audit grid (≈ 130 → 320 ms); still far inside the 10 s solver budget.
- Rows created before the repair remain labelled v1; they are not revalidated.

## Commands

```
git switch -c phase24/audit-repair                      # from d93aaa9
node --import tsx docs/phase24-audit-repair/reproduce-audit.mts
python3 docs/phase24-audit-repair/snapshot-local-db.py database-before
python3 docs/phase24-audit-repair/mutation-test.py
python3 docs/phase24-audit-repair/verify-repair.py      # every gate, frozen manifest
```

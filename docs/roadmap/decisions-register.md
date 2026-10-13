# Decisions register

**Baseline 2026-10-13 (r3).** Holds owner decisions, open questions and deferred scope. Each entry carries a date, a source and an evidence class ([README §1](README.md)). "Owner brief" means an instruction given directly to the implementing assistant in its session. Such briefs are CONFIRMED as instructions; their content is not independently verified.

## 1. Decisions on record

| # | Date | Decision | Source | Class |
|---|---|---|---|---|
| OD-01 | 2026-10-12 | Phase 35 scope of record is briefs R1–R8 as delivered. Solvers and research values (R2/R8) are explicitly unsupported | PR #7 description, "Scope of record (owner decision, 2026-10-12)" | REPORTED |
| OD-02 | ≤ 2026-10-12 | Phase 30 frontend integration verification is deferred until the owner authorizes it or until the end-of-project audit | Roadmap §2 item 10; PR #7 "Not verified" | REPORTED |
| OD-03 | 2026-10-13 | Phase 36 is the **Cloud Engineering Compute Gateway**. The conversational-AI work is a separate workstream, preserved and unmerged | Owner brief (scope correction); roadmap §4.1 | CONFIRMED |
| OD-04 | 2026-10-13 | The reconstructed roadmap and research files are working references only. The owner draft is archived verbatim. Reconstructions are never presented as originals | Owner brief (integration handoff); roadmap header | CONFIRMED |
| OD-05 | 2026-10-13 | First Phase 36 slice authorized, as listed after this table | Owner brief (implementation authorization) | CONFIRMED |
| OD-06 | 2026-10-13 | Finalization: close test gaps and assemble evidence. No merge, tag, deploy, PR or hosted migration under that authorization | Owner brief (finalization) | CONFIRMED |
| OD-07 | 2026-10-13 05:15:57Z | **The owner merged PR #10** (Phase 36 gateway) into `phase31/development` | GitHub (PR #10 `merged_by: Aryangithub13`) | CONFIRMED as an action. No accompanying statement of acceptance was found |
| OD-08 | 2026-10-13 | Master directive. The reconciled roadmap is provisional authority. Frontend (F) and backend (B) numbering stay separate. Phase 40 is the comprehensive backend audit. Genuine security and data-integrity defects are not deferred to Phase 40. No merge, tag, deploy, hosted migration or destructive Git action | Owner brief (master directive) | CONFIRMED |

**OD-05, the authorized first slice:**
- base `phase31/development`, on a dedicated branch;
- local adapters only, with remote disabled and fail-closed;
- polling only;
- no new credentials, callbacks or recovery role;
- explicit consent, where a quote is not authorization;
- existing job kinds only after inspection, and no solver kinds;
- `REQUIRES_SOLVER` and `NO_VALIDATED_SOLVER` preserved;
- for the Node 22.22.0 worker issue, only the smallest isolated fix.

## 2. Open questions requiring an owner decision

Ordered by urgency.

| # | Question | Why it matters | Options | Recommendation (PROPOSED) |
|---|---|---|---|---|
| Q1 | **Restore a green typecheck on the default branch** | `phase31/development` fails `npm run typecheck` (TS2532 in `apps/api/tests/compute.integration.test.ts:253`, CONFIRMED). Any PR based on it fails CI | (a) authorize a one-line fix branch and PR; (b) apply it directly | (a). A new branch from `5476f41` changing only that line, with the full checks and a PR opened for the owner to merge |
| Q2 | **CI coverage and PR #7** | Default-branch CI runs subsets that skip the gateway, jobs, account, references and verification tests, and never runs on pushes to `phase31/development`. PR #7 fixes both but now conflicts (2 additive files) | (a) resolve PR #7's conflicts, re-run CI, merge; (b) port only the workflow change | (a). It also lands the approved B35 completion |
| Q3 | **`phase36/conversational-ai`** | Its `0025` collides with the merged `0025_compute_gateway.sql`; it also conflicts in 2 files | Keep it (renumber to `0026`, resolve, and assign it a roadmap phase), park it, or close it | Decide the roadmap slot first (it is not B36). Renumber only when merging is authorized |
| Q4 | **Roadmap authority** | r2/r3 is provisional; the §3.1 label conflicts (Phases 32, 35, 38, 41, 43–45) are unresolved | Accept r3 as the working authority, or correct it | Accept r3 provisionally and rule on the §3.1 conflicts before Phase 38 |
| Q5 | **Phase 36 later slices** | D1–D7 and G7, G8, G12 (roadmap §4.2–4.3) are undecided | — | No change until a provider, budget unit and privacy policy are chosen (D1, D4, D7) |
| Q6 | **Hosted database** | Hosted state is REPORTED at `0017`; `0018`–`0025` are pending | A read-only state check by an authorized operator, then staging, then production | Do the read-only check first; no hosted change without explicit authorization |
| Q7 | **Shared conversations** | None of the three links could be read (README §3.1) | Allow the hosts in the environment's network settings, or commit exports to `docs/sources/` | Commit exports. Share pages may not render without JavaScript |
| Q8 | **Stale Phase 36 report on the default branch** | `docs/phase36/phase36-report.md` says its verification is "Pending" | Update it alongside the Q1 fix | Same branch as Q1 |
| Q9 | **Phase 37 scope** | Phase 37 is only a REPORTED later-phase assignment ("unified multidisciplinary dependency graph and freshness propagation") | Confirm, correct or replace | Owner confirmation before any implementation |

## 3. Deferred and excluded scope

| Item | Status | Source |
|---|---|---|
| Phase 30 frontend integration verification | Deferred | OD-02 |
| Remote, metered or paid execution; callbacks; background recovery role; new DB credentials | Excluded from the Phase 36 first slice | OD-05 |
| Solver execution; fan-out/fan-in; checkpoints | Excluded pending research, validation evidence and a separate plan | OD-05; roadmap G7, G12 |
| Validated wind, seismic, lateral, drift, dynamic, soil, foundation, member-design, lift-traffic and tall-building egress solvers | Explicitly unsupported | OD-01 |
| Built-in cost rates, location or CPWD factors | Not provided; caller-supplied sourced rates only | OD-01; PR #7 |
| Release tags for Phases 31–36 | None created; no authorization on record | Tags (README §3.3) |

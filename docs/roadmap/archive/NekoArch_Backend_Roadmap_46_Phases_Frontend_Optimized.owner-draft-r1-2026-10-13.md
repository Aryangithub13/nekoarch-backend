# NekoArch Backend Roadmap — 46 Phases (Reconstructed Working Draft)

> **Document status: RECONSTRUCTED WORKING DRAFT — NOT THE RECOVERED ORIGINAL ROADMAP**
>
> Created: 2026-10-13  
> Repository context: `Aryangithub13/nekoarch-backend`  
> Intended use: persistent planning source for Claude Code and project owners  
> Approval state: owner review required before this document is treated as authoritative.
>
> The original file `NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md` was reported missing from all inspected repository refs and local search locations. This file is a practical reconstruction from the Phase 36 reconciliation report, supplied project context, and explicit owner policies. It does **not** claim to reproduce the original wording or all original phase assignments.

## 1. How to use this file

Claude Code and other assistants must read this file before proposing or implementing a new NekoArch backend phase.

For each requirement, distinguish:
- **CONFIRMED** — supported by the supplied reconciliation report or explicit owner-established project context.
- **REPORTED** — described in repository/report evidence, but not independently verified in this document.
- **PROPOSED** — a planning recommendation created for continuity; it requires owner acceptance.
- **UNKNOWN** — the original phase scope, acceptance criteria, or exact requirements could not be recovered.

Do not silently convert PROPOSED or UNKNOWN content into an official requirement. Keep original repository names and identifiers such as `designflow` where compatibility requires them, while using **NekoArch** as the product name.

## 2. Project-wide constraints

1. **Bootstrapped deployment:** the normal backend must work on ordinary hosting and should not require a high-end inference/rendering server.
2. **External compute:** expensive inference, rendering, or solver work may be delegated to configured providers or optional on-demand compute, with bounded budgets and explicit controls.
3. **Bounded requests:** enforce input size, runtime/deadline, concurrency, retries, cancellation, quotas, and cost ceilings appropriate to each capability.
4. **Honest engineering status:** an AI/provider result is not automatically a validated engineering result. Preserve evidence classifications and disclose unsupported capabilities.
5. **No invented research:** never fabricate standard editions, clause numbers, equations, loads, cost factors, solver-validation results, or professional sign-off.
6. **Compatibility first:** inspect existing API contracts, database schema/migrations, auth, idempotency, revision fencing, jobs, OpenAPI generation, and tests before changing them.
7. **Safe phase boundaries:** use a dedicated branch and reviewable commits for each phase; verify base ancestry rather than assuming it.
8. **No release action without owner approval:** do not merge, tag, deploy, or apply hosted migrations unless explicitly authorized.
9. **No perfection loops:** implement the agreed phase scope, test it honestly, record limitations, and move forward unless a genuine security, data-loss, integrity, or phase-blocking defect is found.
10. **Phase 30 frontend integration verification:** remains deferred until the owner explicitly authorizes it or the end-of-project audit.
11. **Independent review:** track review as pending when pending; do not block separate safe development indefinitely solely because a review is pending.
12. **Branch protection:** never reset, rewrite, force-push, delete, or overwrite another workstream unless the owner explicitly instructs it.

## 3. Phase index (46 slots)

The index deliberately preserves uncertainty. A phase slot marked UNKNOWN is not a license to invent its scope. Recover the original roadmap from the owner or another authoritative source and replace the placeholder only after recording provenance.

| Phase | Working title / area | Status of scope | Dependencies / notes |
|---:|---|---|---|
| 1 | Backend foundation and repository conventions | UNKNOWN — recover original scope | Preserve existing released baseline and conventions |
| 2 | API and service foundation | UNKNOWN — recover original scope | Verify existing contracts before changes |
| 3 | Authentication and authorization foundation | UNKNOWN — recover original scope | Security-sensitive; inspect actual implementation |
| 4 | Core data model and persistence | UNKNOWN — recover original scope | Schema changes require migrations and upgrade tests |
| 5 | Project lifecycle foundation | UNKNOWN — recover original scope | Do not infer endpoints |
| 6 | Input validation and error contracts | UNKNOWN — recover original scope | Follow existing schema conventions |
| 7 | Core project APIs | UNKNOWN — recover original scope | Check OpenAPI and API drift |
| 8 | Persistence and consistency hardening | UNKNOWN — recover original scope | Idempotency and concurrency where applicable |
| 9 | Access-control and ownership checks | UNKNOWN — recover original scope | Must be tested against unauthorized access |
| 10 | Initial test and regression infrastructure | UNKNOWN — recover original scope | Reuse actual scripts and CI configuration |
| 11 | Asset / artifact foundations | UNKNOWN — recover original scope | Verify B31 artifact conventions before reuse |
| 12 | Generation workflow foundations | UNKNOWN — recover original scope | Do not imply AI generation is deterministic |
| 13 | Revision / version foundations | UNKNOWN — recover original scope | Preserve stable identifiers and revision semantics |
| 14 | Capability validation and bounded execution | UNKNOWN — recover original scope | Exact assignment unavailable |
| 15 | API reliability and observability | UNKNOWN — recover original scope | Avoid logging secrets or private payloads |
| 16 | Provider integration foundations | UNKNOWN — recover original scope | Provider policy must be explicit |
| 17 | Generation / orchestration expansion | UNKNOWN — recover original scope | Avoid duplicating later capabilities |
| 18 | Integration and reliability hardening | UNKNOWN — recover original scope | Exact assignment unavailable |
| 19 | Pre-conversation workflow hardening | UNKNOWN — recover original scope | Exact assignment unavailable |
| 20 | AI orchestration / provider policy | REPORTED — released tag `backend-v1-phase20-complete` | Verify tag and contracts in repository |
| 21 | AI orchestration / provider policy continuation | REPORTED — released tag `phase21-complete` | Existing privacy class, metered flag, host allowlist, circuit breaker and key-by-env-name patterns reported |
| 22 | Durable jobs / adjacent platform foundation | REPORTED — migration `0022` is present in `phase31/development` | B32 dependency as described in reconciliation report |
| 23 | Structural frame solver (limited) | REPORTED — released Phase 24 solver exists; phase mapping uncertain | Do not relabel the Phase 24 solver as Phase 23 without source evidence |
| 24 | Limited structural frame solver | REPORTED — released `structural/frame-solver.ts` | Linear-static scope only, per reconciliation report |
| 25 | Additional backend capability | UNKNOWN — recover original scope | No exact scope inferred |
| 26 | Additional backend capability | UNKNOWN — recover original scope | No exact scope inferred |
| 27 | Additional backend capability | UNKNOWN — recover original scope | No exact scope inferred |
| 28 | Backend release / capability milestone | REPORTED — tag `backend-v1-phase28-complete` | Historical user-reported release; verify tag before relying on it |
| 29 | Modernization / API contract documentation | REPORTED — modernization branch/tag reported | OpenAPI generation reported; verify current tree |
| 30 | Selective revision / regeneration and preservation | CONFIRMED from owner-established context | Preserve locked plans, structure, rooms, stairs, dimensions and interior when exterior/glass façade is changed; stable IDs/hashes; dependency preflight. Frontend integration verification is deferred |
| 31 | Reference artifacts and backend compatibility | REPORTED — migration `0021`/`0024` and other B31 references appear in reconciliation report; phase numbering is not fully aligned | Inspect actual docs and migration history; do not infer from phase number alone |
| 32 | Site & Plot Workspace backend support | CONFIRMED from owner-established context | Plot dimensions/area/shape/property details, boundary/orientation/setbacks/usable-area constraints, project and AI workflow integration, future engineering compatibility |
| 33 | Quotas, account settings and job limits | REPORTED — migration `0023`, `apps/api/src/account/*`; up to 8 active jobs per owner in report | Verify actual implementation and policy |
| 34 | Additional backend capability / integration | UNKNOWN — recover original scope | No exact scope inferred |
| 35 | Engineering Calculation Workspace and safeguards | CONFIRMED from owner-established context; implementation reported at `3717a80`, PR #7 | CI reportedly green; independent review pending; hosted migrations not applied; no validated wind/seismic/drift/foundation/member/lift solver. Do not merge/tag/deploy without approval |
| 36 | Cloud Engineering Compute Gateway | CONFIRMED as intended scope by the supplied reconciliation evidence and owner directive; exact requirements remain partially unverified | Handoff `docs/phase36/phase36-handoff.md` is a roadmap paraphrase, not the missing original roadmap. Resolve source and base branch before material implementation |
| 37 | Additional backend capability | UNKNOWN — recover original scope | Do not invent dependencies |
| 38 | Provider routing | REPORTED as not yet implemented in reconciliation report | Do not assume it exists or that Phase 36 depends on it |
| 39 | Additional backend capability / integration | UNKNOWN — recover original scope | No exact scope inferred |
| 40 | Comprehensive backend audit and readiness review | CONFIRMED owner policy | Audit security, integration, APIs, DB/migrations, engineering boundaries, deployment readiness and roadmap completeness. Fix critical security/data-loss/blocking defects promptly |
| 41 | Post-audit remediation / integration | PROPOSED placeholder only | Exact scope must be owner-confirmed |
| 42 | Reliability / operational readiness | PROPOSED placeholder only | Exact scope must be owner-confirmed |
| 43 | Deployment and release preparation | PROPOSED placeholder only | No deployment without explicit authorization |
| 44 | Documentation and compatibility consolidation | PROPOSED placeholder only | Preserve source provenance and migration history |
| 45 | Final acceptance / regression verification | PROPOSED placeholder only | Define gates from recovered roadmap and owner-approved release plan |
| 46 | Final roadmap completion / handoff | PROPOSED placeholder only | End-state and deliverables require owner confirmation |

### Important numbering note

The repository reconciliation report uses internal labels such as **B31–B36** for capability families, while user context also refers to frontend/backend “Phase 31”, “Phase 32”, etc. These labels may not always map one-to-one. Confirm exact numbering from source documents before changing migration names, tags, API contracts, or branch names.

## 4. Phase 36 scope record

**Working scope:** Cloud Engineering Compute Gateway.

**Evidence available in the supplied reconciliation report:**
- `docs/phase36/phase36-handoff.md` at `phase31/development`, commit `a7e3da4`, described as a paraphrase of the missing roadmap.
- Earlier phase documents reportedly assign cloud compute and governed external compute workers to B36.
- The report says the conversational-AI branch is the only conflicting scope document and should remain separate/unmerged.
- The user directive agrees that Phase 36 is the Compute Gateway.

**Not established:** exact original requirements, provider selection, solver execution scope, budget units/ceilings, background sweeper identity, callback policy, remote-eligible job kinds, privacy defaults, and the exact required base branch.

**Before material implementation:**
1. Recover the original roadmap or obtain owner confirmation that the existing handoff paraphrase is authoritative.
2. Confirm whether Phase 36 includes solver execution and which solver outputs, if any, can be accepted.
3. Verify the base branch and ancestry. The reconciliation report describes `phase31/development` as the default branch and Phase 35 remediation as a separate, unreviewed draft PR branch; neither base should be chosen blindly.
4. Preserve `phase36/conversational-ai` as an independent workstream. Its reported migration `0025` may collide with gateway migration numbering; inspect actual migrations and choose numbering only after checking branch ancestry.
5. Do not make hosted database changes.

## 5. Release and verification gates

A phase is not “released” merely because code exists or unit tests pass.

For each phase, record:
- exact branch and commit tested;
- clean/dirty working-tree state;
- baseline comparison and migration ancestry;
- build, typecheck, lint, unit tests, integration tests and full regression results;
- API/OpenAPI drift checks;
- migration and upgrade tests if schema changes;
- container and local Supabase acceptance results when applicable;
- skipped checks and environment limitations;
- independent review state;
- owner authorization for merge/tag/deploy/hosted migrations.

A skipped test is **not** a pass. A local database test does not prove hosted migration readiness. Do not claim a test ran unless its output is available.

## 6. Standard phase prompt requirements

Every Claude Code implementation prompt should instruct the agent to:
1. Read this roadmap, the relevant phase handoff, current audit reports, and the V2 research document.
2. Inspect the real Git branch, working tree, upstream, commit graph and migration history before editing.
3. Confirm phase scope, dependencies and base branch; stop and report if a material ambiguity cannot be safely resolved.
4. Protect unrelated branches and uncommitted work; never reset, rebase, force-push, delete or overwrite without authorization.
5. Implement only the phase scope with focused tests and documentation.
6. Preserve API and database compatibility unless an approved change requires otherwise.
7. Preserve engineering evidence classifications and truthful capability disclosures.
8. Report exact files, migrations, endpoints, tests and results, including skipped checks.
9. Do not merge, tag, deploy or apply hosted migrations without explicit owner approval.
10. Avoid unnecessary perfection cycles: once acceptance criteria pass, record limitations and proceed unless a genuine safety, security, data-integrity or release-blocking defect exists.

## 7. Source recovery and governance

This reconstruction must not erase the fact that the original roadmap is missing.

When the original is recovered:
1. Save it with source, owner, date and checksum/provenance.
2. Compare every phase title and requirement against this reconstruction.
3. Record differences; do not silently overwrite accepted owner decisions.
4. Update this file only after owner review.
5. Keep an archived copy of this reconstruction for traceability.

## 8. Current known open items

- [ ] Recover or explicitly authorize the reconstructed roadmap as the working authority.
- [ ] Recover the original V2 research set, if it exists.
- [ ] Resolve Phase 36 solver-execution scope and exact requirements.
- [ ] Resolve Phase 36 base-branch choice and Phase 35 dependency plan.
- [ ] Track Phase 35 independent review and owner release authorization.
- [ ] Keep Phase 30 frontend integration verification deferred.
- [ ] Retain Phase 40 comprehensive audit as a project-level gate.

# Status and acceptance-evidence register

**Baseline 2026-10-13 (r3).** Live state: it changes with every merge, PR and verification run. The phase *scope* index is in the [roadmap §3](NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md); this file records *state and evidence*. Evidence classes are defined in [README §1](README.md).

## 1. Branches and pull requests

| Branch / PR | Head | State | Evidence |
|---|---|---|---|
| `phase31/development` (default) | `5476f41` | Contains B31–B35 initial (PR #4), the Phase 36 handoff (PR #6) and the **Phase 36 gateway (PR #10)** | CONFIRMED (Git ancestry) |
| PR #10 `phase36/compute-gateway` → default | `9420961` | **Merged** 2026-10-13 05:15:57Z by @Aryangithub13, 9 s after it was opened. Its CI `backend` job **failed** (see §3) | CONFIRMED (GitHub API; Actions run 38350504126) |
| PR #7 `phase35-1/release-remediation` → default | `3717a80` | Open **draft**. Approved by @shubham-0 on `3717a80` (review 5495114526, no comments; the PR's checklist boxes are unticked). CI run 38278710919 succeeded on Node 22.22.0 and 22.23.2 (`supabase-acceptance` skipped). Now **conflicting** (`mergeable_state: dirty`) | CONFIRMED (GitHub API) |
| `phase36/conversational-ai` | `3016ec8` | Unmerged, no PR, based on `6f71c02` + PR #7 history. Not the roadmap's Phase 36 | CONFIRMED (refs) |
| `docs/roadmap-research-baseline` | this revision | Unmerged, no PR. Documentation only | CONFIRMED |

**Simulated merges onto `5476f41`** (`git merge-tree`, read-only):
- PR #7 and `phase36/conversational-ai` each conflict in `apps/api/src/lib/http-protection.ts` (rate-limit `generate` group) and `apps/api/src/services/overview-service.ts` (discovery). Both conflicts are additive.
- Generated `docs/modernization/openapi.json` and `api-routes.json` merge textually but must be regenerated after any such merge.

## 2. Migrations

| Location | Migrations | Evidence |
|---|---|---|
| `phase31/development` @ `5476f41` | `0001`–`0025` (`0025_compute_gateway.sql`) | CONFIRMED (tree) |
| PR #7 @ `3717a80` | `0001`–`0024`; adds none | CONFIRMED |
| `phase36/conversational-ai` @ `3016ec8` | `0001`–`0024` + `0025_conversation_turns.sql` (a `create or replace` of `conversation_write`) | CONFIRMED |
| Local Supabase stack (2026-10-13, CLI 2.117.0, disposable) | `0001`–`0025` applied (`supabase migration list --local`) | CONFIRMED (observed; stack since stopped) |
| Hosted Supabase | Believed `0017` | REPORTED (B31–B33 reports); never contacted |

**Conflict:** `0025` is now taken on the default branch. `phase36/conversational-ai` therefore cannot merge with its own `0025`: the Supabase ledger keys on the version prefix, and Git reports no conflict for two different file names. It must be renumbered to `0026` (with its upgrade test's `name < '0025'` filter, file URL and titles) before any merge. That is an owner action on that branch. The two migrations touch disjoint objects, so the order is safe.

## 3. Phase 36 acceptance status

**Verdict: merged with a known defect; acceptance incomplete.**

| Check | Commit | Result | Class |
|---|---|---|---|
| GitHub CI (PR #10, `backend` job, Node 22.23.3 from `node-version: '22'`) | merge `908b0e5` of `9420961` | **Failed at `npm run typecheck`**: `apps/api/tests/compute.integration.test.ts(253,19): error TS2532: Object is possibly 'undefined'.` No tests ran in CI | CONFIRMED (job log 115141566509) |
| Local `npm run typecheck`, Node 22.22.0 | `8597703` | **Exit 2**, the same error | CONFIRMED (observed) |
| Local `npm run build` / `npm run lint` | `8597703` | Exit 0 / exit 0 | CONFIRMED |
| Local full suite `npx vitest run`, non-root, Node 22.22.0 | `8597703` | **91 files, 2776 tests, all passed** (Vitest transpiles without type-checking) | CONFIRMED |
| Earlier full suite + typecheck, Node 22.22.0 | `76c39c2` | build, typecheck and lint 0; 91 files / 2771 tests passed | CONFIRMED (observed in the implementing session) |
| Focused gateway tests `compute.test.ts` + `compute.integration.test.ts` | working tree = `8597703` | 29/29 passed | CONFIRMED |
| Mutation checks on the new gateway tests | working tree = `8597703` | 6/6 caught (stale, expiry, P3602, replay, induced failure, swallowed insert error) | CONFIRMED |
| Local Supabase acceptance `npm run test:supabase` (real JWTs and PostgREST; includes a Phase 36 case) | working tree = `8597703` except one indentation-only line | **121/121 passed**; receipt `docs/phase16-evidence/supabase-2026-10-13T05-05-02.774Z.json` (0 API errors; 18 recorded denials are the suite's deliberate anonymous checks) | CONFIRMED |
| Full suite on Node 22.23.2 | — | **Not run** for `8597703`/`9420961` | — |
| Container smoke test | — | **Not run** for Phase 36 | — |
| Hosted migration | — | Not authorized; not run | — |

**Behavior covered by passing tests** (listed by test name in `docs/phase36/phase36-report.md` §4 on the default branch):
- quote side-effect freedom;
- consent binding: altered fields, another user, project or key, mismatch;
- expired, stale and post-expiry replay;
- one execution under concurrent and repeated consent;
- quote-hash conflict (`P3602`);
- in-transaction rollback;
- lost-dispatch recovery by polling;
- owner and B32 limits;
- remote refusal and fail-closed policy;
- polling ownership;
- RLS, grants and immutability through real PostgREST;
- worker-output rejection;
- Phase 35 blockers unchanged.

**Open defects and gaps:**

1. **Typecheck failure on the default branch** (CONFIRMED). The fix is one line in a test: replace `racing[0].json().job.id` with a checked lookup, e.g. `racing.find(r => r.statusCode === 202)?.json().job.id`. It was not pushed in this pass (see [decisions-register](decisions-register.md) Q1).
2. **CI coverage on the default branch** (CONFIRMED): the workflow runs per-area subsets. These omit 15 API test files that `npx vitest run` covers (`compute`, `jobs`, `account`, `references`, `verification`, `repair-*`, `postgres-harness`, `worker-bootstrap`), and push CI does not trigger on `phase31/development`. PR #7 changes the workflow to the full suite on both Node versions.
3. **Stale report:** `docs/phase36/phase36-report.md` on the default branch still says its verification table is "Pending". The results are recorded here; that report needs the same update.
4. **Not run:** Node 22.23.2 and the container smoke test.

## 4. Per-phase acceptance evidence (B30–B36)

Earlier phases: the roadmap §3 *Status* column; evidence in each `docs/phaseNN/` report (REPORTED unless re-verified).

| Phase | Merge/tag | Strongest evidence on record | Class |
|---|---|---|---|
| B30 selective revision | Tag `backend-v1-phase30-complete` | Phase 30 reports; frontend integration verification **deferred** by the owner | Tag CONFIRMED; report REPORTED |
| B31 references | Merged (PR #3), untagged | `docs/phase31/` | REPORTED |
| B32 durable jobs | Merged, untagged | `docs/phase32/`; jobs tests passed in the 2026-10-13 local full run | Tests CONFIRMED (local) |
| B33 account / library | Merged, untagged | `docs/phase33/`; tests passed in the same run | Tests CONFIRMED (local) |
| B34 verification | Merged, untagged | `docs/phase34/`; tests passed in the same run | Tests CONFIRMED (local) |
| B35 supertall assessment | B35 initial merged (PR #4). B35.1 and completion **unmerged** (PR #7) | PR #7 CI green on `3717a80`; approval on `3717a80` | CONFIRMED (GitHub) |
| B36 compute gateway (first slice) | Merged (PR #10), untagged | §3 above | Mixed: see §3 |

"Tests passed in the local run" means the files ran green in `npx vitest run` on `8597703` (Node 22.22.0, non-root). It does not mean each phase's full acceptance criteria were re-audited.

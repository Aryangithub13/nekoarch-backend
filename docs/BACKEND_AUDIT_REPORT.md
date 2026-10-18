# NekoArch backend: comprehensive pre-repair audit

| | |
|---|---|
| **Date** | 2026-10-18 (audit session started 14:11 UTC) |
| **Type** | Audit only. Nothing was fixed, merged, rebased, tagged, released, deployed, migrated or pushed. This file is the only repository change. |
| **Repository** | `Aryangithub13/nekoarch-backend` |
| **Code audited** | `phase31/development` @ `6bd84a5` (the repository's default branch and integrated code line), and the PR #31 merge result, tree `ab67977` (CI merge ref `b9ce2a2`) |
| **Documents branch** | `main` @ `b06d082` (documents only; unrelated history, see PHASE-001) |
| **Phase numbering** | The authoritative 46-phase roadmap, `docs/sources/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md`, written B01–B46 |

### Evidence labels used throughout

| Label | Meaning |
|---|---|
| **RAN** | Executed in this session; the command and the result are in §4–§5 |
| **CI** | Read from a GitHub Actions run, run ID given |
| **CODE** | Confirmed by reading the source at the cited file and line |
| **DOC** | Stated in a repository document and not re-executed here |
| **GH** | Read from the live GitHub API (PRs, reviews, checks) in this session |

---

## 1. Executive summary

**Bottom line.** The integrated code on `phase31/development` builds, typechecks and lints cleanly, and its full automated suite passes: in CI (113 files, 3,106 tests) and in this session (113/113 files and 3,106/3,106 tests passed locally (Linux, Node 22.22.0, exit 0, 779 s)). The pending PR #31 merge tree also passes CI (125 files, 3,164 tests), and that tree is byte-identical to the one built here. I found **no confirmed secret in any branch, tag or PR ref, at any point in history**. I also found **no confirmed critical or high application vulnerability**: RLS is enabled on every `public` table, every `SECURITY DEFINER` function pins `search_path`, the API never uses the service-role key, and the SSRF and error-leak controls hold under inspection and black-box probing.

**The backend is not showcase-ready yet, and passing unit tests are not the reason it falls short.** The blockers are release and integration evidence, not broken code:

1. **Nothing hosted is verified** (SHOW-001, SUPA-001). The hosted Supabase migration ledger was last reported at `0017`. The repository has `0001`–`0029`, and `0030` arrives with PR #31. No staging proof exists for any phase from B29 on.
2. **Live Supabase acceptance has not covered the newest code** (SUPA-002). The last real-JWT/PostgREST receipt (125/125, 2026-10-14) predates the B34 repair, migration `0030` and all of B40–B46.
3. **"Consolidate into `main`" is not a normal merge** (PHASE-001). `main` holds 5 documentation commits with no common ancestor with the 178-commit code line. Three documents differ on both sides.
4. **PR #31 (B40 S1+S2, B41–B46 S1) is large and unreviewed** (PHASE-002): +15,820/−5,303 lines, 64 files, a new migration, 0 reviews. Its predecessor, PR #30, merged 17 minutes after it opened. Its own release evidence says `productionReady: false`, and no phase B40–B46 is complete.
5. **There is no single setup guide** for a clean-checkout demo (SHOW-002). The code branch has no README, and the closest runbook (`docs/PHASE8.md`) still says to apply migrations "through `0005`".

**One new functional defect was reproduced** (BUG-001, Low). A clean SIGTERM logs `SHUTDOWN_FAILED` and exits 1 whenever `SENTRY_DSN` is unset, which covers every local, dev and demo run. The cause is that `Sentry.flush()` resolves `false` when no client was initialised. CI cannot see this because its container smoke test injects a fixture DSN.

**Findings by severity** (full register in §18): Critical 0 · High 6 · Medium 15 · Low 12 · Informational 2 (35 findings).

**Supabase acceptance** (§11): static RLS, auth-mapping and privilege checks are PASS. Every live-runtime row is BLOCKED (no Docker daemon or credentials here) or NOT VERIFIED (no receipt covers it). The local Supabase stack could not be started in this container.

**Recommended path** (§17, §20): merge PR #31 into `phase31/development` only after an owner review and a local Supabase acceptance run that covers `0030`. Then refresh and merge PR #29, then consolidate `main` through an explicit `--allow-unrelated-histories` merge in a reviewed PR. Run the hosted ledger check (D-9) and one staging rehearsal before any showcase that touches hosted infrastructure.

---

## 2. Repository baseline and Git status

### 2.1 Local checkout (the session's working directory)

| Item | Value | Evidence |
|---|---|---|
| Path | `/home/user/nekoarch-backend` | RAN |
| Remote | `origin` → `https://github.com/Aryangithub13/nekoarch-backend` | RAN `git remote -v` |
| Current branch | `main`, tracking `origin/main` | RAN `git status -b` |
| HEAD / local `main` / local `origin/main` | `dd6e469` "Initial commit" (README only) | RAN `git rev-parse` |
| Initial working-tree status | **Clean** (`## main...origin/main`, no modified or untracked files) | RAN `git status --porcelain=v1 -b` |
| Stashes, local tags | none | RAN |
| Notable | The local checkout is **stale**: the remote `main` is `b06d082` (4 commits ahead), and the remote has 46 more branches. `b06d082` exists locally only as a dangling object | RAN `git ls-remote`, `git fsck` |

To avoid changing the local refs, I did not run `git fetch` in this checkout. All remote inspection used a separate mirror clone in the session scratchpad (§4).

### 2.2 Remote state (verified twice in this session, with no movement between checks)

| Ref | Commit | Notes |
|---|---|---|
| `HEAD` (default branch) | `phase31/development` @ `6bd84a5` | "Merge pull request #27 from phase34/diff-integrity" (2026-10-17) |
| `main` | `b06d082` | 5 commits, docs only, **no merge base** with `phase31/development` |
| `phase40/selective-revision-orchestration` | `4888360` | Head of open PR #31; PR #30 merged into it at 14:11:40 UTC today |
| Remote branches | 47 | `git ls-remote origin 'refs/heads/*'` |
| Tags | 30, the newest being `backend-v1-phase30-complete` | No tag for B31–B46 |
| Branch protection | Not checked (no API access in this session) | Unverified; reported absent on 2026-10-12 (DOC) |

### 2.3 Concurrent work and B34

- **Open PRs (GH):** #31 (`phase40/selective-revision-orchestration` → `phase31/development`, opened 14:11:58 UTC today, no description, 0 reviews, CI green) and #29 (draft, B39 release gates, base `287b1a4`, CI green on 2026-10-15).
- **Cloud sessions (account listing):** no cloud session is currently working on B34. The B34 session (`phase34/diff-integrity`) is idle, and its PR #27 **merged on 2026-10-17** as `6bd84a5`. `phase34/diff-integrity` (`4bcdac0`) is fully contained in `phase31/development`.
- **"Separate B34 repair":** no branch, PR or commit for further B34 repair work is visible on the remote as of this audit. If one is in progress elsewhere (for example on a local machine), it is **unverified**, it was not touched, and §17 explains how to sequence it.
- **Authorship:** the newest work (B40 S2–B46 S1, `8857006`…`1ae43fd`) is by a second contributor (`shubham`), committed between 09:08 and 13:50 UTC today.

### 2.4 Final status (filled in at the end, §21)

See §21 for the end-of-audit comparison.

---

## 3. Architecture and subsystem inventory

| Aspect | Finding | Evidence |
|---|---|---|
| Runtime | Node.js, `engines: ">=22"`; CI pins 22.22.0 and 22.23.3; Docker `node:22-bookworm-slim` | CODE `package.json`, `.github/workflows/backend-ci.yml:26`, `Dockerfile:1` |
| Package manager | npm workspaces, lockfile v3 (353 entries, all from `registry.npmjs.org` with integrity hashes) | RAN |
| Language / build | TypeScript 5.9 (`tsc`), ESM | CODE |
| API framework | Fastify 5 with `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`, Pino logging, Zod 3.25.76 validation, Sentry 10 (opt-in) | CODE `apps/api/package.json` |
| Workspaces | `apps/api` plus 6 packages: `shared`, `generator`, `blueprint-qa`, `quantity-takeoff`, `construction-calculations`, `boq-cost` | CODE |
| Size | ~28.9k lines of TypeScript source (base), ~31.0k (PR #31 merge); 151 routes (base) → 165 (merge), per `docs/modernization/api-routes.json` | RAN |
| Database | Supabase Postgres; 29 SQL migrations (`0001`–`0029`), `0030` in PR #31; seed has **illustrative** rate tables only | CODE `supabase/migrations`, `supabase/seed.sql` |
| Data access | The anon key plus the **caller's bearer token** per request (RLS enforced); writes go through signed `SECURITY DEFINER` RPCs (HMAC envelopes keyed by `project_private.commit_key` / `PROJECT_COMMIT_SECRET`) | CODE `apps/api/src/lib/supabase.ts:173-198` |
| Auth | Supabase Auth (GoTrue) `auth.getUser(token)` on every authenticated request; 401 for invalid sessions, 503 `AUTH_UNAVAILABLE` for upstream failure | CODE `supabase.ts:185-190`, RAN probe |
| Supabase services used | **Auth** and **Postgres/PostgREST (RPC + RLS)**. **Not used:** Storage (reference bytes live in a Postgres table, `project_reference_blobs`), Edge Functions, Realtime, Supabase webhooks | CODE (no `storage.from`, `functions.invoke` or `channel(` in `apps/api/src`) |
| Background work | In-process worker pools (optimisation, scene, appearance, reference inspection) and a durable-job runner with leases and heartbeats (B32); **no background sweeper** | CODE `apps/api/src/jobs/runner.ts:95` |
| External integrations | Optional OpenAI-compatible AI providers (local loopback, or allow-listed HTTPS remote), all disabled by default; Sentry | CODE `ai/orchestration/transport.ts:17`, `ai/conversation-provider.ts:21` |
| Webhooks | **None** (no inbound webhook endpoints) | CODE |
| Health | `/health/live` (always 200), `/health/ready` (checks Supabase; 503 while draining or when production lacks `PROJECT_COMMIT_SECRET`) | CODE `app.ts:106`, RAN probe |
| CI | One workflow: build/type/lint/full vitest on 2 Node versions, container smoke, and a manual-only `supabase-acceptance` job | CODE `.github/workflows/backend-ci.yml` |

---

## 4. Audit methodology and actual commands executed

All remote inspection and every execution ran on **scratch copies outside the repository**. The working checkout was touched only to create this file.

| # | Command (abridged) | Where | Result |
|---|---|---|---|
| 1 | `git remote -v; git branch -a; git status --porcelain=v1 -b; git log; git ls-remote origin; git fsck` | working checkout | Baseline (§2.1) |
| 2 | `git clone --mirror https://github.com/Aryangithub13/nekoarch-backend mirror.git` | scratchpad | Full mirror: all branches, tags and PR refs |
| 3 | `git worktree add --detach dev 6bd84a5` (in the mirror) | scratchpad | Code checkout of the default branch |
| 4 | `git merge-tree --write-tree 6bd84a5 4888360` → tree `ab67977`; `git archive ab67977` | scratchpad | PR #31 merge result; later confirmed identical to CI's merge-ref tree |
| 5 | Lockfile install-script and registry audit (Node script over `package-lock.json`) | scratchpad | Only esbuild, embedded-postgres platform binaries and fsevents have install scripts; all from the npm registry |
| 6 | `npm ci --no-audit --no-fund` | scratch copies only | exit 0; exactly the locked versions (no package added or upgraded) |
| 7 | `npm run build`, `npm run typecheck`, `npm run lint` | base and merge | all exit 0 on both |
| 8 | `npm audit --omit=dev --json`; `npm audit --json` | base | prod: 0 vulnerabilities; all: 1 moderate, 2 critical (dev-only, DEP-001) |
| 9 | `npx vitest run` as root | base | **Aborted: environmental.** `initdb` refuses to run as root; see §5.2 |
| 10 | Copied to an `ubuntu`-owned temp directory; `runuser -u ubuntu -- npx vitest run` | base | **Environmental failure:** 6 database-backed suites failed in `initdb` (`invalid locale name "en_US.UTF-8"`). Stopped after 45 files |
| 11 | `localedef -i en_US -f UTF-8 en_US.UTF-8` (container OS only, from glibc sources already on disk; no package installed; mirrors CI's `sudo locale-gen en_US.UTF-8`) | container | Locale available |
| 12 | `runuser -u ubuntu -- npx vitest run --reporter=default --reporter=json` | base | 113/113 files and 3,106/3,106 tests passed locally (Linux, Node 22.22.0, exit 0, 779 s) |
| 13 | `runuser -u ubuntu -- npx vitest run <the B40–B46 and B34 suites>` | merge | 19/19 files and 152/152 tests passed (Linux, exit 0, 92 s): the 12 new B40–B46 files plus the B34 verification, specialist-verification, conformance, schema-replay, hosted-ledger and hardening suites; no EBUSY |
| 14 | Black-box probe: built `apps/api/dist/server.js` with a placeholder Supabase URL on `127.0.0.1:9` (unreachable), then `curl` (§5.4) | base and merge | Config validation, auth, errors, CORS, shutdown |
| 15 | `node --input-type=module -e 'await Sentry.flush(100)'` | base | `false` without a client (BUG-001 root cause) |
| 16 | Redacted regex secret scan over **every blob reachable from every ref** of the mirror (Python, `git cat-file --batch`), printing only type, path, line, length and a SHA-256 prefix | scratchpad | 125 generic matches, 0 high-confidence secret formats (§9) |
| 17 | Commit-message scan (all refs) for credential formats | scratchpad | 0 matches |
| 18 | RLS / `SECURITY DEFINER` / grant analysis over `supabase/migrations/*.sql` | base and merge | §11 |
| 19 | GitHub API: PR list (all 31), PR #31/#29 details, check runs, reviews, workflow runs 39007185316 and 39134917974, job logs | GH | §5.1, §16 |
| 20 | `git merge-tree` for PR #29 onto the base and onto the PR #31 merge; `git rev-list` unmerged-branch scan; `git cherry` | scratchpad | §16–§17 |

**Not installed and not used:** gitleaks, trufflehog, semgrep and any other new tool. Nothing was upgraded. Docker has a client but **no daemon** in this container, so the local Supabase stack, container build and container smoke test could not run.

---

## 5. Test, build, type-check, lint and static-analysis results

### 5.1 Summary

| Check | Base `6bd84a5` | PR #31 merge `ab67977` | Evidence |
|---|---|---|---|
| `npm ci` | exit 0 | exit 0 (lockfile identical to the base) | RAN |
| `npm run build` | exit 0 | exit 0 | RAN |
| `npm run typecheck` (tsc, including the browser typecheck) | exit 0 | exit 0 | RAN |
| `npm run lint` (ESLint 9, typescript-eslint) | exit 0, no warnings printed | exit 0 | RAN |
| `npm audit --omit=dev` | 0 vulnerabilities | 0 vulnerabilities (`--audit-level=high` exit 0) | RAN |
| `npm audit` (including dev) | 3 (1 moderate, 2 critical), all in vitest's tree | same lockfile | RAN |
| Full vitest suite, local Linux, Node 22.22.0 | 113/113 files and 3,106/3,106 tests passed locally (Linux, Node 22.22.0, exit 0, 779 s) | targeted subset: 19/19 files and 152/152 tests passed (Linux, exit 0, 92 s): the 12 new B40–B46 files plus the B34 verification, specialist-verification, conformance, schema-replay, hosted-ledger and hardening suites; no EBUSY | RAN |
| Full vitest suite, CI Node 22.22.0 | **113 files, 3,106 tests passed** (run 39007185316) | **125 files, 3,164 tests passed** (run 39134917974) | CI |
| Full vitest suite, CI Node 22.23.3 | success (run 39007185316) | success (run 39134917974) | CI |
| Container smoke (docker build plus the smoke script) | success (CI) | success (CI) | CI; not runnable here |
| `supabase-acceptance` CI job | **skipped** (only on `workflow_dispatch`) | **skipped** | CI |
| Live Supabase suite `apps/api/tests/supabase.live.test.ts` (12 scenarios) | BLOCKED here (no Docker daemon); last receipt 125/125 on `c343855`, 2026-10-14 | never run | DOC `docs/phase16-evidence/supabase-2026-10-14T17-30-30.615Z.json` |
| Static analysis beyond ESLint / tsc | Not available (no semgrep or CodeQL installed); manual review only | — | — |

### 5.2 Failures observed, and their classification

| # | Command | Observed | Classification | Root cause |
|---|---|---|---|---|
| F-1 | `npx vitest run` as root | Database-backed suites cannot start | **Environmental** | PostgreSQL `initdb` refuses to run as root. CI runs as the non-root `runner` user. Undocumented for local developers (TEST-003) |
| F-2 | `runuser -u ubuntu -- npx vitest run` | `Postgres init script exited with code 1` in 6 suites before I stopped the run | **Environmental** | `embedded-postgres@18.1.0-beta.16` hard-codes `--lc-messages=en_US.UTF-8` (`node_modules/embedded-postgres/dist/index.js:26`) and discards initdb's stderr. This container had only the `C`, `C.utf8` and `POSIX` locales. Reproduced by hand: `initdb: error: invalid locale name "en_US.UTF-8"`. CI handles it with `sudo locale-gen en_US.UTF-8` (`backend-ci.yml:34`). After the locale was compiled, F-2 disappeared |
| F-3 | B40–B46 author's evidence (`docs/phase46/release-evidence.json`) | `PASSED_WITH_SUITE_ERRORS` for B41, B44 and B46 (B46 exit code 1); `EBUSY` on embedded-Postgres teardown | **Environmental (Windows)**, not reproduced on Linux | Windows file locking on teardown, per the author's notes (`docs/roadmap/b40-b46-implementation-plan.md` §3). CI on Linux is green |

**No code-defect test failure was observed** in any run. See §6 for the defect found by probing.

### 5.3 Test inventory

- Base: 113 test files under `packages/*/tests`, `apps/api/tests` and `supabase/tests`. `supabase.live.test.ts` is excluded by `vitest.config.ts` and runs only through `test:supabase`.
- Merge: 125 files; the 12 new ones are listed in §16.2.
- Integration suites use a **real embedded PostgreSQL** with every migration applied and a minimal `auth` schema (`test-support/postgres.ts:28-48`). That is real RLS, but **not** GoTrue, JWT verification or PostgREST. The live suite covers those, and it has not been run against `0030` or any B40–B46 route.

### 5.4 Black-box probe of the built API (RAN, base and merge, identical results)

Run against an unreachable placeholder Supabase URL, so no external service was contacted.

| Probe | Result | Verdict |
|---|---|---|
| `NODE_ENV=production` without `SENTRY_DSN` | Refuses to start: `SENTRY_DSN: Required in production`, exit 1 | PASS (fail-fast; no value echoed) |
| `CORS_ORIGINS=http://a.com/path` | Refuses to start: `Use comma-separated exact URL origins` | PASS |
| `GET /health/live` | 200 `{"status":"ok"}` | PASS |
| `GET /health/ready` with Supabase unreachable | 503 `{"status":"unavailable"}` | PASS |
| `GET /api/projects` without a token / with `Basic` auth | 401 `UNAUTHORIZED` envelope with a request ID | PASS |
| `GET /api/projects` with a bearer token, auth upstream down | 503 `AUTH_UNAVAILABLE` | PASS (not a misleading 401) |
| `POST` malformed JSON | 400 `INVALID_REQUEST`, generic message | PASS (no parser detail leaked) |
| `POST /api/plans/generate` with a 100 KB body (small-body limit) | 400 `INVALID_REQUEST` | PASS |
| Unknown route; `..%2f` path | 404 `NOT_FOUND`; 401 (auth before routing parameters) | PASS |
| CORS preflight from `https://evil.example` | 204 **without** `Access-Control-Allow-Origin` | PASS |
| CORS preflight from `http://localhost:5173` (dev default) | 204 with ACAO set to that origin | PASS |
| Security headers | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, `x-request-id` | PASS (HSTS off unless production with `HSTS_ENABLED`) |
| Server log after the probe | Contains no bearer token; route templates only | PASS |
| **SIGTERM on an idle server** | Logs `{"code":"SHUTDOWN_FAILED"}` and **exits 1** | **FAIL → BUG-001** |

---

## 6. Confirmed bugs and root-cause analysis

### BUG-001: a clean SIGTERM reports `SHUTDOWN_FAILED` and exits 1 whenever `SENTRY_DSN` is unset

| Field | Detail |
|---|---|
| Severity / confidence | **Low** / **Confirmed** (reproduced 4 of 4 times: base and merge, idle and after a request) |
| Status | Open; present on `phase31/development` and on the PR #31 merge |
| Location | `apps/api/src/lib/lifecycle.ts:6` (`if (await flush() === false) failed();`); `apps/api/src/lib/sentry.ts:79` (base; `:92` on the merge) `if (!env.SENTRY_DSN) return;`; `sentry.ts:89` (base; `:102` merge) `export const flushSentry = () => Sentry.flush(5_000);` |
| Reproduction (safe) | `npm run build`, then `env -i PATH=$PATH SUPABASE_URL=http://127.0.0.1:9 SUPABASE_ANON_KEY=placeholder PORT=3902 node apps/api/dist/server.js & sleep 2; kill -TERM $!; wait $!; echo $?` → prints `1`; the log contains `"code":"SHUTDOWN_FAILED"` |
| Expected | Exit 0 and no failure log when the HTTP server and pools close cleanly and no error reporter is configured |
| Actual | Exit 1 and an error-level `SHUTDOWN_FAILED` log on every shutdown in development, test and local demo runs |
| Root cause (confirmed) | `initializeSentry` deliberately skips `Sentry.init` without a DSN. With no client, `@sentry/node@10.74.0`'s `Sentry.flush()` resolves `false` (RAN: `await Sentry.flush(100)` → `false`). `createShutdown` treats `false` as a failed flush |
| Why CI misses it | `scripts/smoke-container.mjs:12` always injects `SENTRY_DSN=http://fixture@127.0.0.1:9/1`, and `apps/api/tests/hardening.test.ts:63` stubs `flush` to return `true` |
| Impact | No data loss: `app.close()` completes first. But process supervisors (`docker stop`, Compose, systemd, `npm run dev` wrappers) record a failed exit, and operators see an error log on every routine stop. A showcase that stops the server live would show a spurious failure. In production a DSN is mandatory, so the issue appears there only if a real flush times out, which is arguably the correct report |
| Recommended permanent fix | Make `flushSentry` report "nothing to flush" as success when Sentry is not initialised, for example `Sentry.getClient() ? Sentry.flush(5_000) : Promise.resolve(true)`, or track initialisation in `sentry.ts`. Keep treating a real flush timeout as failure |
| Proposed regression test | In `hardening.test.ts`: call `createShutdown(close, flushSentry, failed)` without initialising Sentry and assert `failed` is not called. Add a smoke variant that starts the built server with **no** `SENTRY_DSN` in `NODE_ENV=development`, sends SIGTERM and asserts exit code 0 |
| Showcase impact | Cosmetic but visible: a red error line and a non-zero exit on stop |
| Remaining verification | Confirm the exit code under the real container runtime with a DSN configured; this could not be run here (no Docker daemon) |

No other functional defect was reproduced. The previously reported B34 defects B34-1 to B34-3 (hidden document edit, `spaceIds` order, truncated `levelIds`) are **fixed and merged** (PR #27, `6bd84a5`; GH, CI 39007185316 green). I did not independently re-derive those fixes beyond the passing regression suites.

---

## 7. Suspected functional defects (not reproduced)

| ID | Suspicion | Evidence | Why not confirmed | How to confirm |
|---|---|---|---|---|
| DEBT-003 | Durable jobs orphaned while their owner is offline stay `RUNNING`/leased until that owner's next read (no background sweeper) | CODE `jobs/runner.ts` (heartbeat only); DOC E-09 | By design in B32 S1; time-based behaviour not exercised here | An integration test that kills a runner mid-job, waits past the lease, and checks the job is recovered **without** an owner read (expected to fail today) |
| SEC-004 | Collaboration caps (20 members, 200 comments, 100 reviews) can be exceeded under concurrent writes | CODE `0030_collaboration.sql:129,155,166`: `count(*)` then `insert` with no lock or unique bound | Not run concurrently against PostgreSQL | Fire N>cap parallel `POST …/comments` at a revision holding cap−1 comments on embedded PG; count the rows |
| SUPA-004 | Any future project or account deletion fails: `ON DELETE CASCADE` reaches tables whose immutable triggers raise on `DELETE` | CODE `0006_projects.sql:95-97` (`immutable_revision` raises `23514`); `0030_collaboration.sql:65-66` adds two more such triggers under `projects(id) on delete cascade`; DOC E-10 | No delete path exists today (no `delete from public.projects` in the API or migrations), so the defect is latent | `delete from public.projects where id = …` as the owner on embedded PG with a comment present → expect error `23514` |
| SUPA-003 | `npm run db:start` / the `supabase-acceptance` job fails when the Supabase CLI starts PostgREST from any image other than `public.ecr.aws/supabase/postgrest:v16.2` | CODE `scripts/ensure-local-postgrest.mjs:40-43` exact-string check, `throw 'Unexpected REST image'`; DOC E-X4 | No Docker daemon | Run `npm run db:start` on a Docker host whose CLI pulls PostgREST from Docker Hub |

---

## 8. Security findings

No **confirmed** Critical or High application vulnerability was found. Confirmed controls are listed first, so later repairs do not regress them.

### 8.1 Controls verified (PASS)

| Control | Evidence |
|---|---|
| The API never uses the service-role key; every query runs as the caller under RLS | CODE `lib/supabase.ts:191-197`; the env schema has no service-role variable (`config/env.ts:10-52`) |
| Token validated server-side by GoTrue on every request; UUID-checked identity | CODE `supabase.ts:185-190` |
| RLS enabled on **all 39** `public` tables (base) and all 42 (merge) | RAN migration analysis |
| Every `SECURITY DEFINER` function sets `search_path`: 51 distinct functions (57 declarations including redefinitions) on the base, 54 (60) on the merge; 0 without | RAN parser over all migrations |
| `project_private` schema and its functions revoked from `public`, `anon` and `authenticated` | CODE `0006_projects.sql:5,11,284` and repeated per migration |
| Only two anon-callable RPCs. `project_read('public')` returns only `PUBLIC` + `ACTIVE` projects. `reference_download` validates a double-HMAC (constant-time) token with a ≤ 15-minute expiry, owner binding and a SHA-256 integrity check | CODE `0011_generation_freshness.sql` (`project_read`), `0024_constant_time_download_token.sql` |
| Idempotency scoped per user (PK `(user_id, operation, key_hash)` plus RLS) | CODE `0005_idempotency.sql:9,16-18` |
| SSRF: AI endpoints are server-configured only. Remote endpoints must be `https`, port 443, allow-listed hostname, no IP literal, no credentials or query, exact path, `redirect: 'error'`. Local endpoints must be numeric loopback | CODE `ai/orchestration/transport.ts:17,66`, `ai/conversation-provider.ts:21,41` |
| Supabase client: `redirect: 'error'`, upstream timeout, no session persistence | CODE `supabase.ts:175-177` |
| Error handler returns generic envelopes; 5xx detail goes only to logs and Sentry with sanitisation (`sendDefaultPii: false`, `defaultIntegrations: false`, `beforeSend`) | CODE `app.ts:87-101`, `lib/sentry.ts`; RAN probe |
| Config errors never echo values | CODE `env.ts:72-75`; RAN |
| Body limits: 1 MiB default, 64 KiB on generate/estimates, 10 MiB on reference upload, 1–8 KiB on collaboration writes | CODE `env.ts:44-45`, `references/contracts.ts:8`, `routes/collaboration.ts` |
| CI least privilege: `permissions: contents: read`; `pull_request` (not `pull_request_target`); no secrets used | CODE `backend-ci.yml:2-9` |
| Container: non-root `node` user, production-only dependencies, `--ignore-scripts`, no `.env` copied | CODE `Dockerfile` |
| B44 collaboration (PR #31): RLS plus deny-by-default revokes; server-side role checks in SQL; writes signed; anchors validated against the stored model; member access confined to the collaboration RPCs | CODE `0030_collaboration.sql`, `routes/collaboration.ts` |

### 8.2 Findings

| ID | Sev | Conf | Finding | Location / evidence | Recommended fix |
|---|---|---|---|---|---|
| **SEC-001** | Medium | Confirmed (CODE) | **No malware scanning and no quarantine** for uploaded references. `malwareScan` is the literal `NOT_PERFORMED / NO_SCANNER_CONFIGURED`, and invalid files are refused rather than quarantined. The roadmap requires quarantine (DOC E-08) | `apps/api/src/references/contracts.ts:59,90` | Add a scanner hook (for example a ClamAV sidecar) and a `QUARANTINED` state before `READY`. Until then, do not accept untrusted uploads in a public showcase |
| **SEC-002** | Medium | Confirmed (CODE) | **Rate limits and AI spend guards are per process.** `@fastify/rate-limit` uses its in-memory store (`cache: 10_000`). Several replicas multiply every limit, and a restart resets them | `lib/http-protection.ts:14` | Use a shared store (Redis or Postgres) before scaling past one instance. Document the single-instance assumption for the showcase |
| **SEC-003** | Medium | Medium | **Anonymous identities bypass per-user quotas.** Local config enables anonymous sign-in with no confirmation, and the live suite depends on it. If the hosted project matches, anyone can mint fresh users and get full API access, including the `generate`-class routes; only the per-IP perimeter (300/min) bounds that | `supabase/config.toml:29,33`; `http-protection.ts` | Owner decision: disable anonymous sign-ins on hosted, or apply stricter `generate` quotas to `is_anonymous` users (the JWT claim is available). Confirm the hosted setting (NOT VERIFIED) |
| **SEC-004** | Low | Medium | B44: count-then-insert caps are race-prone (§7). `member_upsert` lets a project owner test whether a given user UUID exists (`P4402` vs success); random UUIDs make enumeration impractical | `0030_collaboration.sql:127-131,155,166` | Take `pg_advisory_xact_lock(hashtext(project_id::text))` or `SELECT … FOR UPDATE` on the project row before counting. Return one error for "not a valid member" |
| **SEC-005** | Low | Confirmed | Supply chain: Actions pinned to tags (`actions/checkout@v4`, `actions/setup-node@v4`), and CI warns these run on deprecated Node 20. The Docker base `node:22-bookworm-slim` is not pinned to a digest | `backend-ci.yml:28-29,52-55`; CI log 39134917974 | Pin Actions to commit SHAs and move to the current major; pin the base image by digest and refresh it on a schedule |
| **SEC-006** | Info | Confirmed | One secret (`project_private.commit_key` = `PROJECT_COMMIT_SECRET`) signs QA attestations, write envelopes and download tokens. Domain separation relies on the route string or payload version inside each message | `0024_…sql`, `services/*-service.ts` (`signProjectCommit`) | Derive per-purpose keys with HKDF, and document rotation. Not urgent |
| **SEC-007** | Medium | Confirmed (GH) | **Process:** PRs #27, #30 and #31 have **0 reviews**; #30 (+15.8k lines) merged 17 minutes after opening. Branch protection is unverified (reported absent on 2026-10-12) | GH | Require one reviewer and green CI on `phase31/development` and `main` before the consolidation merge |

**Not found** (checked): SQL injection (all data access is through the PostgREST SDK or parameterised RPCs; no string-built SQL in `apps/api/src`), command injection (no `child_process` in the API source paths reviewed), template injection, path traversal (no filesystem reads keyed by request input; reference bytes are database rows), unsafe deserialisation (Zod-validated JSON only), open CORS, and stack traces in responses.

**Not checked in depth:** each of the ~165 route handlers individually. Ownership on owner-only routes relies on RLS plus the RPCs, which the embedded-PG suites cover as cross-user 404s. I spot-checked the collaboration, references, idempotency and project read paths.

---

## 9. Secret exposure and Git-history findings (fully redacted)

**Scope scanned:** every blob reachable from **every ref** of a fresh mirror: 47 branches, 30 tags and all `refs/pull/*` heads and merge refs, covering all commits in history and all commit messages. Binary blobs and `package-lock.json` were skipped.

**Patterns:** JWT (`eyJ…`), Supabase `sb_secret_` / `sb_publishable_` / `sbp_` tokens, Postgres URLs with a literal password, PEM private keys, AWS key IDs, GitHub tokens, Anthropic and OpenAI keys, Google API keys, Slack and Stripe tokens, Sentry DSNs with a key, and generic `*SECRET*/*PASSWORD*/*TOKEN*/*API_KEY*` assignments. Hosted Supabase project hostnames (`*.supabase.co`) were also searched.

| ID | Classification | Type | Location | Confidence | Exposure | Remediation |
|---|---|---|---|---|---|---|
| **SECRET-001** | **No confirmed secret** | — | All refs, all history | High | — | None required. Re-run a dedicated scanner (gitleaks or GitHub secret scanning) in CI as a standing control |
| — | High-confidence formats | JWT, `sb_*`, PEM, cloud/AI/GitHub/Slack/Stripe keys, password-bearing DB URLs, Sentry DSNs with a key | — | — | **0 matches** in any blob or commit message | — |
| — | Hosted project identifiers | `*.supabase.co` | — | — | **0 matches** (no hosted project ref committed) | — |
| — | Safe placeholders (test fixtures) | 9 distinct string literals ≥ 16 characters assigned to secret-like names | `apps/api/tests/foundation.test.ts:19`, `supabase-adapter.test.ts:18,23-25`, `hosted-migration-ledger.test.ts:46` (a deliberately wrong password used to test redaction), `backend.integration.test.ts:23`, `design-concepts.test.ts:248`, `packages/shared/tests/contracts.test.ts:112` | High | Test-only; low-entropy, dictionary words (fixture, secret, owner, other, token) | None |
| — | False positives | 116 identifier matches (`secret: options.env.PROJECT_COMMIT_SECRET`, `maxTokens`, `leaseToken`, `share_token` columns and similar) | `apps/api/src/**` | High | None | None |
| — | Config templates | `.env.example`: all **6 historical versions** have empty values; `.npmrc` contains only `fund=false` and `audit=false` | `.env.example`, `.npmrc` | High | None | None |
| — | `.gitignore` | Ignores `.env`, `.env.*` (except the example), `*.pem`, `*.key`, `credentials*`, `*.log` | `.gitignore` | — | — | Keep |
| — | Generated evidence | Supabase receipts record "no secrets" and contain local URLs only (spot-checked the 2026-10-14 receipt keys) | `docs/phase16-evidence/*.json` | Medium (not every evidence file was opened) | — | Include `docs/**` evidence in the standing scanner |

No credential needs revocation or rotation **on the evidence available**. GitHub-side secret-scanning alerts could not be listed with the tools in this session (NOT VERIFIED). Credentials that were never committed (hosted Supabase keys, the commit secret, the Sentry DSN) are outside this scan.

---

## 10. Dependency and supply-chain findings

| ID | Sev | Conf | Finding | Evidence | Recommendation |
|---|---|---|---|---|---|
| **DEP-001** | Medium (dev-only) | Confirmed (RAN `npm audit`) | `vitest@3.2.7` and `tinypool@1.1.1`: **critical** GHSA-5gmw-xhrv-c9v3 and GHSA-85c8-ppgw-ccpr (prototype-pollution gadgets → RCE in worker options). `@vitest/mocker`: **moderate** GHSA-82fw-gwwq-j7x9 (path traversal / file read through a redirect mock). npm's fix is `vitest@5.0.5`, a **major** upgrade. Not shipped: the Docker image prunes dev dependencies | `npm audit --json` | Exploitability needs attacker-controlled test configuration or a mock-server redirect, so the risk is to developer and CI machines only. Schedule the vitest major upgrade **after** the showcase, in its own PR with a full CI run. Do not upgrade during the freeze |
| **DEP-002** | Low | Confirmed (RAN) | `embedded-postgres@18.1.0-beta.16` (a **beta**) is the test database. It hard-codes the `en_US.UTF-8` locale and hides initdb's stderr, which caused the environmental failures F-1 and F-2 | `node_modules/embedded-postgres/dist/index.js:26,129-149` | Document the prerequisites (non-root user, `locale-gen en_US.UTF-8`) in the setup guide. Consider pinning a stable release when one exists |
| **DEP-003** | Low | Confirmed | `engines: ">=22"` is open-ended. B40–B46 release evidence was produced on **Node v24.20.0 on Windows** (`docs/phase46/release-evidence.json` `environment`), which CI does not test | CODE, DOC | Pin `engines` to `22.x` or add Node 24 to the CI matrix. Re-generate release evidence on the CI platform |
| — | Info | Confirmed (RAN) | Production `npm audit --omit=dev`: **0** vulnerabilities on base and merge | RAN | — |
| — | Info | Confirmed (RAN) | Install scripts limited to `esbuild`, `@embedded-postgres/*` and `fsevents`; every package resolves from `registry.npmjs.org` with integrity; workspaces are local links. No suspicious packages found | RAN lockfile scan | — |
| — | Info | Confirmed | The lockfile is unchanged by PR #31 (byte-identical); `package.json` adds 8 script lines | RAN `cmp`, `git diff --stat` | — |

**Advisory sources unavailable:** OSV-Scanner, Snyk and GitHub Dependabot alerts (no access). Only `npm audit` (the npm advisory DB) was used.

---

## 11. Supabase architecture and acceptance matrix

**Supabase services actually used:** Auth (GoTrue, including anonymous sign-in in the local config) and Postgres through PostgREST (tables with RLS, plus `SECURITY DEFINER` RPCs). **Not used:** Storage, Edge Functions, Realtime, database webhooks.

**Environment separation:** `SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected per environment. The API has no service-role variable. The local/acceptance tooling uses the service role only against `127.0.0.1`/`localhost`, and `scripts/ensure-local-postgrest.mjs:32-38` refuses remote Docker contexts and remote Supabase endpoints. Production refuses to start without a Sentry DSN and reports not-ready without `PROJECT_COMMIT_SECRET`.

| # | Capability | Expected behaviour | Evidence | Result | Remaining risk |
|---|---|---|---|---|---|
| S-1 | Config validation | Missing or invalid URL or key → start-up refused, value not echoed | RAN probe; CODE `env.ts` | **PASS** | — |
| S-2 | Readiness on Supabase outage | 503, no hang (timeout) | RAN probe | **PASS** | — |
| S-3 | Service role never on request paths | Anon key plus user JWT only | CODE `supabase.ts:191-197` | **PASS** (static) | Hosted deployment env not inspected |
| S-4 | Valid JWT accepted, identity mapped to `auth.uid()` | `getUser` → UUID → RLS | CODE; DOC live receipt 2026-10-14 | **NOT VERIFIED** (this session) | Runtime last proven on `c343855` (≤ `0029`) |
| S-5 | Invalid / missing / malformed token | 401 envelope | RAN probe (no token, `Basic`) | **PASS** (missing/malformed) | — |
| S-6 | Expired / revoked JWT | 401 via GoTrue | No GoTrue here | **BLOCKED** | Covered only by the live suite |
| S-7 | Auth upstream failure | 503 `AUTH_UNAVAILABLE`, not 401 | RAN probe | **PASS** | — |
| S-8 | RLS enabled on every exposed table | 39/39 (base), 42/42 (merge) | RAN migration analysis | **PASS** (static) | Hosted schema may differ (S-14) |
| S-9 | Definer functions hardened | `search_path` pinned; private schema revoked | RAN | **PASS** (static) | — |
| S-10 | Cross-user isolation (owner-only data) | Foreign project → 404; no rows | CI embedded-PG suites (113/125 files green); DOC live receipt | **PASS** (embedded PG, static) / **NOT VERIFIED** (real PostgREST + JWT for B34, B40–B46) | SUPA-002 |
| S-11 | Anonymous access | Only `project_read('public')`, `reference_download(token)` and rate-table selects | CODE grants | **PASS** (static) | — |
| S-12 | Collaboration (`0030`) member, viewer, non-member access | Member reads, viewer cannot comment, non-member 404 | CI `collaboration.integration.test.ts` on embedded PG | **NOT VERIFIED** on Supabase | No live scenario exists |
| S-13 | Transactions and concurrent writes | Idempotent replay and CAS commits | CI suites; DOC live "atomically replays concurrent durable operations" (≤ `0029`) | **NOT VERIFIED** (this session, live) | SEC-004 races in `0030` |
| S-14 | Hosted migration ledger matches the repository | Hosted = `0001`–`0029` (+`0030`) | DOC: last reported `0017`; script `scripts/verify-hosted-migrations.mjs` exists, never run by an operator | **BLOCKED** (no credential; must not be run by this audit) | **SUPA-001** |
| S-15 | Hosted Auth settings (anonymous sign-in, confirmations, JWT expiry, site URL) | Match the intended product policy | Only local `config.toml` visible | **NOT VERIFIED** | SEC-003 |
| S-16 | Database error mapping without leakage | Typed codes, no SQL text | CODE `*DatabaseError` mappers; RAN probe | **PASS** (static and probe) | — |
| S-17 | Local Supabase stack reproducible (`db:start`) | Starts, then acceptance runs | CODE script; no Docker daemon | **BLOCKED** | SUPA-003 |
| S-18 | Storage access / signed URLs | — | Not used | **NOT APPLICABLE** | — |
| S-19 | Edge Functions authorisation | — | Not used | **NOT APPLICABLE** | — |
| S-20 | Realtime permissions | — | Not used | **NOT APPLICABLE** | — |
| S-21 | Supabase webhooks / events | — | Not used | **NOT APPLICABLE** | — |
| S-22 | Retention and erasure (FKs, cascade vs immutability) | Erasure possible when policy requires it | CODE (§7, SUPA-004/005) | **NOT VERIFIED** (latent; no delete path exists) | Owner decision E-10 |

A passing embedded-PostgreSQL test is **not** treated as live Supabase acceptance in this matrix.

---

## 12. Supabase blockers and unverified checks

| ID | Sev | Status | Blocker | What is needed to complete it |
|---|---|---|---|---|
| **SUPA-001** | High | BLOCKED | Hosted migration state unknown: last reported `0017`; up to 12 (13 with `0030`) migrations may be pending | An authorised operator runs `HOSTED_DB_URL=… node scripts/verify-hosted-migrations.mjs` (read-only transaction, prints no credentials; tested in `hosted-migration-ledger.test.ts`) per `docs/release/b37-release-gates-runbook.md` §1. Then the owner decides whether to apply migrations through the normal controlled process |
| **SUPA-002** | High | NOT VERIFIED | No live (GoTrue + PostgREST + real JWT) acceptance for the **B34 repair**, **migration `0030`** or **any B40–B46 route** | Add live scenarios to `apps/api/tests/supabase.live.test.ts` for collaboration (owner, editor, reviewer, viewer, non-member, forged RPC), B40 plan execute/restore and B34 verification. Run `npm run test:supabase` on a Docker host or via `workflow_dispatch` |
| **SUPA-003** | Medium | BLOCKED here | Acceptance is manual-dispatch only (skipped on every CI run inspected), and `ensure-local-postgrest.mjs` fails on any non-ECR-v16.2 PostgREST image (E-X4) | Make the image check accept the CLI's actual image when the version is ≥ v16.3 (or drop the swap if the CLI now ships a fixed PostgREST). Trigger the job on PRs that touch `supabase/migrations/**` |
| **SUPA-004** | Low | NOT VERIFIED | `ON DELETE CASCADE` into immutable tables makes deletion impossible (latent; extended by `0030`) | Owner erasure/retention decision (E-10); then a migration replacing the cascade with explicit, audited erasure functions |
| **SUPA-005** | Low | Confirmed (CODE) | `user_settings.user_id` (DOC E-10) and `project_members.user_id` (`0030_collaboration.sql:6`) have no FK to `auth.users` | Add FKs (`on delete` per the retention policy) or document the soft reference |

---

## 13. Test-coverage gaps and regression risks

| ID | Sev | Gap | Risk | Proposed test |
|---|---|---|---|---|
| **TEST-001** | Low | Shutdown is tested only with a stubbed `flush → true` | BUG-001 went unnoticed | §6 regression test plus a no-DSN smoke variant |
| **TEST-002** | Medium | The B46 "end-to-end" scenario is **one** test (`e2e-pipeline.integration.test.ts`), on embedded PG with a fake auth schema; no showcase journey runs end-to-end through GoTrue/PostgREST | Integration drift between PostgREST/JWT and the new routes is invisible until hosted | A live "showcase journey" scenario (§15 J3–J9) in the live suite |
| **TEST-003** | Low | Test prerequisites are undocumented: non-root user, `en_US.UTF-8` locale; Windows shows `EBUSY` and path assertions | Contributors get misleading red runs (as in F-1 to F-3) | Document them; add a pre-flight check in `test-support/postgres.ts` that prints an actionable message instead of `exited with code 1` |
| (SUPA-002) | High | No live tests for `0030`, B34 or B40–B46 | See §12 | See §12 |
| (DEBT-003) | Medium | No test of orphaned-job recovery without an owner read | Stuck jobs in a long demo | §7 |
| — | Info | No contract test against the frontend (DOC E-X6) | Client breakage | Generated-schema conformance against frontend fixtures (roadmap test 47) |

---

## 14. Reliability and future-failure risks

| ID | Sev | Risk | Evidence | Mitigation |
|---|---|---|---|---|
| **DEBT-003** | Medium | No background job sweeper; no `ProviderCharge`; polling only (B32 gaps, E-09) | CODE, DOC | Implement the sweeper before running long-lived jobs in production |
| (SEC-002) | Medium | Per-process limits and spend state | CODE | Single instance for the showcase |
| **DEBT-001** | Low | In-process worker pools spawn on first use; first-request latency for scene and optimisation | CODE `app.ts` (pools "spawn on first use") | Warm up with one request before a live demo |
| **DEBT-002** | Low | Documentation sprawl: >100 phase documents, no index on the code branch; `main` status documents describe 2026-10-13/15 state | RAN | One maintained `README.md` plus a `docs/INDEX.md` |
| — | Info | Generator limits: ≤ 2 storeys and 24 rooms; many capabilities return typed refusals (`UNSUPPORTED`, `NOT_CLAIMED`) by design | DOC E-04, E-16b | Script the showcase around supported inputs (§15) |

---

## 15. Final-showcase acceptance checklist

"Tests" means the automated suite on embedded PostgreSQL (CI green on base and merge). "Live" means real Supabase Auth + PostgREST.

| # | Journey (entry → response) | Prerequisites | Evidence | Result | Blocker |
|---|---|---|---|---|---|
| J1 | Start-up, `/health/live`, `/health/ready`, graceful stop | Node 22, env vars, Supabase reachable | RAN probe | **PASS** with **BUG-001** on stop | BUG-001 (cosmetic) |
| J2 | Sign-in → authenticated request → identity → RLS | Supabase Auth configured; anonymous sign-in policy decided | RAN (401/503 paths); live DOC 2026-10-14 | **NOT VERIFIED** live | SUPA-002, SEC-003, S-15 |
| J3 | Create project → generate plan → QA-accepted revision | `PROJECT_COMMIT_SECRET` provisioned in DB and API | Tests (CI) | PASS (tests) / NOT VERIFIED (live, this session) | SUPA-001 |
| J4 | Takeoff → construction → BOQ cost estimate | Seeded rate tables (illustrative data) | Tests | PASS (tests) | State clearly that rates are synthetic (E-02) |
| J5 | Natural-language / structured change → B40 change-set → selective regeneration → restore | PR #31 merged | Tests (merge CI), B46 e2e (1 test) | PASS (tests, merge only) / NOT VERIFIED live | PHASE-002, SUPA-002 |
| J6 | Independent verification and scoped diff (B34) | — | Tests (PR #27 regression suites) | PASS (tests) / NOT VERIFIED live | B34 not accepted (PHASE-007) |
| J7 | 3D scene GLB and delivery manifest (B29/B45) | PR #31 for B45 | Tests | PASS (tests) | Frontend viewer unverified (SHOW-004) |
| J8 | Collaboration: invite member, comment, review (B44) | PR #31, migration `0030` applied | Tests on embedded PG | PASS (tests) / **NOT VERIFIED** on Supabase | SUPA-001, SUPA-002 |
| J9 | Construction documents and signed evidence package (B38) | — | Tests | PASS (tests) | No PDF/DXF (E-15a); present as SVG/CSV |
| J10 | Reference upload → download link | — | Tests | PASS (tests) | SEC-001: use only trusted demo files |
| J11 | Six specialist AI workflows (B39) | No AI provider needed (deterministic) | Tests | PASS (tests) | Several typed refusals by design |
| J12 | Cross-user isolation demonstration | Two test users | Tests; live DOC (≤ `0029`) | PASS (tests) / NOT VERIFIED live for new routes | SUPA-002 |
| J13 | Hosted / staging deployment of the integrated head | Hosted ledger checked; migrations applied by the owner; staging env | None | **BLOCKED** | **SHOW-001**, SUPA-001 |
| J14 | Frontend ↔ backend contract | Frontend repository | None (out of scope) | **NOT VERIFIED** | **SHOW-004** |
| J15 | Clean-checkout setup by a second engineer | A written guide | No README; stale `PHASE8.md` | **FAIL** (process) | **SHOW-002** |
| J16 | Reproducible demo data | Script creating demo users and projects | Seed has rate tables only; `scripts/staging-workflow-b37.mjs` / `-b39.mjs` (PR #29) could be adapted | **NOT VERIFIED** | **SHOW-003** |

### Showcase findings

| ID | Sev | Finding | Fix |
|---|---|---|---|
| **SHOW-001** | High | No verified hosted or staging environment for the integrated head (D-9/D-10 never run) | Decide the showcase target. **Lowest-risk option:** a disposable local Supabase stack plus the API on one machine, rehearsed twice. **Hosted option:** run D-9, apply migrations through the owner's process, then run W-B37/W-B39 (and a B40–B46 workflow) against staging |
| **SHOW-002** | High | No root README or single setup guide on the code branch; `docs/PHASE8.md:9` still says "Apply append-only migrations through `0005_idempotency.sql`" | Write `README.md`: prerequisites (Node 22, Docker, non-root, locale), env vars (from `.env.example`), `npm ci && npm run build`, `npm run db:start`, `npx supabase db reset --local`, provisioning `PROJECT_COMMIT_SECRET` from `project_private.commit_key`, `npm start`, and a smoke check |
| **SHOW-003** | Medium | No reproducible demo-data script; generator limits and typed refusals constrain what can be shown | Add `scripts/demo-seed.mjs` (local-only guard as in `ensure-local-postgrest.mjs`) that creates two users and a project walking J3–J11 |
| **SHOW-004** | Medium (High if the showcase is full-stack) | Backend–frontend contract conformance never checked (DOC E-X6) | Run the frontend against the local stack in rehearsal; diff `docs/modernization/openapi.json` against the frontend's client |

---

## 16. Complete pending-phase and PR inventory

### 16.1 Integration lines

| Line | Head | Contains | Status |
|---|---|---|---|
| `phase31/development` (default) | `6bd84a5` | B05–B39, the B34 repair (PR #27), B35.1, B36 (local), B37, B38, B39 S1–S3 | Integrated; CI green; **not released** (no tag after B30) |
| PR #31 `phase40/selective-revision-orchestration` | `4888360` | B40 S1 (`69ae94f`), B40 S2, B41–B46 S1 (via PR #30), migration `0030` | **Open**, CI green on the exact merge tree, 0 reviews, no description |
| PR #29 `phase39/b39-release-gates` (draft) | `c155d5a` | W-B39 staging script, rehearsal test, D-9/D-10/D-11 runbook | **Open draft**, CI green (2026-10-15), stale base `287b1a4` |
| `main` | `b06d082` | Audit and roadmap documents only | Unrelated history (PHASE-001) |

### 16.2 Per-phase inventory (B29 onward; B01–B28 summarised)

Statuses: **INTEGRATED** = on `phase31/development`. **PENDING-PR** = in an open PR. **READY** = may be merged as development code (not a release). **BLOCKED** = cannot be accepted without the named item. **UNVERIFIED** = insufficient evidence.

| Phase | Purpose | Branch / commit | PR | Impl. / tests | Depends on | Missing acceptance evidence | Readiness |
|---|---|---|---|---|---|---|---|
| B01–B04 | Monorepo, geometry, walls, topology | none (history starts at the B05 tag) | — | Reported only | — | No commit or tag (E-01) | UNVERIFIED (historical) |
| B05–B28 | Core persistence → optimisation | tags `backend-v1-phase5…28-complete` | — | Tagged; suites green | — | Re-audit not repeated here | INTEGRATED (released by tag) |
| B29 | 3D scene and walkthrough | tag `…phase29-complete` | — | GLB done; renders, 360°, walkthrough paths and LOD not built (E-06) | B28 | Gap items | INTEGRATED, partial |
| B30 | Selective revision and regeneration | tag `…phase30-complete` | #1/#2 | Done | B29 | Frontend verification deferred (E-07) | INTEGRATED |
| B31 | Secure reference ingestion | `phase31/development` | #3 | Works; no malware scan or quarantine | B30 | Roadmap gate (SEC-001) | BLOCKED (gate) |
| B32 | Durable jobs | `phase31/development` | #3 | Works; no sweeper, `ProviderCharge` or SSE | B31 | Roadmap gate (DEBT-003) | BLOCKED (gate) |
| B33 | Account, library, settings | `phase31/development` | #3 | Works | B32 | Erasure policy (E-10, SUPA-004/005) | INTEGRATED; owner decision |
| **B34** | Complex building verification | `phase34/diff-integrity` `4bcdac0` → merged `6bd84a5` | #27 (merged 2026-10-17) | 3 defects fixed with regression tests; 3 capabilities deferred (unified change report with quantity/cost deltas; drawing validation; hotspot↔BIM↔3D cross-checks) | B33, B37 | Live real-JWT run (E-11f); owner decision on the deferrals; closure record says "not accepted or closed" | INTEGRATED, **not accepted** (PHASE-007). Any further "separate B34 repair" is not visible on the remote: UNVERIFIED |
| B35 / B35.1 | Supertall engineering | `phase31/development` | #4, #7 | Typed blockers by design | B34 | Processing partitioning and shaft continuity (E-12) | INTEGRATED, partial |
| B36 | Cloud compute gateway | `phase31/development` | #10, #11 | Local pool only; `remoteExecution: DISABLED` (`compute/contracts.ts:30`) | B32 | Roadmap gate; owner decisions D1–D7 | BLOCKED (gate) |
| B37 | Unified model and dependency graph | `phase31/development` | #14, #17 | Manifest v2 | B36 | U1, U4–U6 minor; D-9/D-10 | INTEGRATED (waivers) |
| B38 | Construction documents and evidence | `phase31/development` | #15 | SVG, CSV, signed packages | B37 | PDF/DXF, sections, dimensions | INTEGRATED, partial |
| B39 | Six specialist AI workflows | `phase31/development` | #16, #20–#26, #28 | All six modules; typed refusals | B34 (now merged), B37 | D-10 staging (PR #29), D-11 tag | INTEGRATED; release gates in PR #29 |
| B40 | Autonomous large-scale integration | `69ae94f` (S1), `8857006` (S2) | #30 → #31 | S1 change-set plans and checkpointed regeneration; S2 analysis branches and task budgets | B39 | Live Supabase; owner review; no LLM planning; whole-model invalidation only | **PENDING-PR**, READY as development code after review; not accepted |
| B41 | Conversational AI expansion | `9399333` | #30 → #31 | S1 grounded instruction resolution (deterministic) | B40, B36 turns | Persistence, streaming, memory | PENDING-PR; partial |
| B42 | Fantasy-to-feasible engine | `0637833` | #30 → #31 | S1 feasibility ladder | B28 | Generated alternatives, ranking | PENDING-PR; partial |
| B43 | Model routing and evaluation | `4d6e52c` | #30 → #31 | S1 capability registry and routing dry-run | B21 | Execution, evaluation, spend ledger (E-18) | PENDING-PR; partial |
| B44 | Engineering collaboration | `4befc48` | #30 → #31 | S1 members, comments, reviews, audit; **migration `0030`** | B30, B40 diff | Live Supabase for `0030`; SEC-004; member access to analysis routes (owner decision) | PENDING-PR; partial; **migration release-gated** |
| B45 | Desktop 3D delivery | `db61d59` | #30 → #31 | S1 delivery manifest, ETag/304, compatibility | B29 | Chunked GLB, compression, LOD, GPU QA | PENDING-PR; partial |
| B46 | End-to-end benchmark | `3ea7a45`, `1ae43fd` | #30 → #31 | S1: 1 e2e test, `scripts/release-evidence.mjs` | All | Nine frontend scenario groups, stress tests, real-deployment gate (L428) | PENDING-PR; partial |

### 16.3 Other branches (unmerged into the PR #31 merge tree)

| Branch | Commits not in `phase31/development` + PR #31 | Assessment | Recommendation |
|---|---|---|---|
| `phase39/b39-release-gates` | 1 (`c155d5a`) | Open draft PR #29; merges clean onto the base (`00def8d`) and onto the PR #31 merge (`644887d`) | Integrate after PR #31 (PHASE-003) |
| `main` | 5 | Documents; unrelated history | PHASE-001 |
| `phase37/read-cap` | 1 (`0bf1c89`) | **Superseded**: `lib/bounded-reads.ts:2-5` cites `0bf1c89` and sets `READ_CONCURRENCY = 8` | Delete after owner confirmation |
| `phase39/s1-specialists` | 1 (`82d7373`, PR #24 closed unmerged) | **Superseded**: the FAILED mapping is live at `services/specialist-service.ts:197` via B39 S2 (PR #23) | Delete after owner confirmation |
| `phase35-1/workflow-resolution` | 1 (merge of dev into an old B35 line) | Superseded by PR #7 | Delete after owner confirmation |
| `docs/roadmap-research-baseline` | 2 (`a644225`, `56764c5`): roadmap research and knowledge-base index, +1,170 lines of docs | Never PR'd; content not reviewed here | Owner decides: open a docs PR or archive |
| All other 37 branches | 0 | Fully merged | Safe to delete (housekeeping) |

### 16.4 Phase and release findings

| ID | Sev | Conf | Finding |
|---|---|---|---|
| **PHASE-001** | High | Confirmed (RAN `git merge-base` → empty) | `main` (5 commits, docs) and `phase31/development` (178 commits, code) share **no ancestor**. Six paths exist on both: three identical (`docs/audit/AI-training-architecture-audit-2026-10-13.md`, both `docs/sources/*`) and **three different** (`docs/roadmap/authoritative-roadmap-reconciliation.md`, `next-phase-readiness.md`, `post-audit-risk-register.md`), which become add/add conflicts in any unrelated-histories merge |
| **PHASE-002** | High | Confirmed (GH, DOC) | PR #31 carries 8 commits of phase work (+15,820/−5,303, 64 files, migration `0030`) with **0 reviews** and no PR description. PR #30 merged after 17 minutes. Its evidence was produced on Windows / Node 24. CI on Linux is green (125/3,164). No B40–B46 phase is complete by its own records |
| **PHASE-003** | Medium | Confirmed | PR #29 is based on `287b1a4` (pre-B34-merge). Its runbook covers `0001`–`0029` only, and the W-B39 rehearsal has not run on the PR #31 head |
| **PHASE-004** | Low | Confirmed | 3 superseded branches and 1 un-PR'd docs branch (§16.3); 37 merged branches never deleted |
| **PHASE-005** | Medium | Confirmed (RAN tags) | No tag after `backend-v1-phase30-complete`; B31–B46 untagged; the roadmap DoD (§K) requires staging proof plus a tag for every phase |
| **PHASE-006** | Medium | Confirmed (GH) | B40–B46 introduced by a second contributor in one afternoon, then merged in two steps, with no review on either. Combined with SEC-007, this is the main release-governance risk |
| **PHASE-007** | Medium | Confirmed (DOC) | B34 is merged but explicitly "not accepted or closed": 3 deferred capabilities need an owner decision, and there is no live real-JWT run |
| **PHASE-008** | Medium | Confirmed (CODE) | B31, B32 and B36 roadmap gates are unmet (SEC-001, DEBT-003, `remoteExecution: DISABLED`). These cannot be "merged to complete"; they need build work |

---

## 17. Main-branch consolidation and release plan

**Principles:** a clean merge is not acceptance. Each step needs green CI on the exact merge result, plus the phase-specific evidence listed. Never force-push `main` or `phase31/development`. Do not merge anything that a live check has shown to be broken.

### 17.1 Recommended order

| Step | Action | Pre-conditions | Tests required after the step | Conflicts | Must not happen yet |
|---|---|---|---|---|---|
| 0 | **Owner decisions:** (a) the `main` strategy (below); (b) whether B40–B46 S1 slices ship in the showcase build; (c) the anonymous sign-in policy; (d) hold or merge any further B34 work | — | — | — | — |
| 1 | Fix **BUG-001** (+ TEST-001) in a small PR to `phase31/development` | — | Full CI; manual no-DSN SIGTERM check (exit 0) | None expected (`lib/sentry.ts` is touched by PR #31: rebase whichever lands second) | — |
| 2 | **Review and merge PR #31** into `phase31/development` | Human review of `0030_collaboration.sql`, `integration-service.ts` (291 lines), `routes/collaboration.ts`; **local Supabase acceptance** extended to `0030` (SUPA-002); PR description added | Full CI (already green on `ab67977`); `npm run test:supabase` on a Docker host; container smoke | Textually clean (`merge-tree` exit 0) | **Do not apply `0030` to any hosted DB** until step 5 |
| 2a | If a further **B34 repair** exists: land it **before** step 2, or merge it after step 2 and re-run `integration-branches.integration.test.ts`, `verification*.test.ts`, `specialists-verification.integration.test.ts` | Its own PR, CI and review | Those suites plus full CI | PR #31's B40 S2 runs B34 verification as an analysis branch; semantic coupling, no shared files | Do not assume it is ready |
| 3 | **Refresh and merge PR #29** (B39 release gates) | Update the runbook for `0030` and for B34 being merged; re-run the W-B39 rehearsal on the new head | Full CI; `staging-workflow-b39.integration.test.ts` | Clean onto the PR #31 merge (`644887d`) | Do not run W-B39 against staging until step 5 |
| 4 | **Consolidate `main`**: create `integration/main-consolidation` from `phase31/development`; `git merge --allow-unrelated-histories origin/main`; resolve the 3 roadmap documents (keep the newer revision and record the decision); open a PR **into `main`**. Because that branch now contains `main`'s history, the PR merges `main` forward without rewriting it. Then switch the default branch to `main` and keep `phase31/development` as an alias or retire it | Steps 1–3 merged; branch protection on `main` (one reviewer, CI required) | Full CI on `main` (the workflow already triggers on `main`, `backend-ci.yml:5`) | 3 add/add documentation conflicts (PHASE-001) | Never force-push `main`; never reset `main` to the code branch |
| 5 | **Release gates:** D-9 hosted ledger check (read-only) → owner applies pending migrations through the controlled process → D-10 staging workflows (W-B37, W-B39 and a new B40–B46 workflow) → D-11 tag(s) | Steps 1–4 | `verify-hosted-migrations.mjs` exit 0; staging evidence redacted | — | No tag before D-9 and D-10 pass |
| 6 | Housekeeping: delete superseded branches (§16.3) after owner confirmation; retire or refresh the stale `main` status documents | — | — | — | — |

### 17.2 Changes that must not be merged or enabled yet

- Applying `0030` (or anything after `0017`) to a hosted database without the D-9 ledger check.
- Enabling remote compute (`COMPUTE_POLICY` remote) or any real AI provider: no spend ledger, evaluation or consent model exists (E-18, B43).
- Marking B31/B32/B36 complete (gates unmet).
- Any vitest major upgrade during the showcase freeze (DEP-001).

---

## 18. Findings register

Severity counts: **Critical 0 · High 6 · Medium 15 · Low 12 · Informational 2** (35 findings).

| ID | Sev | Conf | Status | Location | Showcase impact | Section |
|---|---|---|---|---|---|---|
| BUG-001 | Low | Confirmed | Open | `lib/lifecycle.ts:6`, `lib/sentry.ts:79,89` | Visible error on stop | §6 |
| SEC-001 | Medium | Confirmed | Open | `references/contracts.ts:59` | Use trusted files only | §8 |
| SEC-002 | Medium | Confirmed | Open | `lib/http-protection.ts:14` | Single instance only | §8 |
| SEC-003 | Medium | Medium | Open (hosted unverified) | `supabase/config.toml:29,33` | Abuse of a public demo | §8 |
| SEC-004 | Low | Medium | Open | `0030_collaboration.sql:127-131,155,166` | Negligible | §8 |
| SEC-005 | Low | Confirmed | Open | `backend-ci.yml:28-29`, `Dockerfile:1` | None | §8 |
| SEC-006 | Info | Confirmed | Open | `project_private.commit_key` usage | None | §8 |
| SEC-007 | Medium | Confirmed | Open | GitHub process | Release-governance risk | §8 |
| SECRET-001 | Info | High | No exposure found | All refs | None | §9 |
| DEP-001 | Medium | Confirmed | Open (dev-only) | vitest 3.2.7 / tinypool 1.1.1 | None | §10 |
| DEP-002 | Low | Confirmed | Open | embedded-postgres beta | Local test friction | §10 |
| DEP-003 | Low | Confirmed | Open | `package.json` engines; B46 evidence | Evidence platform mismatch | §10 |
| SUPA-001 | High | Confirmed (unknown state) | BLOCKED | Hosted ledger | **Blocks hosted showcase** | §12 |
| SUPA-002 | High | Confirmed (gap) | NOT VERIFIED | `apps/api/tests/supabase.live.test.ts` | Untested auth path for new routes | §12 |
| SUPA-003 | Medium | Medium | BLOCKED here | `scripts/ensure-local-postgrest.mjs:40-43`; `backend-ci.yml:60-61` | Local stack may not start | §12 |
| SUPA-004 | Low | Medium | Latent | `0006_projects.sql:95-97`, `0030_…sql:65-66` | None | §12 |
| SUPA-005 | Low | Confirmed | Open | `0030_collaboration.sql:6`; `user_settings` | None | §12 |
| TEST-001 | Low | Confirmed | Open | `tests/hardening.test.ts:63` | — | §13 |
| TEST-002 | Medium | Confirmed | Open | `tests/e2e-pipeline.integration.test.ts` | Thin end-to-end proof | §13 |
| TEST-003 | Low | Confirmed | Open | `test-support/postgres.ts:58-66` | Setup friction | §13 |
| SHOW-001 | High | Confirmed | Open | Release gates D-9/D-10 | **Blocker (hosted)** | §15 |
| SHOW-002 | High | Confirmed | Open | No `README.md`; `docs/PHASE8.md:9` | **Blocker (reproducibility)** | §15 |
| SHOW-003 | Medium | Confirmed | Open | `supabase/seed.sql` | Ad-hoc demo data | §15 |
| SHOW-004 | Medium | Confirmed (gap) | NOT VERIFIED | Frontend contract | Blocker if full-stack | §15 |
| PHASE-001 | High | Confirmed | Open | `main` vs `phase31/development` | Blocks "consolidate to `main`" | §16–17 |
| PHASE-002 | High | Confirmed | Open | PR #31 | B40–B46 demo features unreviewed | §16 |
| PHASE-003 | Medium | Confirmed | Open | PR #29 | — | §16 |
| PHASE-004 | Low | Confirmed | Open | §16.3 branches | — | §16 |
| PHASE-005 | Medium | Confirmed | Open | Tags | No release identity | §16 |
| PHASE-006 | Medium | Confirmed | Open | PRs #30/#31 | — | §16 |
| PHASE-007 | Medium | Confirmed | Open | B34 closure record | Avoid deferred B34 features | §16 |
| PHASE-008 | Medium | Confirmed | Open | B31/B32/B36 | Avoid presenting as complete | §16 |
| DEBT-001 | Low | Medium | Open | Worker pools spawn on first use | First-request latency | §14 |
| DEBT-002 | Low | Confirmed | Open | Docs sprawl and stale `main` docs | Confusing for reviewers | §14 |
| DEBT-003 | Medium | Confirmed (by design) | Open | `jobs/runner.ts` | Stuck job in a long demo | §7, §14 |

The informational rows in §10 (production audit clean, install-script review, unchanged lockfile) are observations, not findings, and are not counted.

---

## 19. Prioritised repair order

1. **SHOW-002**: write the README / setup guide (unblocks everyone else's verification). ~2–3 h.
2. **BUG-001 + TEST-001**: a 3-line fix plus 2 tests. ~1 h including CI.
3. **SUPA-002 + SUPA-003**: extend the live suite to `0030`, B34 and B40–B46 journeys; fix the PostgREST image check; run it on a Docker host. ~4–6 h.
4. **PHASE-002 / SEC-007 / PHASE-006**: human review of PR #31 (focus on `0030`, `integration-service.ts`, `routes/collaboration.ts`), then merge. ~3–4 h review.
5. **SEC-004**: lock the collaboration caps (small migration `0031`, additive). ~1–2 h. It can ride with step 4's follow-up or wait until after the showcase.
6. **PHASE-003**: refresh PR #29 for `0030`, re-run the rehearsal, merge. ~1–2 h.
7. **PHASE-001**: consolidation PR into `main`. ~1–2 h including doc-conflict resolution and review.
8. **SUPA-001 / SHOW-001 / PHASE-005**: D-9 (operator), migration decision, D-10 staging, D-11 tag. Owner-dependent.
9. **SHOW-003 / SHOW-004**: demo seed script; frontend rehearsal. ~3–4 h.
10. **SEC-003**: anonymous-auth policy decision and quota change. ~1–2 h after the decision.
11. **Post-showcase:** SEC-001 (scanner/quarantine), DEBT-003 (sweeper), SEC-002 (shared limiter), DEP-001 (vitest major), SUPA-004/005 (retention), SEC-005/006 hardening, PHASE-008 gates.

---

## 20. Proposed 2–3-day repair and retesting plan

Estimates come from the findings above for one engineer plus an owner available for decisions. They are not a promise that every finding closes.

**Day 1: decisions, credentials, critical and data-integrity work, broken journeys**
- Morning: owner decisions (§17.1 step 0). There are **no confirmed credential exposures**, so no rotation work is needed. Confirm with the responsible owner that GitHub secret-scanning alerts are empty (not visible to this audit).
- BUG-001 + TEST-001 PR → CI → merge.
- README / setup guide (SHOW-002) → a second engineer follows it from a clean clone; record their result.
- Prepare a Docker host; fix `ensure-local-postgrest.mjs` (SUPA-003); run the existing live suite on `phase31/development` to re-baseline (expect 125/125).
- Start the PR #31 review.

**Day 2: root-cause fixes, regression tests, Supabase verification, gated integration**
- Add live scenarios for `0030` / B34 / B40–B46 (SUPA-002); run them on the PR #31 merge tree.
- Finish the PR #31 review; address findings (SEC-004 if accepted); merge only when CI **and** the live run are green.
- Refresh PR #29 → rehearsal → merge.
- Consolidation PR into `main` (PHASE-001) with branch protection enabled.
- If only two days are available: also do Day 3's clean-checkout run and showcase rehearsal today, and defer optional hardening (§19 item 11).

**Day 3 (if available): full acceptance**
- Clean-checkout verification on `main`: `npm ci`, build, typecheck, lint, full vitest, container smoke, live suite.
- D-9 hosted ledger check by the operator; the owner decides on migrations. D-10 staging workflows only if the hosted path is chosen.
- Demo seed script (SHOW-003); two end-to-end showcase rehearsals (J1–J16), with the frontend if full-stack.
- Release-readiness review: re-run the secret scan on the final head; `npm audit --omit=dev`; confirm no Critical/High finding is open without an owner waiver.

**Never** skip the live Supabase run or the review of PR #31 to meet the schedule, and never apply migrations to hosted without D-9.

---

## 21. Checks not performed and reasons

| Check | Reason | What would complete it |
|---|---|---|
| Local Supabase stack, live suite (`test:supabase`), `db:start`/`db:reset` | No Docker daemon in this container | A Docker host; `npm run db:start && npx supabase db reset --local && npm run test:supabase` |
| Container build and smoke | No Docker daemon | CI already green (runs 39007185316, 39134917974) |
| Hosted DB ledger, hosted Auth settings, staging | No credentials, and these must not be run by an audit | Operator per the runbook |
| Expired/revoked JWT behaviour | Needs GoTrue | Live suite |
| GitHub secret-scanning and Dependabot alerts; branch protection | Not exposed by the tools available to this session | Repository settings → Security; Branches |
| Dedicated scanners (gitleaks, trufflehog, semgrep, CodeQL, OSV) | Not installed; installing tools was out of scope | Add to CI |
| Full suite on Node 22.23.3 locally | Time; CI covers it | — |
| Full local suite on the PR #31 merge tree | CI ran it on the identical tree (125/3,164); locally I ran the targeted subset in §5.1 | — |
| Every route handler reviewed by hand | ~165 routes; time-boxed | Route-by-route authorisation review (owner-only via RLS is covered by tests) |
| Frontend contract | Frontend repository not in scope | §15 J14 |
| Re-audit of B05–B28 | Out of time scope; tags and green suites accepted | — |
| Contents of `docs/roadmap-research-baseline` | Docs-only branch, not PR'd | Owner review |

### Final Git status versus baseline

| Item | Baseline (start) | Final (end of audit) |
|---|---|---|
| Branch / HEAD | `main` @ `dd6e469` | `main` @ `dd6e469` (unchanged) |
| `git status --porcelain=v1 -b` | `## main...origin/main`, clean | `## main...origin/main` plus `?? docs/` (this report only) |
| Local branches, remote-tracking refs, stashes, tags | `main`, `origin/main`, 0 stashes, 0 tags | Unchanged (no `fetch` in this checkout) |
| Commits, pushes, PRs, merges, tags, releases | — | **None** |
| Application code, tests, config, dependencies, lockfile, migrations, workflows, existing docs | — | **Not modified** (none exist in this stale checkout; the code branches were inspected only through scratch copies) |
| Pre-existing unrelated changes | None | None |
| Outside the repository | — | Scratch mirror and worktrees in the session scratchpad; the container OS gained a compiled `en_US.UTF-8` locale (`localedef`, required by embedded-postgres); temporary test directories under `/tmp` were deleted after the runs |

The report is **not committed or pushed**, as instructed. Because this checkout is at the initial commit, `docs/` here contains only this file. The repository's existing documents live on the remote `main` (`b06d082`) and on the code branches, and they were not touched.

---

## 22. Final readiness assessment and limitations

**Code health: good.** Clean build, types and lint; 3,106 (base) and 3,164 (merge) passing tests in CI, reproduced locally (113/113 files and 3,106/3,106 tests passed locally (Linux, Node 22.22.0, exit 0, 779 s)); careful security engineering in RLS, definer functions, SSRF guards, error envelopes and secret hygiene; no secret in history.

**Showcase readiness: NOT READY yet. Conditionally achievable in 2–3 days.** The gaps are evidence and integration, not broken core logic:
- **Ready to demo locally** (after SHOW-002 and a rehearsal): J1, J3, J4, J6, J7, J9, J10 with trusted files, J11 and J12, on a disposable local Supabase stack with the base code.
- **Ready after PR #31 review plus a live run:** J5, J8 and the B41–B46 slices, each presented honestly as a first slice (typed refusals and `NOT_CLAIMED` are features, not bugs).
- **Blocked until owner and operator action:** any hosted or staging showcase (SUPA-001, SHOW-001) and any full-stack claim (SHOW-004).

**Release readiness: NOT READY.** No phase after B30 is tagged; D-9, D-10 and D-11 are open; B31, B32 and B36 gates are unmet; B34 and B40–B46 are not accepted by their own records.

**Limitations of this audit.** Static review was risk-focused, not exhaustive across all ~31k lines. Live Supabase, hosted and container behaviour were not exercised here, and every such row says so. CI results were read, not re-executed. A B34 repair in progress outside the remote could not be assessed. Line numbers refer to `6bd84a5` unless marked "merge".

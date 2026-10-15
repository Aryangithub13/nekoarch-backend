# B39 Release Gates: Operator Runbook (D-9 hosted ledger, D-10 staging proof, D-11 tag)

**Status:** prepared 2026-10-15. **None of these gates has been run.** No hosted database, staging deployment or production system has been contacted by the session that wrote this, and none of its environments holds a hosted or staging credential.

**Subject:** B39 on `phase31/development`:
- PR #26, merged as `4713218`: Interior with migration `0029`, U2 at whole-model granularity, acceptance audit;
- PR #28, merged as `287b1a4`: CI record.

**Related:** the B34 repair is PR #27 (separate session). The procedures below are the B37 runbook's ([`b37-release-gates-runbook.md`](b37-release-gates-runbook.md)), updated for B39.

## 1. Gate D-9: hosted migration-history check (read-only, authorized operator)

**Purpose:** learn which of `0001`–`0029` the hosted Supabase ledger records. The hosted state was last *reported* at `0017`; `0018`–`0029` are unverified. `0029_interior_finish_operations.sql` exists in the repository only.

**Tool:** [`scripts/verify-hosted-migrations.mjs`](../../scripts/verify-hosted-migrations.mjs).
- It does: one connection, `begin transaction read only`, read version and name from `supabase_migrations.schema_migrations`, `rollback`, then compare with `supabase/migrations/`.
- It never: writes, applies a migration, or prints a host, credential or driver error.
- Tested by `apps/api/tests/hosted-migration-ledger.test.ts`, which pins the latest local version at `0029`.

**Steps:**
1. Check out `287b1a4`, or the `phase31/development` commit under review, and run `npm ci`.
2. Run, with the credential in the environment only:
   ```sh
   HOSTED_DB_URL='postgresql://<read-only role>@<host>:<port>/postgres' node scripts/verify-hosted-migrations.mjs > ledger.json; echo "exit=$?"
   ```
3. Read the exit code:
   - **0:** consistent; pending migrations are listed. Expect at least `0029` pending.
   - **2:** inconsistent: an unknown version, a name mismatch, or a gap.
   - **1:** nothing was learned. Retry once only.
4. Review `ledger.json`: it holds versions, names, counts and a timestamp only. Commit it as `docs/phase39/evidence/hosted-ledger-<date>.json`.

**Forbidden:** `supabase db push`, `migration repair`, `db reset`, any DDL or DML, and secret changes. Applying `0018`–`0029` is a separate deployment decision made after this report. `0029` is additive (see [`b39-s3-implementation.md`](../phase39/b39-s3-implementation.md) §2), and a populated-upgrade test covers it.

**From a Claude Code cloud session**, two settings are needed:
- the credential, stored as an environment variable named `HOSTED_DB_URL` in the environment's settings;
- the database host allowed under the environment's network access.

Without both, the check cannot run there.

## 2. Gate D-10: staging proof of the six specialists (prepared; run only when authorized)

**Purpose:** ROADMAP §K (L788), "staging proof of at least one live user workflow", for B39: one supported request per module through the deployed API (gate L297).

**Prerequisites:**
1. A **disposable** staging Supabase project and API deployment. Never production.
2. Its ledger checked with §1, pointed at staging. Migrations `0001`–`0029` must be present **before** the API at `287b1a4` or later is deployed.
3. Two dedicated staging test users and their access tokens.

**Tool:** [`scripts/staging-workflow-b39.mjs`](../../scripts/staging-workflow-b39.mjs).
- It reuses the B37 script's target check: HTTPS origin only, `STAGING_CONFIRM=disposable-staging`, and two different users.
- It uses the public API only and stops at the first unexpected response. It never retries a write and never deletes. Its project ends `ARCHIVED`.

**Workflow W-B39:**

| # | Step | Checks |
|---|---|---|
| 1 | Health and discovery | `SPECIALISTS` is listed |
| 2 | Generate revision A | — |
| 3 | Materials, Budget and Structural on A | Artifacts on A, current. Budget `REQUIRES_REVIEW` on synthetic rates, never a complete total for partial coverage. Structural `REQUIRES_REVIEW`, nothing certified |
| 4 | Interior on A; execute, compare and approve, producing B | System locks present; geometry identical; B equals A except space finishes; A's outputs stale against B |
| 5 | Materials on B; Exterior cladding on B, completed to C | Model and geometry identical. **U2:** B's quantities stay `current` against C (`SOURCE_MODEL_EQUIVALENT`). C links its appearance and operation |
| 6 | Blueprint on C, producing D | One revision, no render job. Verification status recorded (B34). C is then `STALE_DEPENDENCY`, with nothing stored |
| 7 | Typed refusals and isolation | Space planning → `SCOPE_EXPANSION_REQUIRED`; seismic → `NO_VALIDATED_SOLVER`; other user → 404 |
| 8 | Latency and archive | 10 manifest reads timed; project archived |

**Rehearsed** (not run against staging) by `apps/api/tests/staging-workflow-b39.integration.test.ts`, against the API on local PostgreSQL with every migration:
- every step and check passes, all six modules write, and revisions A→B→C→D chain;
- the evidence contains no host, token or key;
- a refused user stops the run at its first write;
- disabling the U2 rule makes the run stop at its U2 check.

**Run:**
```sh
STAGING_CONFIRM=disposable-staging STAGING_API_URL='https://<staging-api>' \
STAGING_OWNER_TOKEN='<owner test token>' STAGING_OTHER_TOKEN='<other test token>' \
  node scripts/staging-workflow-b39.mjs > staging-b39.json; echo "exit=$?"
```
- **0:** every check passed.
- **2:** a step or check failed; `failedAt` names it.
- **1:** the run could not start.

Review the JSON, then commit it as `docs/phase39/evidence/staging-<date>.json`. **No staging proof is claimed until this file exists for a real staging run.**

## 3. Gate D-11: phase tag (on hold)

No tag is created. When the owner lifts the hold, the order is:
1. D-9 result recorded (§1).
2. Decision on applying `0018`–`0029` to the hosted project (separate).
3. D-10 evidence recorded (§2).
4. The B34 repair (PR #27) decided by the owner, and Blueprint re-verified on its merge.
5. CI green on the exact commit, and a `workflow_dispatch` `supabase-acceptance` run on it (the local receipt `docs/phase16-evidence/supabase-2026-10-14T17-30-30.615Z.json`, 125/125 on `c343855`, is not a CI receipt).
6. The owner chooses the tag name. The tag goes on the `phase31/development` commit that carries the D-9 and D-10 evidence.

# B37 Release Gates: Operator Runbook (D-9 hosted ledger, D-10 staging proof)

**Status:** prepared 2026-10-14 for the owner decisions D-9 (*operator*) and D-10 (*prepare*). **Neither gate has been run.** No hosted database, staging deployment or production system has been contacted by the session that wrote this. The phase tag (D-11) is on hold.

**Subject:** PR #17 (`phase37/manifest-v2`), **merged 2026-10-14 as `4d1da13`** on `phase31/development`; B37 accepted as development-complete (D-8). Merging is not a release: D-9, D-10 and D-11 below are unchanged. Gap report: [phase37-acceptance-gap-report.md](../phase37/phase37-acceptance-gap-report.md) §7, §8 and §11.

---

## 1. Gate D-9: hosted migration-history check (read-only, authorized operator)

**Purpose:** R03. Learn which of `0001`–`0028` the hosted Supabase ledger records. The hosted state is REPORTED at `0017`; `0018`–`0028` are unverified.

**Who:** an operator the owner has authorized, holding a hosted database credential. A read-only role is strongly preferred.

**Tool:** [`scripts/verify-hosted-migrations.mjs`](../../scripts/verify-hosted-migrations.mjs). What it does:
- Opens one connection.
- Runs `begin transaction read only`, reads `supabase_migrations.schema_migrations` (version and name only), then `rollback`.
- Compares the result with `supabase/migrations/`.

What it never does:
- write anything;
- apply a migration;
- print the connection string, host, credentials or a driver error.

Tested on PostgreSQL by `apps/api/tests/hosted-migration-ledger.test.ts`: the ledger is unchanged after the read, and a failure message contains no credential or host.

**Steps:**
1. Check out `4d1da13` (the PR #17 merge) or the later `phase31/development` commit under review, and run `npm ci`.
2. Run, with the credential in the environment only and never on the command line in shared history:
   ```sh
   HOSTED_DB_URL='postgresql://<read-only role>@<host>:<port>/postgres' node scripts/verify-hosted-migrations.mjs > ledger.json
   echo "exit=$?"
   ```
3. Exit codes:

   | Code | Meaning |
   |---|---|
   | 0 | Consistent: pending migrations are listed and allowed |
   | 2 | Inconsistent: an unknown hosted version, a name mismatch, or an out-of-order gap |
   | 1 | Could not read; nothing was learned. Retry **once** only after checking the credential and network |
4. Review `ledger.json` before sharing. It holds versions, names, counts and a timestamp only.
5. Commit it as `docs/phase37/evidence/hosted-ledger-<date>.json`, or send it to the owner, and record the result in the gap report §5.4.

**Forbidden:** `supabase db push`, `migration repair`, `db reset`, any DDL or DML, secret changes, and re-running a failed command in a loop. Applying pending migrations is a **separate** deployment decision, made after this report.

## 2. Gate D-10: staging proof of one live workflow (prepared; run only when authorized)

**Purpose:** ROADMAP §K (L788): "staging proof of at least one live user workflow". This is workflow W-B37 from the gap report §8.

**Prerequisites (owner):**
1. A **disposable** staging Supabase project and API deployment. Never production.
2. Its ledger checked with §1 (pointed at staging). Migrations `0001`–`0028` must be present before the API is deployed.
3. The deployed commit recorded: the PR #17 merge commit `4d1da13`, or a later `phase31/development` commit (record which).
4. Two dedicated staging test users and their access tokens.

**Tool:** [`scripts/staging-workflow-b37.mjs`](../../scripts/staging-workflow-b37.mjs). It uses only the public API, as the two test users.

| Step | Request | Required result |
|---|---|---|
| 1 | `GET /health/ready` | `ok` |
| 2 | `GET /api/capabilities` | Lists `PROJECT_MANIFEST` |
| 3 | `POST /api/projects` | New project |
| 4 | `POST …/revisions/generate` | Revision A |
| 5 | Takeoff, construction calculation, cost estimate, scene | Created. The cost uses the **sample** rate book, so it is not a real price |
| 6 | `GET …/manifest` for A | Everything `current`; nothing `verified` or `not_applicable` |
| 7 | Phase 30 appearance preflight | The candidate is listed as `NOT_ACCEPTED`; modules unchanged |
| 8 | Execute, then approve | Revision B |
| 9 | Manifest of A | Against B, takeoff, construction and cost are `current` (`SOURCE_MODEL_EQUIVALENT`): U2 at whole-model granularity, B39, owner decision 2026-10-14. Every other output is `stale`. Model and QA `superseded`; scene under `regenerate`, quantities and cost not |
| 10 | Manifest of B | `APPEARANCE_VARIANT` `current` and linked; lineage `RECORDED`; the appearance is bound to B's model |
| 11 | Partial view | Same `manifestHash` |
| 12 | Second user reads A's manifest | 404 |
| 13 | 20 sequential manifest reads | Median and maximum latency recorded |
| 14 | `PATCH /api/projects/:id {status: ARCHIVED}` | Archived; history is kept, nothing is deleted |

It stops at the first unexpected response and never retries a write. It refuses to start unless:
- `STAGING_CONFIRM=disposable-staging`;
- `STAGING_API_URL` is a bare **HTTPS** origin (plain HTTP is allowed only on loopback, for rehearsal);
- the two users are different.

**Rehearsed** (not run against staging) by `apps/api/tests/staging-workflow.integration.test.ts`, against the API on a local PostgreSQL. Every step and check passes. The evidence contains no host, token or key. The project ends `ARCHIVED`. A refused user stops the run at the first write.

**Run:**
```sh
STAGING_CONFIRM=disposable-staging STAGING_API_URL='https://<staging-api>' \
STAGING_OWNER_TOKEN='<test user 1>' STAGING_OTHER_TOKEN='<test user 2>' \
  node scripts/staging-workflow-b37.mjs > staging-b37.json; echo "exit=$?"
```

Exit codes:

| Code | Meaning |
|---|---|
| 0 | Every check passed |
| 2 | A step or check failed; `failedAt` names it |
| 1 | Refused to start |

**Also record:**
- **Evidence file:** the JSON, reviewed, committed as `docs/phase37/evidence/staging-<date>.json`.
- **Deployed commit:** with the Node version.
- **Error monitoring:** Sentry/log check for the run window: zero 5xx, no unexpected errors.
- **Failures:** any failure, unedited.

**No staging proof is claimed until this file exists for a real staging run.**

## 3. Gate D-11: phase tag (on hold)

No tag is created. When the owner lifts the hold, the proposed order is:
1. D-9 result recorded.
2. D-10 evidence recorded.
3. PR #17 merged by the owner: **done** (`4d1da13`, 2026-10-14).
4. Tag on the `phase31/development` commit that carries the D-9 and D-10 evidence, after local Supabase acceptance and CI pass on that exact commit. The owner chooses the name.

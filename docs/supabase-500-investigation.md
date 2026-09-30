# Dedicated Supabase 500 investigation

Current status (2026-09-30): the JWT clock failure was reproduced with its exact body and isolated to PostgREST 16.2 cached validator time. Local PostgREST was upgraded to 16.3 after the controlled comparison below. Application production behavior and JWT settings are unchanged. Release verification is complete: all gates passed, including both consecutive live Supabase acceptance runs. Earlier observations below are retained as historical evidence; the missing bodies of earlier incidents cannot be recovered.

## Proven observations

Retained local Kong logs expose the upstream status behind the recurring API 500. On all three historical dates below, a lookup of `idempotency_records` for `/api/plans` returned HTTP **401**, with a 79-byte response. These are not PostgreSQL HTTP 500s.

| UTC timestamp | Upstream request | Status / response bytes |
| --- | --- | --- |
| 2026-09-20 05:18:31 | GET `/rest/v1/idempotency_records` | 401 / 79 |
| 2026-09-21 14:38:17 | GET `/rest/v1/idempotency_records` | 401 / 79 |
| 2026-09-27 08:53:47 | GET `/rest/v1/idempotency_records` | 401 / 79 |

All three used operation `/api/plans`, key SHA-256 `143194a90f160b08f94ee2222eccfcf993bb6f2c23ecff75ec17eede30d34c50` (the existing acceptance fixture). In the Phase 14 window, one concurrent lookup returned 401, three lookups returned 200, and all three subsequent `commit_idempotent_creation` RPCs returned 200. The failing request never reached that RPC. The retained access logs do not contain its response body or request ID.

`SupabaseRepository.lookupIdempotency` sends its error to `databaseError`, which maps unrecognized codes to sanitized API HTTP 500 / `DATABASE_ERROR`. No corresponding PostgreSQL statement error was found in retained logs for this failure. Consequently there is no observed SQLSTATE to report for the historical failure; inventing one would misattribute this pre-database failure.

Actual stack: PostgreSQL 17.6 (`public.ecr.aws/supabase/postgres:17.6.1.167`), PostgREST 16.2 (`public.ecr.aws/supabase/postgrest:v16.2`), GoTrue 2.196.0, Kong 2.8.1. Database default isolation is read committed. PostgREST reports a maximum pool size of 10.

## Local diagnostic runs

`scripts/investigate-supabase-500.ts` observes the unchanged API and real Auth/PostgREST requests. It records API request IDs, safe upstream error bodies, request ordering/times, operation/key/fingerprint hashes, PostgreSQL connection lifetimes and sampled advisory locks. Tokens, signing material and share tokens are redacted; only newly created diagnostic identities/data are removed. It performs no retries.

- 20 rounds, four concurrent requests per operation across plans, generation and estimates: 240/240 API requests passed; 239 RPCs executed (one request found an already-committed receipt); maximum RPC duration 12.233 ms. Five authenticator connections observed. Advisory locks were held and released across commits, including observed blocked waiters. No lock timeout, deadlock or pool error.
- 40 rounds with a fresh anonymous identity each round: 480/480 passed during continuous activity.
- A further two-round fresh-identity probe: 24/24 passed.
- Nine independent trials each primed REST, kept it idle for 40 seconds, issued a fresh anonymous token, then sent four concurrent requests per operation: 108/108 passed. There was no hidden Kong REST traffic during the inspected idle interval and PostgREST has no Docker healthcheck. Later trials also directly counted exactly two plans, two generation audits, one estimate and three receipts per trial. Cleanup had no reported failures.

Total observed diagnostic traffic: **852 API requests, zero reproduced errors**. Successful probes do not establish that the intermittent defect is fixed.

The first three run summaries were retained in tool output before an execution interruption; their original `/tmp` traces are no longer present. Current controlled-idle traces are summarized, with request IDs, ordering and lock samples, in `docs/supabase-500-investigation-evidence.json`. This distinction prevents claiming recoverable detail that was not preserved.

## Remaining hypothesis (not yet established locally)

A 79-byte body is consistent with `{"code":"PGRST303","details":null,"hint":null,"message":"JWT issued at future"}`. PostgREST has an upstream defect that serves stale cached current time for JWT validation after idle periods. The installed 16.2 predates the fix in 16.3. The upstream [fix PR #5208](https://github.com/PostgREST/postgrest/pull/5208) replaces `auto-update` with direct `getSystemTime`; the [release changelog](https://github.com/PostgREST/postgrest/blob/main/CHANGELOG.md) identifies 16.3 as including the fix.

This is a strong candidate, not proof that these particular historical responses carried that message. Controlled idle/fresh-token reproduction with the exact local body remains necessary. No tests have been weakened, no blind retries introduced, and no production code or infrastructure version changed.

## Evidence boundaries

The 5-second advisory lock timeout is not implicated by the captured timings: the warm probe's longest commit RPC was approximately 12 ms. Read-committed isolation and per-key transaction advisory locks are consistent with the observed single receipts and identical concurrent responses. Samples show both granted advisory locks and waiting sessions; these samples are observations, not a complete transaction trace.

The historical failing API request IDs and response bodies were not retained by earlier suites. The new observer captures them on any future reproduction. No historical PostgreSQL SQLSTATE, backend PID or transaction ID can be honestly attached to the HTTP 401. The historical 500 classification is explained by the adapter's existing unknown-error mapping; changing that mapping would not repair the underlying rejection and has deliberately not been done.

To rerun the observer from the repository root:

```sh
npx tsx scripts/investigate-supabase-500.ts
INVESTIGATION_FRESH_AUTH=true INVESTIGATION_ROUNDS=40 npx tsx scripts/investigate-supabase-500.ts
INVESTIGATION_IDLE_MS=40000 INVESTIGATION_ROUNDS=1 npx tsx scripts/investigate-supabase-500.ts
```

The idle option first makes a successful read, then leaves REST idle **before issuing a new token**. This creates an experimental precondition; it is not a delay used to make a rejected operation succeed. The observer stops after a failed round and never retries a failed operation. Run it exclusively against the repository's local stack so other traffic cannot invalidate the idle experiment.

## Outcome and next discriminating experiment

No source defect in the advisory-lock/idempotency transaction was demonstrated. No production source, migration, container image, JWT tolerance, test assertion, or retry policy was changed. The new diagnostic script passed ESLint and produced no TypeScript diagnostics. Because the root cause was not reproduced, no speculative fix or artificial regression test was added, and an unaffected full test-suite rerun is not represented as proof of a repair.

The leading candidate is the installed PostgREST 16.2 validator-time cache defect. The primary-source [16.2 implementation](https://github.com/PostgREST/postgrest/blob/v16.2/src/library/PostgREST/AppState.hs) caches current time through `mkAutoUpdate`; [16.3](https://github.com/PostgREST/postgrest/blob/v16.3/src/library/PostgREST/AppState.hs) reads current time directly. The [JWT validator](https://github.com/PostgREST/postgrest/blob/v16.2/src/library/PostgREST/Auth/Jwt.hs) allows 30 seconds of skew. An unrelated database deadlock/pool issue is poorly supported by the collected evidence because the historical failure precedes the commit RPC and its companion requests commit successfully.

To establish the candidate locally, retain the observer across a substantially longer real idle/suspend interval and capture the first fresh-token rejection. The exact `code`, message, API request ID and token timing claims must match before attributing it to the cache. A subsequent isolated comparison of 16.2 with the fixed 16.3, using unchanged JWT validation and request concurrency, would verify the smallest infrastructure correction. That comparison and any version change were not performed in this investigation.

## September 29 recurrence (new evidence, investigation resumed)

After a two-day execution/host interruption, the first final live gate again failed: **35/36 passed**, with the same existing concurrent durable-operation case returning 500. This failed gate remains recorded; it is not replaced by a later rerun. At **2026-09-29 12:17:31 UTC**, Kong recorded three receipt lookups returning HTTP **401 / 79 bytes**, a fourth lookup returning 200, and the sole subsequent `commit_idempotent_creation` RPC returning 200. The key hash again matches `143194a90f160b08f94ee2222eccfcf993bb6f2c23ecff75ec17eede30d34c50`. Access-log evidence is preserved in the evidence JSON. The actual response body and API request IDs were not captured by that gate.

The next bounded experiment uses a disposable PostgREST replica: prime its clock, pause only that process for 40 seconds, issue a fresh real Auth JWT while it is paused, resume, and route four otherwise unchanged API requests to that replica. The active stack is not paused or reconfigured. A fixed-version comparison is conditional on reproducing the exact rejection.


## September 30 final sign-off: captured rejection and controlled repair

The first dedicated diagnostic, before any release acceptance retry, failed at **2026-09-30 09:32:58 UTC / 15:02:58 IST**: 3 of 12 API requests returned 500. Their receipt lookups returned **HTTP 401**, exactly `{"code":"PGRST303","details":null,"hint":null,"message":"JWT issued at future"}`. This is now an observed body, not a length-based hypothesis. The fresh token had `iat=1790760778`, `exp=1790764378`; receipt time was `2026-09-30T09:32:58.058Z`, consistent with issuance and far before expiration. The same token's fourth concurrent lookup and subsequent write succeeded. No failing request reached `commit_idempotent_creation`; no SQLSTATE applies to the pre-database authentication rejection. Response request-ID headers were absent; API request IDs and ordering were captured. Original trace, pool/lock samples, cleanup results and bounded Kong logs are preserved under `phase15-signoff-evidence/`. REST and PostgreSQL container logs contained no entries in that captured interval.

A bounded existing reproduction started a **disposable replica** with the active service's configuration, primed its validator clock, paused only that replica for 40 seconds, issued a real fresh local Auth token, queued four unchanged API operations, and resumed the replica. This pause induces the suspected stale-clock condition; it is not a production delay or a failed-operation retry. Results:

| Image | API statuses | Upstream rejection | Stored result |
| --- | --- | --- | --- |
| `public.ecr.aws/supabase/postgrest:v16.2` | 500, 500, 201, 201 | Two exact PGRST303 / JWT issued at future bodies | One plan, one receipt |
| `public.ecr.aws/supabase/postgrest:v16.3` | 201, 201, 201, 201 | None | One plan, one receipt |

The old-version token issuance matched wall time at 09:34:21 UTC; the primed clock was 09:33:41 UTC. The fixed-version experiment used the same pause, fresh-token flow, concurrency, database and JWT configuration. All temporary replica containers and identities were cleaned up with no reported cleanup failure. Both images run on the same local Docker host/kernel; no host clock or JWT claims were modified. The underlying validator's in-process cached time is not exposed, so its stale value is inferred from the controlled experiment and the implementation, not represented as a directly sampled clock.

Upstream evidence: [fix PR #5208](https://github.com/PostgREST/postgrest/pull/5208), [16.2 AppState](https://github.com/PostgREST/postgrest/blob/v16.2/src/library/PostgREST/AppState.hs), and [16.3 AppState](https://github.com/PostgREST/postgrest/blob/v16.3/src/library/PostgREST/AppState.hs). Version 16.2 supplies cached time via `mkAutoUpdate`; 16.3 uses a direct current-time read. The [16.2 JWT validator](https://github.com/PostgREST/postgrest/blob/v16.2/src/library/PostgREST/Auth/Jwt.hs) rejects issuance more than 30 seconds in the future relative to that supplied time. Together with the natural and controlled reproductions, this establishes the defect for the September 30 failure. Historical September 20/21/27/29 incidents have matching endpoint/status/length, but their lost bodies prevent individually proving the same cause.

### Smallest safe correction

Only local REST infrastructure changed: **PostgREST 16.2 → 16.3**. `scripts/ensure-local-postgrest.mjs` checks local Docker/Supabase scope, replaces only the known stateless 16.2 REST container, preserves its environment/JWT configuration, network address and aliases, and restores the old service on replacement failure. It refuses unknown images or container layouts. No database container, data volume, migration history or signing secret is changed. `npm run db:start` and the existing opt-in Supabase CI job invoke it so a newly created stack does not silently return to 16.2. The script's bounded readiness polling applies only to service startup; it does not retry application operations. The no-op path was also checked against the already upgraded service. Use `npm run db:start` for future local startup; invoking the bundled CLI directly can recreate its older default image. The narrowly scoped repair script deliberately refuses an unexpected image so any later infrastructure upgrade gets its own review.

`probe-postgrest-clock.ts` now fails its fixed-version regression gate if any expected API response is missing or non-201. No acceptance test was weakened or skipped. A separate post-fix dedicated diagnostic completed **240/240 API requests**, with no upstream errors or cleanup failures. Full release verification and the two final live acceptance runs are recorded in `phase15-verification.json` when complete.

Remaining boundary: this repair addresses the locally reproduced validator-time defect. It does not establish the bodies of earlier uninstrumented incidents or promise that all possible future infrastructure failures are eliminated.


Final outcome: full fresh verification passed, including 36/36 live Supabase tests twice consecutively. The corrected service remained on PostgREST 16.3. No final acceptance failure occurred. The failing initial diagnostic and both version-comparison traces remain preserved.

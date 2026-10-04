# Phase 21 release review

**FULLY IMPLEMENTED AND VERIFIED** within the documented bounded provider-orchestration scope. External AI providers are advisory. NekoArch deterministic systems remain authoritative.

## Checkpoint and preservation

Work began on main from clean approved stabilization commit `18d6f8cf9e880a2fd06995206febc8d765bc0bb1`, created as one append-only commit with the exact approved 118 files and 253 verified source hashes. Annotated tags `backend-v1-phase19-verified-20261003` and `backend-v1-phase20-complete` point to it. Historical `backend-v1-phase19-complete` still points to `f17a33703b226117ad3cbfa4f25a1889dccce71b`.

The earlier stabilization manifest preserves its successful 10:56:05 UTC diff-check execution, while the standalone record reflects the later successful 11:04:46 UTC execution. Runner behavior and sequence corroborate separate runs. Historical timestamps and raw evidence were not edited. The approved whitespace findings in 23 historical evidence logs were preserved. No history rewrite, push, deployment, database reset or experimental frontend change occurred.

## Architecture, registries and reused code

The Phase 20 conversation planner, deterministic parser, strict intent schema, local OpenAI-compatible adapter, native normalization, approval flow and durable leases remain in use. A normalized typed request/response boundary now feeds a provider registry, separate model registry and capability registry. Routing is server-owned and deterministically ordered by configured provider priority, model priority and stable identities. Filters enforce enabled state, capability, structured output, context, privacy, cost and recent failure protection.

ARCHITECTURAL_INTENT_EXTRACTION is available. All other language/media/document/engineering capability entries are explicitly planned. Phase 16 workflow geometry, QA, quantities, construction and cost capabilities remain authoritative and unchanged. There is no model-authored nativeUpdate, autonomous tool loop, fake image/3D output or engineering authority.

## Failure, privacy and provider security

Fallback proceeds through eligible configured models within a shared deadline and call budget, then the existing deterministic parser if allowed. No route can silently relax privacy. Default LOCAL_ONLY and free/local operation require no paid service. Remote operation requires explicit system/model privacy and cost policy, exact server-owned HTTPS endpoint/hostname allowlisting and server-side credential references.

Remote DNS results are checked for private/reserved IPv4 addresses and pinned into TLS lookup without changing hostname verification. Redirects, URL credentials, query/fragment manipulation, unsafe protocols and malformed credential headers are rejected. Remote transport is IPv4-only. Provider response bodies are bounded; malformed JSON, forbidden fields, truncated structured output and tool calls are rejected. Strict semantic/native processing still follows accepted intent.

Transient retries use bounded backoff. Auth/schema/policy errors do not retry. Total inference budget is capped at 15 seconds, provider attempts at 10 seconds, and total calls at six. Circuits, concurrency limits, request windows and health are process-local; half-open recovery permits one probe. Supported transports cancel DNS/socket/body work on timeout or caller disconnect, including disconnect after the request body has arrived.

## Conversation integration, provenance and accounting

Provider calls occur after the existing signed durable message reservation. Duplicate accepted message replays avoid a second call. Expired/replaced leases reject stale completion; exact approval and revision CAS remain unchanged. Failure cannot commit a partially interpreted conversation or fabricated revision. Disabled mode, pending bedroom moves, explicit native replacements and bounded history retain their regression coverage.

The optional orchestration state field records provider/model identity, capability, routing reason, fallback position, attempts, latency, typed failure, request count and usage. intentSource distinguishes applied provider intent from parser-authoritative interpretation. Unknown token usage stays null. Cost is estimated only from available token counts and configured rates. Provider metadata is excluded from requirements/model/generation identities. Structured logs redact credentials, prompts, context and endpoint/configuration fields.

No migration was needed: safe optional provenance fits the existing bounded JSONB conversation contract. No provider secrets are persisted. All twelve migrations and the deterministic source trees are unchanged; see [source preservation](phase21-evidence/source-preservation.json).

## Acceptance evidence

The exact brief was: “Design a 3 bedroom two floor house on a 30 by 50 foot plot. Keep one bedroom downstairs.” Each acceptance path reaches a real V2 solver, independent QA PASS and signed immutable PostgreSQL revision after exact proposal approval:

- [Local protocol provider](phase21-evidence/local-success.json): validated synthetic provider response and measured usage; deterministic explicit constraints retain precedence.
- [Provider outage](phase21-evidence/provider-offline.json): HTTP 500 simulation, one attempt, deterministic fallback, correct proposal and revision.
- [Actual stopped provider](phase21-evidence/connection-refused.json): ordinary ephemeral server closed, ECONNREFUSED independently observed, one attempt and successful fallback/revision.
- [LOCAL_ONLY privacy](phase21-evidence/privacy-local-only.json): configured remote adapter rejected by policy with zero provider requests, followed by successful deterministic generation.

Controlled remote DNS/HTTPS fixtures also verify a secondary allowed remote route, credentials restricted to headers, pinned DNS, redirect rejection and typed HTTP failures. No paid vendor call or real-model language-quality claim is made. Tests cover concurrent identical messages, stale lease completion, caller disconnect and cross-project/cross-owner rejection before provider access.

## Exact verification commands and results

Counts overlap; do not sum them as unique tests. Final gate records contain source hashes, log hashes and a check that source did not change during execution. [Verification manifest](phase21-evidence/verification.json).

| Command | Status / exit | Seconds | Test count | Evidence |
| --- | --- | ---: | --- | --- |
| `npm run build` | PASS / 0 | 13.223 | — | [build](phase21-evidence/build.txt) |
| `npm run typecheck` | PASS / 0 | 20.515 | — | [typecheck](phase21-evidence/typecheck.txt) |
| `npm run lint` | PASS / 0 | 3.342 | — | [lint](phase21-evidence/lint.txt) |
| `npm run test:ai-orchestration` | PASS / 0 | 22.338 | 120 passed (120) | [test:ai-orchestration](phase21-evidence/test:ai-orchestration.txt) |
| `npm run test:unit` | PASS / 0 | 38.927 | 1771 passed (1771) | [test:unit](phase21-evidence/test:unit.txt) |
| `npm run test:generator` | PASS / 0 | 15.567 | 491 passed (491) | [test:generator](phase21-evidence/test:generator.txt) |
| `npm run test:blueprint` | PASS / 0 | 7.660 | 137 passed (137) | [test:blueprint](phase21-evidence/test:blueprint.txt) |
| `npm run test:blueprint-qa` | PASS / 0 | 14.088 | 177 passed (177) | [test:blueprint-qa](phase21-evidence/test:blueprint-qa.txt) |
| `npm run test:solver-v2` | PASS / 0 | 25.294 | 40 passed (40) | [test:solver-v2](phase21-evidence/test:solver-v2.txt) |
| `npm run test:projects` | PASS / 0 | 18.620 | 23 passed (23) | [test:projects](phase21-evidence/test:projects.txt) |
| `npm run test:takeoff` | PASS / 0 | 20.797 | 23 passed (23) | [test:takeoff](phase21-evidence/test:takeoff.txt) |
| `npm run test:construction` | PASS / 0 | 18.561 | 34 passed (34) | [test:construction](phase21-evidence/test:construction.txt) |
| `npm run test:cost` | PASS / 0 | 20.774 | 39 passed (39) | [test:cost](phase21-evidence/test:cost.txt) |
| `npm run test:workflows` | PASS / 0 | 20.567 | 51 passed (51) | [test:workflows](phase21-evidence/test:workflows.txt) |
| `npm run test:interpretation` | PASS / 0 | 17.791 | 133 passed (133) | [test:interpretation](phase21-evidence/test:interpretation.txt) |
| `npm run test:conversations` | PASS / 0 | 19.243 | 52 passed (52) | [test:conversations](phase21-evidence/test:conversations.txt) |
| `npm run test:integration` | PASS / 0 | 60.383 | 187 passed (187) | [test:integration](phase21-evidence/test:integration.txt) |
| `npm run test:supabase` | PASS / 0 | 67.565 | 84 passed (84) | [test:supabase](phase21-evidence/test:supabase.txt) |
| `npm run db:test` | PASS / 0 | 2.786 | 51 PgTAP assertions | [db:test](phase21-evidence/db:test.txt) |
| `npm run check` | PASS / 0 | 164.067 | 1960 passed (1960); 133 passed (133); 52 passed (52) | [check](phase21-evidence/check.txt) |
| `node --import tsx scripts/benchmark-ai-orchestration.ts` | PASS / 0 | 0.627 | — | [benchmark](phase21-evidence/benchmark.txt) |
| `docker build -t designflow-api:phase21 .` | PASS / 0 | 74.048 | — | [docker-build](phase21-evidence/docker-build.txt) |
| `node scripts/smoke-container.mjs designflow-api:phase21` | PASS / 0 | 1.273 | — | [docker-smoke](phase21-evidence/docker-smoke.txt) |
| `docker run --rm -i --network none designflow-api:phase21 node --input-type=module < docs/phase21-evidence/container-acceptance.mjs` | PASS / 0 | 0.693 | — | [docker-acceptance](phase21-evidence/docker-acceptance.txt) |
| `git diff --check` | PASS / 0 | 0.015 | — | [diff-check](phase21-evidence/diff-check.txt) |
| `node --import tsx docs/phase21-evidence/connection-refused-acceptance.mjs` | PASS / 0 | 2.152 | — | [connection-refused-acceptance](phase21-evidence/connection-refused-acceptance.txt) |

Earlier passing runs before the disconnect and response-size fixes are retained in explicitly superseded directories. One superseded gate detected source changing during execution and was not accepted as final verification. The final source is identical across all final gate manifests. No tests, budgets, security assertions or lint rules were weakened; the import allowlist was extended to the named orchestration modules, with network imports restricted to the transport module.

## Performance

Local fixture measurements exclude actual model inference. The conversation metric covers planning, while the acceptance artifacts include HTTP/database/approval/generation latency. These measurements are observations, not production SLOs.

| Operation | Samples | Median ms | p95 ms |
| --- | ---: | ---: | ---: |
| routing | 1000 | 0.0043 | 0.0061 |
| contextConstruction | 1000 | 0.0020 | 0.0034 |
| validation | 1000 | 0.0170 | 0.0401 |
| deterministicFallback | 100 | 0.0395 | 0.1713 |
| adapterOverhead | 100 | 0.0930 | 0.1598 |
| localHttp | 50 | 0.7753 | 2.6859 |
| conversation | 100 | 1.4926 | 3.6826 |

A burst of 32 requests observed at most 4 active provider operations: 4 provider successes and 28 immediate bounded fallbacks, in 5.943 ms. Process peak RSS was 172104 KiB. Memory snapshots are in [performance.json](phase21-evidence/performance.json); they do not establish a production-scale load or memory-leak guarantee.

## Database data preservation

All pre-existing public-table row digests were retained, including 620 projects and 679 revisions. Migration history, RLS flags and policy digests remain unchanged. Existing live acceptance behavior retained 33 new fixture projects and 37 new revisions, plus their associated QA, takeoff, calculation, cost, workflow and audit records. Counts and preservation comparisons are in [data-preservation.json](phase21-evidence/data-preservation.json). No existing rows were reset or deleted.

## Exact files changed

Source, configuration, tests and benchmark:

- `.env.example`
- `apps/api/src/ai/conversation-planner.ts`
- `apps/api/src/ai/conversation-provider.ts`
- `apps/api/src/ai/orchestration/conversation.ts`
- `apps/api/src/ai/orchestration/orchestrator.ts`
- `apps/api/src/ai/orchestration/registry.ts`
- `apps/api/src/ai/orchestration/transport.ts`
- `apps/api/src/config/ai.ts`
- `apps/api/src/config/env.ts`
- `apps/api/src/contracts/ai-orchestration.ts`
- `apps/api/src/contracts/conversations.ts`
- `apps/api/src/lib/logger.ts`
- `apps/api/src/routes/conversations.ts`
- `apps/api/tests/ai-orchestration.integration.test.ts`
- `apps/api/tests/ai-orchestration.test.ts`
- `apps/api/tests/ai-remote.test.ts`
- `apps/api/tests/ai-transport.test.ts`
- `apps/api/tests/interpretation.test.ts`
- `package.json`
- `scripts/benchmark-ai-orchestration.ts`

Documentation: phase21-design.md, this report and phase21-evidence/. The [complete changed-path inventory](phase21-evidence/changed-files.json) enumerates every new artifact and log, including superseded attempts. Phase 21 remains unstaged and uncommitted on main; the index is empty. The only commit/tags created in this task are the separately approved Phase 19/20 checkpoint.

## Known limitations and release readiness

- Health, quotas and circuit protection are process-local. Durable conversation reservations remain database-backed.
- Only architectural intent extraction is operational; future capabilities remain planned.
- Remote adapter interoperability is verified with controlled DNS/HTTPS fixtures, not a paid vendor or real-model quality evaluation. IPv6-only remote endpoints are unsupported.
- Arbitrary future in-process adapters must honor AbortSignal to stop their own work; the included transports do so.
- Cost is optional estimated metadata; there is no durable billing ledger or cluster-wide accounting service.
- Parser scope, bounded geometry/engineering limitations and deployment constraints from Phases 19/20 remain applicable.
- Raw verification stdout is preserved byte-for-byte; terminal whitespace in evidence logs is not source-code whitespace.

Phase 21 is ready for human review and an append-only release checkpoint. Phase 22 can begin after review and recording that checkpoint, carrying these boundaries forward; Phase 22 was not started. No frontend, paid inference requirement, new persistent infrastructure or migration was introduced.

After reviewing the exact inventory and raw evidence, proposed commands (not executed):

```bash
git add -- .env.example apps/api/src/ai/conversation-planner.ts apps/api/src/ai/conversation-provider.ts apps/api/src/ai/orchestration/conversation.ts apps/api/src/ai/orchestration/orchestrator.ts apps/api/src/ai/orchestration/registry.ts apps/api/src/ai/orchestration/transport.ts apps/api/src/config/ai.ts apps/api/src/config/env.ts apps/api/src/contracts/ai-orchestration.ts apps/api/src/contracts/conversations.ts apps/api/src/lib/logger.ts apps/api/src/routes/conversations.ts apps/api/tests/ai-orchestration.integration.test.ts apps/api/tests/ai-orchestration.test.ts apps/api/tests/ai-remote.test.ts apps/api/tests/ai-transport.test.ts apps/api/tests/interpretation.test.ts package.json scripts/benchmark-ai-orchestration.ts docs/phase21-design.md docs/phase21-review-report.md docs/phase21-evidence
# Review staged files and distinguish raw evidence-log whitespace from source findings.
git diff --cached --stat
git commit -m "Implement bounded Phase 21 provider orchestration"
# Confirm the following new tag name is unused before creating it.
git tag -a backend-v1-phase21-complete -m "Phase 21 provider orchestration verified; see review report"
```

No push or deployment is included.

# Phase 15 — BOQ and Cost Engine V2

Current review status (2026-09-30): IMPLEMENTATION COMPLETE; FINAL VERIFICATION COMPLETE; SIGNED OFF. The Supabase JWT failure was reproduced with its exact body and a controlled 16.2/16.3 comparison. The local PostgREST service now uses 16.3; application behavior and JWT settings are unchanged. Baseline is `ca0cbc2` / `backend-v1-phase14-complete`. The user has authorized commit/tag only after all fresh gates pass. Earlier verification and investigation observations below are historical and retained.

## 1. Implemented

`@designflow/boq-cost` computes deterministic material and labor BOQs from Phase 14 reports, with exact arithmetic, explicit regional rate books, content hashes, procurement quantities, ordered policy adjustments, coverage, stable provenance and immutable owner-private persistence. V1 estimates remain separate.

## 2. Cost architecture

```text
accepted immutable revision
  → immutable quantity takeoff
  → immutable construction calculation
  → explicit rate book + costing policy
  → immutable BOQ/cost artifact
```

The engine never remeasures geometry or repeats material recipes. Official creation reads the persisted source under the caller's identity, calculates and validates the report, then signs one atomic RPC write.

## 3. Rate-book model

A strict book includes ID/version, optional effective date, explicit country/region/city/code, currency, minor units, source provenance and stable entry codes. Entries match exact material, physical/purchase mode, unit, bag mass, and optional assembly/specification qualifiers. There is no matching precedence: multiple matches fail. Entries inherit the book currency and region. Snapshots are normalized and SHA-256 hashed; changing content without changing version changes the hash and input identity.

Official v1 selection is `sample-inr-v1` or `sample-inr-v2`. Both are **SYNTHETIC / NOT CURRENT MARKET DATA**. The pure API also accepts validated explicit user-supplied books. Historical artifacts embed their entire book and policy snapshots; no mutable rate table or live feed is consulted.

## 4. Money and precision

INR, USD and EUR are deliberately limited to two minor digits. Rates and productivity factors accept up to six decimals. Quantity display precision is 6–12 decimals, default 9. Physical monetary calculations consume exact Phase 14 rational quantities; discrete purchase prices use exact integer purchase counts. BigInt rational intermediates avoid binary floating point. Text rejects NUL and unpaired UTF-16 surrogates before PostgreSQL persistence. Each line rounds half-up once to minor units; category subtotals sum emitted rounded lines. Each adjustment rounds once, and the final total is the exact sum of those rounded amounts. Exact numerators/denominators are retained. `1.005 → 1.01` and `2.675 → 2.68` are tested.

## 5. Material pricing

Physical kg/m³/l rates use final exact quantities. Bag/piece/each rates use purchase counts. Cement bag mass must match; incompatible variants remain unpriced. No box/package conversion is guessed. Canonical lines retain physical and pricing quantities separately. Groups reference these same lines and summarize monetary amounts, so different grades, units and procurement variants are not merged into a false quantity total.

## 6. Labor model

Rules explicitly identify assembly, layer, trade and an existing upstream m²/m³/each basis. Direct unit rates and explicit hours-per-unit × hourly-rate productivity are supported. Only unit conversion of upstream mm²/mm³ is performed. The rule applies once per unique authoritative calculation item. Duplicate rules targeting the same assembly/layer fail. Missing rules emit NOT_EVALUATED labor lines. No assumed labor rate, productivity, side multiplier or coating count is introduced.

## 7. BOQ structure

MATERIAL and LABOR canonical lines carry stable SHA-256-derived IDs and machine line codes. ADJUSTMENT lines have stable policy codes and explicit ordering. Canonical lines retain source item/material/takeoff/entity IDs, assembly, layer, specification, level, quantity, exact evidence, procurement representation, currency, status and rate/rule identity. Category/material/level/assembly/specification/trade groups reference canonical IDs; they do not create duplicate priced lines.

## 8. Missing rates

Missing material rates yield `UNPRICED`, a stable reason and null rate/amount fields while preserving quantities. Incompatible purchase variants use `COST_RATE_VARIANT_MISMATCH`. Unsupported labor uses `NOT_EVALUATED`. Explicit zero rates are permitted only when supplied in the validated book or policy; missing rates never become zero-price lines.

## 9. Cost policy

The policy snapshot includes ID/version/currency, rounding and physical-quantity strategy, explicit labor rules and up to 32 adjustments. Adjustment categories are OVERHEAD, CONTINGENCY, CHARGE and ADJUSTMENT. Each has a unique code/order and MATERIAL, LABOR, DIRECT or RUNNING basis. Supported arithmetic is percentage addition, fixed addition and fixed deduction; deductions cannot make the running subtotal negative. RUNNING includes earlier rounded adjustments. No overhead, contingency, transport or tax is assumed. `TEST_CHARGE` is synthetic, not GST or another statutory rule.

## 10. Coverage

FULLY_PRICED means all represented material/labor lines are priced on evaluated upstream quantities. PARTIALLY_PRICED also includes successfully priced lines whose upstream basis remains partial or excluded. NOT_PRICED means no canonical material/labor line is priced. Partial upstream coverage cannot become unconditional full cost coverage. `pricedSubtotal`, `adjustmentsOnPricedSubtotal` and `pricedGrandTotal` stay distinct from nullable `completeRepresentedScopeTotal`; `completeTotalAvailable` is false for incomplete reports. Excluded scopes never become a complete project estimate.

## 11. Traceability

```text
BOQ material/labor line
  → Phase 14 material ID and/or calculation item ID
  → Phase 13 takeoff item ID
  → architectural entity IDs
```

A priced material line also preserves rate-book ID/version/hash and entry code. Labor retains the rule ID and full policy snapshot/hash. The artifact retains revision, QA, takeoff and construction calculation IDs plus a source report hash.

## 12. Persistence

`project_revision_cost_estimates` stores immutable derived artifacts with composite source-chain foreign keys. Book and policy snapshots, their hashes, options, region/currency, input fingerprint, report hash and JSON, coverage and database creation timestamp are preserved. Input identity binds the immutable source calculation ID/fingerprint/report hash and engine/book/policy/options; it does not include its own output report hash. Changed rates/policy/options create distinct artifacts. No upstream artifact or current revision pointer is modified.

## 13. API

All routes require owner authentication:

- `POST /api/projects/:projectId/revisions/:revisionId/takeoffs/:takeoffId/construction-calculations/:calculationId/cost-estimates`
- `GET /api/projects/:projectId/revisions/:revisionId/cost-estimates`
- `GET /api/projects/:projectId/revisions/:revisionId/cost-estimates/:costEstimateId`

POST accepts only `{ rateBookId, costingPolicy, options? }`. Unknown fields, supplied reports/quantities/totals/owner IDs and timestamps are rejected. Lists return bounded summaries with keyset pagination, never full BOQ or rate snapshots. Detail responses runtime-validate the stored report.

## 14. RLS and security

Real PostgreSQL RLS derives ownership through calculation → takeoff → revision → project. Authenticated owners may SELECT; public viewers and other users cannot read costs, including when the project is public. Direct INSERT/UPDATE/DELETE are denied. The RPC uses the existing `project_private.commit_key`; HMAC attestation binds caller, operation, input/report/hashes, retry context and expiry. The database independently checks ancestors, accepted QA, versions, snapshot/report/input hashes, currency/region association and subtotal reconciliation. Missing, forged, expired, altered and cross-user attestations fail.

## 15. Idempotency and concurrency

The existing durable receipt framework is extended with the cost route; no second framework is introduced. Same caller/key/input replays the original artifact after later versions exist. Changed input under the same key conflicts. Different users are isolated. Lock order is receipt-key advisory lock then cost-fingerprint advisory lock, and a unique fingerprint also protects keyless convergence. The artifact, database response projection and success receipt share one transaction. Injected failures at artifact insertion, receipt insertion and projection leave neither artifact nor receipt.

## 16. Migration

Only new migration `0009_boq_costs.sql` was added. Migrations 0001–0008 are untouched. It adds the cost table, source-chain unique constraint/FK, indexes, RLS/grants, immutable trigger, private hash/summary helpers, signed write/read RPCs and the receipt operation extension. Clean replay runs in the disposable PostgreSQL harness. The existing local stack was inspected at `http://127.0.0.1:54321`: 41 projects, 46 revisions, 51 takeoffs and 18 calculations existed. Migration 0009 was applied additively; no reset was performed.

## 17. Important files

- `packages/boq-cost/src/{contracts,calculate,report,hash,demo,index}.ts` and README.
- `apps/api/src/{contracts/costs,services/cost-service,lib/cost-repository,routes/costs}.ts`.
- `supabase/migrations/0009_boq_costs.sql`.
- `packages/boq-cost/tests`, `test-support/cost-acceptance.ts`, `apps/api/tests/costs.integration.test.ts`.
- `docs/phase15-design.md`, `docs/phase15-example.json`, `docs/phase15-verification.json`.
- Independent investigation report/evidence and `scripts/investigate-supabase-500.ts`.

## 18. Previous baseline files modified

Existing production source changes are limited to:

| File | Required additive change |
| --- | --- |
| `apps/api/src/app.ts` | Register cost routes. |
| `apps/api/src/lib/repository.ts` | Add optional cost RPC transport contract. |
| `apps/api/src/lib/supabase.ts` | Route cost RPC results through cost error mapping. |

Build/infrastructure changes: root and API package manifests/lockfile, root TypeScript/Vitest configuration, Dockerfile and CI workflow include the new workspace and cost gate. Existing tests/support changed: `test-support/pg-backend.ts` adds the cost RPC adapter; `apps/api/tests/supabase.live.test.ts` adds owner-authenticated cost acceptance and direct SDK protection tests; `supabase/tests/database.test.ts` and `rls.sql` include the new table and privilege assertions. No V1 estimate implementation, blueprint/QA/geometry, takeoff formula or Phase 14 recipe changed. The independent investigation changed no existing production behavior.

## 19. Tests

Pure suite: 26 tests cover physical/procurement units, bag variants, missing and ambiguous rates, direct/productivity labor, duplicate labor protection, exact rational pricing, half-up boundaries, line/subtotal reconciliation, overhead/contingency/charge/deduction order, content hashes, source traceability, coverage, determinism, frozen inputs, parallel calls, JSON roundtrip, bounds, PostgreSQL-safe Unicode and sample labels.

Cost PostgreSQL suite: 13 tests, including five portable acceptance cases for exact persistence and unchanged ancestors, keyed/keyless concurrency and conflict/replay, historical rate/policy/options separation, bounded pagination, public/non-owner isolation, cross-user keys and client input rejection. Additional tests cover signed/forged/expired writes, direct RLS, immutability, independently checked source/hash/totals, composite FK/snapshot constraints under privileged insertion, content changes without version changes, three rollback points, unavailable signing and body limits.

Live Supabase adds the same five acceptance cases and one direct SDK/PostgREST security case, using real anonymous Auth/JWT/RLS. SQL pgTAP adds five cost privilege assertions, bringing the database file to 39 assertions. No skipped tests are accepted as gate success.

## 20. Verification

Exact command results are preserved in `phase15-verification.json`. Final Supabase acceptance failed the existing prior-phase concurrent durable-operation case; **35/36 tests passed, including all Phase 15 cases**. The second consecutive final Supabase run was not attempted as a blind retry. Therefore the full Phase 15 completion gate is currently **not satisfied**.

| Command / run | Result | Test result |
| --- | --- | --- |
| `npm run build` (build) | PASS |  |
| `npm run typecheck` (typecheck) | PASS |  |
| `npm run lint` (lint) | PASS |  |
| `npm run test:unit` (unit) | PASS | Tests  1436 passed (1436) |
| `npm run test:generator` (generator) | PASS | Tests  461 passed (461) |
| `npm run test:blueprint` (blueprint) | PASS | Tests  137 passed (137) |
| `npm run test:blueprint-qa` (blueprint-qa) | PASS | Tests  177 passed (177) |
| `npm run test:projects` (projects) | PASS | Tests  23 passed (23) |
| `npm run test:takeoff` (takeoff) | PASS | Tests  23 passed (23) |
| `npm run test:construction` (construction) | PASS | Tests  34 passed (34) |
| `npm run test:cost` (cost) | PASS | Tests  39 passed (39) |
| `npm run test:integration` (integration-1) | PASS | Tests  106 passed (106) |
| `npm run test:integration` (integration-2) | PASS | Tests  106 passed (106) |
| `npm run test:integration` (integration-3) | PASS | Tests  106 passed (106) |
| `npm run test:supabase` (supabase-1) | FAIL — existing durable-operation HTTP 500 | Tests  1 failed / 35 passed (36) |
| `npm run check` (check) | PASS | Tests  1544 passed (1544) |
| `docker build -t designflow-api:phase15 .` (docker) | PASS |  |
| `node scripts/smoke-container.mjs designflow-api:phase15` (smoke) | PASS |  |
| `git diff --check` (diff-check) | PASS |  |
| `npm run db:test` (db-rls) | PASS | Files=1, Tests=39 |

All three final integration runs passed consecutively. The final aggregate check includes build, typecheck, lint and all non-live tests. Clean migration replay is exercised by the disposable PostgreSQL suites; the final local SQL/RLS file passed 39 assertions. Docker build and container smoke passed. There are no deliberately skipped tests. Earlier test-development failures were corrected (fixture coverage, test RPC wiring and the schema inventory's new FK count); the final schema inventory now asserts the exact new composite FK. A previous interrupted Docker installation ended in ECONNRESET; registry reachability was checked before the successful final build.

## 21. Manually checkable synthetic examples

These are independent test fixtures, **not market estimates**:

- Material: 100 kg × 10/kg = 1,000.00.
- Procurement: 1,243 physical kg → 25 explicit 50 kg purchase bags × 400/bag = 10,000.00.
- Piece procurement: 117 tile pieces × 7/piece = 819.00.
- Productivity labor: 10 m² × 0.5 hours/m² × 200/hour = 1,000.00.
- Direct labor fixture: 10 m² × 50/m² = 500.00.
- Adjustment fixture: materials 1,000.00 + direct labor 500.00 = 1,500.00; 10% overhead = 150.00; 5% contingency on 1,650.00 = 82.50; 10% synthetic TEST_CHARGE on 1,732.50 = 173.25; fixed deduction 5.00 → priced total **1,900.75**.

## 22. Persisted residential example

**SYNTHETIC / DEMONSTRATION RATES — NOT A REAL MARKET ESTIMATE.**

`phase15-example.json` was produced through real local Supabase anonymous Auth, JWT, accepted generated residential revision, takeoff, construction calculation, cost write and identical detail retrieval. It contains both persisted source calculation and cost artifact, including ancestor IDs and hashes. Only its temporary authentication identity was removed; immutable history remains.

The report has 26 canonical lines, material subtotal **163,600.00 INR**, labor subtotal **21,164.00 INR**, direct priced subtotal **184,764.00 INR**, 10% overhead **18,476.40 INR**, and 5% contingency on the running subtotal **10,162.02 INR**. Priced grand total is **213,402.42 INR**. All represented lines have rates, but coverage remains **PARTIALLY_PRICED** because upstream coverage is partial/excluded. `completeTotalAvailable` is false. Selected material line: 18.9 m³ ready-mix concrete × 5,000/m³ = 94,500.00 INR. Selected procurement line: 110.33 physical tile pieces → 111 purchase pieces × 100/piece = 11,100.00 INR. One explicit tile labor basis is 16.575 m² × 0.5 hours/m² × 200/hour = 1,657.50 INR.

## 23. Historical Supabase 500 investigation (before September 30 sign-off)

The dedicated agent narrowed the three retained historical incidents to HTTP **401 during `/rest/v1/idempotency_records` lookup**, mapped by the existing adapter to API 500. In Phase 14, three companion lookups and all three following commit RPCs succeeded; the failed request did not reach a write RPC. Historical bodies/request IDs/SQLSTATE were not retained and are not invented.

852 diagnostic API requests passed, including nine independent 40-second idle/fresh-token trials. Request IDs/order, JWT timing claims, pool lifetimes and advisory-lock samples are preserved where available in `supabase-500-investigation-evidence.json`; earlier trace loss is explicitly identified. No root cause was reproduced locally. The PostgREST 16.2 cached JWT clock defect, fixed upstream in 16.3, remains a **hypothesis**, not a Phase 15 fix or completion claim. Production behavior, infrastructure version and tests remain unchanged; no retries or artificial regression test were added. See `supabase-500-investigation.md` for exact evidence and discriminating next steps. The intermittent failure remains technical debt.

## 24. Known limitations

Official creation exposes two source-controlled synthetic INR books only. The pure contract supports INR/USD/EUR with two minor digits; arbitrary currencies, FX and rate ingestion are unsupported. Labor rules target explicit assembly/layer bases and cannot execute formulas. Generic/unmatched procurement conversions are not supported. Groups summarize amounts and reference canonical lines rather than aggregating incompatible quantities. Existing upstream partial/excluded work remains partial; neither successful rate matching nor a sample subtotal certifies project completeness. The independent historical authentication failure is unresolved.

## 25. Deferred

Architectural AI, Solver V2, professional 2D output, 3D scene generation, frontend, professional PDF/Excel exports, live market-rate ingestion, structural engineering, reinforcement, foundations, MEP, jurisdiction-specific verified rules and production deployment are deferred. Work stops after Phase 15. Manual review precedes any commit or `backend-v1-phase15-complete` tag.


## 26. September 30 final source and invariant review

All initial changes were attributable to Phase 15 implementation or its existing diagnostic investigation. No unrelated user changes were found. Prior production file changes are only the cost route import/registration, repository RPC capability and Supabase cost RPC/error wiring. V1 estimates, Building Model V2, blueprint solver/QA, Phase 12 revision semantics, Phase 13 formulas and Phase 14 formulas are unchanged. Migrations 0001–0008 have no diff; 0009 is the sole Phase 15 migration. Read-only inspection confirmed local endpoint `http://127.0.0.1:54321`, migration 0009 present, and existing history (93 projects, 101 revisions, 109 takeoffs, 58 calculations, 31 costs) before fresh gates. No reset was used.

| Invariant | Source review / executable coverage |
| --- | --- |
| B1: persisted calculation boundary | Strict cost request schema rejects reports, quantities, totals and owner fields; service reads persisted construction report as the caller. Engine imports construction contracts/rationals and performs no geometry or recipe calculation. API tests verify forged-input rejection and unchanged ancestors. |
| B2: explicit exact rate books | ID/version/region/currency/provenance and stable unique entry codes are required. Normalized content is SHA-256 hashed. Multiple matching entries fail; synthetic books are labeled. No scraping/network lookup exists in the engine. |
| B3: exact money | BigInt rationals throughout monetary multiplication/accumulation; half-up minor-unit rounding occurs once per line/adjustment; emitted rounded values reconcile in TypeScript and PostgreSQL numeric arithmetic. Tests cover 1.005 → 1.01 and 2.675 → 2.68. |
| B4: procurement | Physical and pricing quantities are distinct. kg/m³/l use exact physical quantity; bags/pieces/each use upstream purchase counts. Bag mass must match; incompatible variants remain unpriced. |
| B5: missing rates | UNPRICED lines retain null amount/rate fields and prevent complete coverage. Explicit supplied zero rates remain distinct from missing rates. |
| B6: labor | Explicit assembly/layer/rate or productivity/hourly rate, upstream basis and provenance. Duplicate layer rules and duplicate source identities fail. Each authoritative item is processed once. |
| B7: partial status | Completeness requires evaluated source summary, all coverage entries, all line upstream statuses and prices. Tests explicitly price partial quantities without promoting them to full coverage. |
| B8: immutable history | Fingerprints bind source and book/policy content hashes plus options; changed rates/policy yield new artifacts even without version bumps. Existing artifacts are immutable and historical keyed replay remains stable. |

Persistence review confirmed owner-only RLS, no direct client writes, HMAC envelopes bound to caller/operation/input/context/expiry, composite ancestor foreign keys, independent content hashes and exact total reconciliation. Concurrency locks receipt key before artifact fingerprint; artifact, projected response and receipt commit atomically. Integration tests cover keyed/keyless convergence, cross-user isolation, signature failures, ancestor/hash forgery, immutable rows and rollback at artifact/receipt/projection failures. Prior assertions were extended for the additive table/foreign key and not weakened.

## 27. Final sign-off infrastructure correction

The September 30 diagnostic captured three HTTP 401 `PGRST303: JWT issued at future` receipt lookups mapped to API 500. A disposable 16.2 replica reproduced the same rejection; the identical 16.3 experiment passed. The upstream validator-time fix is documented with exact traces and primary sources in `supabase-500-investigation.md`. Local PostgREST was changed from 16.2 to 16.3, with setup/CI wiring in `scripts/ensure-local-postgrest.mjs`; no application production behavior, JWT checks, test assertions or database history changed. The fixed-version probe now has a regression failure assertion. Post-fix diagnostics passed 240/240 and the clock regression passed 4/4. Earlier incidents' missing bodies remain an evidence limitation, not an invented conclusion.

All required fresh gates and both consecutive full Supabase acceptance runs passed. See section 28.


## 28. Final verification and release decision — SIGNED OFF

| Gate | Result | Files / tests |
| --- | --- | --- |
| build | PASS | — / — |
| typecheck | PASS | — / — |
| lint | PASS | — / — |
| unit | PASS | 26 / 1436 |
| generator | PASS | 8 / 461 |
| blueprint | PASS | 1 / 137 |
| blueprint-qa | PASS | 6 / 177 |
| projects | PASS | 1 / 23 |
| takeoff | PASS | 2 / 23 |
| construction | PASS | 2 / 34 |
| cost | PASS | 2 / 39 |
| integration-1 | PASS | 8 / 106 |
| integration-2 | PASS | 8 / 106 |
| integration-3 | PASS | 8 / 106 |
| db-rls | PASS | 1 / 39 |
| check | PASS | 35 / 1544 |
| docker | PASS | — / — |
| smoke | PASS | — / — |
| diff-check | PASS | — / — |
| supabase-1 | PASS | 1 / 36 |
| supabase-2 | PASS | 1 / 36 |

All gate tests passed with zero skipped tests. Each live Supabase run passed all 36 tests in one file, consecutively, without any intervening failed acceptance run or application retry workaround. Exact UTC start times, suite durations, total command durations and retained output are in `phase15-verification.json` and `phase15-signoff-evidence/verification-output.txt`. Integration passed 106 tests three consecutive times. Phases 5–14 remain green. RLS, signed writes, idempotency and immutable cost history passed the real PostgreSQL and live Supabase checks.

**IMPLEMENTATION COMPLETE:** existing Phase 15 BOQ + Cost Engine V2 reviewed; no rewrite or product features added during sign-off.

**FINAL VERIFICATION COMPLETE:** all required fresh gates passed; completion commit/tag authorized by the user. Release checkpoint tag: `backend-v1-phase15-complete`.

**HISTORICAL SUPABASE ISSUE STATUS:** reproduced on September 30; root cause established for this reproduction; local PostgREST 16.2 cached validator-time defect corrected with 16.3. No application production behavior or JWT configuration changed. Exact earlier incident bodies remain unavailable, so those earlier incidents are not individually root-caused retroactively. Historical evidence is preserved.

No database reset, secret inclusion, acceptance-test weakening, failure suppression or speculative production change. Startup readiness polls and the explicit replica-pause experiment are not failed-application-operation retries. No Phase 16 work was performed.

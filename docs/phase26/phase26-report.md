# Phase 26 report — bounded MEP, life-safety and vertical transport

## Classification

**PHASE 26 FULLY IMPLEMENTED AND VERIFIED WITHIN BOUNDED SCOPE**

Basis: final frozen-source release run 3 — 52 / 52 gates exit 0, no waived failure, no required
skip; frozen source (manifest `7f93ddf3…af7c4a156`) and every protected historical directory
unchanged before and after every gate. Full record: [phase26-verification.md](phase26-verification.md).

This is a classification of the bounded implementation only. Every compliance/certification
claim remains `NOT_CLAIMED` (MEP design completeness, electrical safety, plumbing compliance,
HVAC sizing, fire code, life-safety certification, accessibility, elevator certification,
building code, professional certification).

## What was delivered

- `apps/api/src/systems/`: contracts, model, exact rational units, orthogonal Hanan-grid
  Dijkstra routing (`orthogonal-hanan-dijkstra-v1`, `routing-weights-v1`), gravity drainage
  with exact scaled elevations, L1 geodesic egress with node-disjoint max-flow, elevator
  proposals (no architecture mutation), envelope-box clash detection, analysis, and an
  independent validator that imports none of the calculator modules.
- Wiring: `systems-repository.ts`, `systems-service.ts`, `routes/systems.ts`; signed
  security-definer RPCs, idempotency receipts, revision binding and staleness.
- Migration `0016_building_systems_analyses.sql` only; 0001–0015 untouched.
- Phase 25 handoff consumed as `ENVELOPE_TRANSMISSION_COMPONENT`, `isDesignLoad: false`.
- Tests: `systems.test.ts`, `systems.integration.test.ts` (47 total), Supabase live
  acceptance, pgTAP/RLS plan 72, compiled container acceptance.
- Tooling: `benchmark-systems.ts`, `mutation-test.py` (19 mutants),
  `verify-phase26.py`, `compiled-acceptance.mjs`, `snapshot-local-db.py`.

## Key measured evidence

- Tests: unit 2128, integration 227, systems 47, live Supabase 99, `npm run check`
  2397 + 133 + 52 — all passed.
- Mutation: 19 / 19 killed, all files restored. Uphill-drainage and fully-planted
  clash-recomputation mutants both killed by dedicated forgery tests.
- Compiled acceptance (`--network none`): 1750 W connected, 1400 W demand, 2 m/s duct velocity,
  drain arrival −642.5 mm, lift PROPOSED, 0 clashes, 12 penetrations.
- Benchmark: worst calc 174 ms, worst validate 9 ms, largest snapshot 104 KB across 8 cases.
- Database: only 0016 added, RLS everywhere, pre-existing policies unchanged.
- Docker: non-root, liveness 200, failed-dependency readiness 503, SIGTERM exit 0.

## Issues found during verification

1. Run 1 (50/52): IFC interpreter venv missing in `/tmp` — environment only; recreated.
2. Run 2 (51/52): live-Supabase teardown truncated by PostgREST `max_rows = 1000`
   (pre-existing cleanup logic). Fixed by scoping protected reads to the run's own projects in
   `apps/api/tests/supabase.live.test.ts`; source re-frozen and full run repeated.

## Limitations (bounded scope, by design)

- Routing is orthogonal, sequential per network and greedy across networks; it is not a global
  optimum. Infeasible routes are reported as `SYSTEM_ROUTE_INVALID` (e.g. maximum-24-room
  SANITARY, outlet above arriving drainage).
- Only explicitly declared loads, fixtures, factors and connections are used; nothing inferred.
- Clashes use envelope boxes; penetrations are always `REVIEW_REQUIRED`.
- Elevators are proposals only.
- No Phase 27 work.

## Changed files (uncommitted)

Modified: `apps/api/src/app.ts`, `apps/api/src/lib/{http-protection,repository,sentry,supabase}.ts`,
`apps/api/tests/supabase.live.test.ts`, `package.json`, `supabase/tests/database.test.ts`,
`supabase/tests/rls.sql`, `test-support/pg-backend.ts`.

New: `apps/api/src/systems/`, `apps/api/src/lib/systems-repository.ts`,
`apps/api/src/routes/systems.ts`, `apps/api/src/services/systems-service.ts`,
`apps/api/tests/systems{,.integration}.test.ts`, `scripts/benchmark-systems.ts`,
`supabase/migrations/0016_building_systems_analyses.sql`,
`test-support/systems-{acceptance,fixtures}.ts`, `docs/phase26/`.

Byproduct: four `docs/phase16-evidence/supabase-2026-10-07T14-*.json` files written by the
live-Supabase suite during the manual diagnosis reruns; left for human review.

## Recommendation

Ready for manual review. Not committed, tagged, pushed or deployed.

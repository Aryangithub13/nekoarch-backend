# Phase 36 — Conversational AI: implementation report

**Branch:** `phase36/conversational-ai` · **Base:** `3717a80` (Phase 35 head, PR #7; unmodified) · **Date:** 2026-10-12
**Not done, by instruction:** no merge, tag, deploy, pull request, or hosted-database migration. Phase 35 history and release decisions are untouched.

## 1. Discrepancies found before implementation

1. **Phase 36 means two things.** The owner's brief defines Phase 36 as Conversational AI. The repository's own record (`docs/phase36/phase36-handoff.md` on `phase31/development`, quoted from the 46-phase roadmap) defines it as the Cloud Engineering Compute Gateway. Phase 20 is already "Conversational architectural intelligence". The owner's brief was followed. Nothing about the compute-gateway handoff was changed. The numbering needs an owner decision (design §1).
2. **Missing documents.** Neither the authoritative roadmap nor an updated roadmap, nor a Phase 36 Conversational AI specification, is in the repository.
3. **Missing research.** The Phase 35 V2 research set (`NekoArch_Phase35_Engineering_Research_Enhanced_v2_2026-10…`) is not in any branch, tag, commit, the container filesystem, `/mnt/attach` or `/mnt/user-data`. It was not used, and no substitute was used.
4. **Dependency labels differ from the repository's record.** "Phase 33 manifest/synchronization/freshness" and "Phase 38 provider routing" do not match it: B33 is account/library/brief/context, and provider routing is not implemented (the repo infers B39/B43). See the design's dependency matrix (§2).
5. **Repository layout.** `main` holds only audit documents and has unrelated history. The default branch is `phase31/development`. The Phase 35 code is on the unmerged `phase35-1/release-remediation`. This work is therefore on its own branch from `3717a80`.
6. **Local test environment.** Embedded PostgreSQL cannot run as root, and needs the `en_US.UTF-8` locale (which CI generates). All test runs below are non-root with that locale.

## 2. Requirements → implementation

| Req | Implementation | Evidence (tests) |
|---|---|---|
| R1 project-aware conversation | `conversation/context.ts`: owner-scoped reads; facts with basis (`PROJECT_RECORD`/`DERIVED`/`USER_STATED`/`MISSING`); bounded document | integration "answers project and engineering questions…", "isolates…" |
| R2 decision memory | `conversation/memory.ts`, `state.memory`; kinds and sources kept distinct | "remembers constraints, offers suggestions…" (suggestions never decisions; accepted only after commit) |
| R3 change intents | `ChangeIntentSchema`; `conversation/interpret.ts` + Phase 20/30 grammars; clarification on ambiguity | unit classification table; "asks focused questions…" |
| R4 controlled operations | `conversation/actions.ts`: Phase 30 preflight/execute/approve, Phase 35 regenerate/save/verify, Phase 20 approval route | appearance, restore and zone-regeneration scenarios |
| R5 preservation and revision safety | Scope conflicts from entity-level diffs; Phase 30 locks; recomputed-candidate hash check; post-commit verification; SQL `advance`/`rebase` fencing | "coordinates a Phase 35 zone regeneration…", "refuses stale revisions…", "fences advance and rebase in SQL…" |
| R6 capability-aware orchestration | Phase 21 orchestrator only for `ARCHITECTURAL_INTENT_EXTRACTION`; other AI capabilities stay `PLANNED` | "returns stable statuses on provider failure and never lets malformed model output through…" |
| R7 contracts and persistence | Additive optional state fields; migration `0025`; OpenAPI and route catalog regenerated | upgrade test `0024`→`0025`; `modernization.test.ts` |
| R8 engineering evidence | Phase 35 assessment passed through unchanged; fixed disclosures; never `professionally_reviewed` | "answers … engineering questions…" (matches the Phase 35 route) |
| R9 history, alternatives, conflicts | Suggestions and option selection; revision and candidate comparison; conflicts with constraints and accepted decisions; explicit supersede/release | constraint, comparison and supersede assertions |
| R10 observability and recovery | Structured logs without text or secrets; action-keyed receipts; reconciliation of lost conversation updates | "keeps history and context bounded and logs…", "never loses or duplicates a commit…" (fault injection) |

Acceptance criteria 1–19 map to the integration and unit tests above. AC 20 (full suite, build, typecheck, lint) is covered in §4. AC 18: migration replay (`supabase/tests/database.test.ts`, which now includes `0025`) and the populated-upgrade test pass on embedded PostgreSQL. The Supabase Docker acceptance is reported in §5.

## 3. Changes

- **New:** `apps/api/src/contracts/conversation-memory.ts`, `contracts/conversation-turns.ts`, `conversation/{interpret,memory,context,turns,actions}.ts`, `supabase/migrations/0025_conversation_turns.sql`, `apps/api/tests/conversation-turns{,.integration}.test.ts`, `docs/phase36-conversational-ai/*`.
- **Changed (additive):**
  - `contracts/conversations.ts`: optional `memory`, `turns` and `actions`; the `turnsOnly` opt-in.
  - `routes/conversations.ts`: four routes, and two guards that apply only to conversations using Phase 36 constraints.
  - `ai/conversation-planner.ts`: the safety check and `boundedState` are exported; old turns are trimmed before old messages.
  - `lib/idempotency.ts`: `internalCommand`.
  - `lib/conversation-repository.ts`: `advance` and `rebase` actions.
  - `lib/http-protection.ts`: the new POSTs join the `generate` rate group.
  - `lib/sentry.ts`: route allowlist.
  - `app.ts`: the appearance pool is passed to the conversation routes.
  - `test-support/openapi.ts`; `docs/modernization/{api-routes,openapi}.json` (regenerated with `UPDATE_ROUTE_CATALOG=1`).
- **Migration:** `0025` only replaces `conversation_write`. It changes no table, column, constraint, policy or stored row, and earlier migrations are byte-identical. **It is not applied to any hosted database.** The hosted database is believed to be at `0017` (B31–B33 reports) and needs `0018`–`0024` first.
- **OpenAPI:** four new paths; `POST /conversations` gains the optional `turnsOnly`; `Conversation` gains optional fields. Two Phase 30 operations show changed `$ref` targets only; their semantics are identical (verified by inlining).

## 4. Verification (local, non-root, `LANG=en_US.UTF-8`, Node 22.22.0)

| Run | Build | Typecheck | Lint | Vitest |
|---|---|---|---|---|
| Baseline at `3717a80` (clean worktree) | pass | pass | pass | 93 files, 2 838 tests passed |
| Phase 36 final | pass | pass | pass | **95 files, 2 882 tests passed** (+2 files, +44 tests) |

Raw output: `evidence/baseline-3717a80-*.txt`, `evidence/final-*.txt`. CI matrix Node 22.23.2, `npm audit` and the container smoke test were not run locally (no dependency or Dockerfile change).

Defects found and fixed during testing:
- "render a photorealistic image" was read as the *warm render* finish.
- The candidate's regenerated storeys listed the unchanged template storey.
- A refused memory addition left memory over its bound.
- "Keep …" clauses beside a restore request were dropped, because the Phase 30 grammar stops at restore wording.
- The new routes were missing from the telemetry allowlist.

## 5. Local Supabase acceptance — not completed (environment blocker)

`npx supabase start` (CLI 2.117.0, Docker 29.8.2 started locally) failed. Every image pull from Docker Hub returned `429 Too Many Requests` (31 refusals), so no container ran, and `scripts/test-local-supabase.mjs` could not be executed. **The Supabase-stack receipt for `0025` is outstanding.** It should be run where images can be pulled (`npm run db:start && npx supabase db reset --local && npm run test:supabase`, or the `supabase-acceptance` workflow_dispatch job). The embedded-PostgreSQL replay and upgrade tests in §4 cover the same SQL, without Supabase's auth and PostgREST layers.

## 6. Known limitations

See design §5. In short: there are no generative free-text answers, because the Phase 21 explanation capabilities are `PLANNED`. Option lists cover exterior finishes only. There is no operation for storey heights, stairs, structure, interior finishes or media. Requirement regeneration covers only up to two floors and rebuilds the whole design. Zone regeneration needs structured input. Rebase is explicit.

## 7. Security and compatibility

- Every route is session-only and owner-scoped through the existing RLS reads and HMAC-signed RPCs. Anonymous requests get 401; other owners and projects get 404 (tested).
- Model output cannot create actions, constraints, decisions or revisions. It must pass `ConversationIntentSchema`, and deterministic understanding takes precedence.
- Embedded instructions and credentials are refused (422) before anything is reserved.
- No new dependency, provider, credential or paid service.
- Phase 20 and 21 contracts are unchanged for conversations that do not use turns. Their documents stay byte-identical (tested on upgrade).

## 8. Remaining blockers and recommended next action

- **Owner decision:** Phase 36 numbering (Conversational AI vs. Compute Gateway). Then commit the roadmap to `docs/roadmap/`.
- **Owner decision:** whether this branch is reviewed on top of PR #7 (its base) or rebased after Phase 35 merges.
- **Owner:** supply the V2 research set, or confirm it does not exist.
- **Next:** an independent review of this branch, then CI on both Node versions once a pull request is authorized. Hosted migration `0025` must wait for the hosted state of `0018`–`0024` to be confirmed.

# Phase 36 — Conversational AI: design

**Branch:** `phase36/conversational-ai`, based on the Phase 35 head `3717a80` (PR #7, draft, unreviewed). Phase 35 history is not modified.
**Status:** implemented and tested locally; not merged, tagged, deployed or applied to any hosted database.

## 1. Scope source, and a numbering conflict the owner must resolve

| Source | What it says Phase 36 is |
|---|---|
| Owner brief, 2026-10-12 ("Backend Phase 36: Conversational AI") | Project-aware, multi-turn conversational architectural intelligence (R1–R10) — **implemented here** |
| `docs/phase36/phase36-handoff.md` (on `phase31/development`, written from the 46-phase roadmap on the owner's machine) | Cloud Engineering Compute Gateway |
| `docs/phase35-1/phase-1-46-reconciliation.md` §2 | Phase 20 = "Conversational architectural intelligence" (released); Phase 21 = provider orchestration; Phase 38 = exports (inferred); provider routing B39/B43 (inferred) |

Neither the 46-phase roadmap nor an updated roadmap, nor a written Phase 36 Conversational AI specification, is committed anywhere in the repository (all branches, tags and history searched). The owner's brief is treated as the scope of record for this branch. The compute-gateway handoff is **not** modified or superseded here, and these documents live in `docs/phase36-conversational-ai/` so that the two "Phase 36" records stay distinguishable. **The owner should decide the numbering** (for example, renumber one of them) before either is merged or tagged.

Because conversational intelligence already exists from Phase 20/21, Phase 36 extends it instead of duplicating it: same table, same signed RPCs, same lease and idempotency semantics, same provider orchestrator.

## 2. Dependency matrix (verified in source, not taken from the roadmap)

| Dependency | State found | Used how |
|---|---|---|
| Phases 20–21: conversations, planner, provider orchestration | Released (tags `backend-v1-phase20/21-complete`); in this tree | Reused: table `architectural_conversations`, `conversation_read/write`, `planConversation`, the Phase 21 orchestrator. Only `ARCHITECTURAL_INTENT_EXTRACTION` is `AVAILABLE`; `EXPLANATION`, `LANGUAGE_INTERPRETATION`, `REQUIREMENT_COMPARISON`, `ENGINEERING_ASSISTANCE` are `PLANNED` and stay planned. |
| Phase 30: selective revision (appearance, restore, preservation locks) | Released | Reused for exterior-finish and restore actions: read-only `planPreflight` at turn time; `createPreflight` → `executeOperation` → `approveOperation` on confirmation. Phase 30 locks enforce the conversation's constraints. |
| Phase 33: account, library, brief and context | Merged, untagged. The brief's "manifest, synchronization, artifact freshness" wording does not match the repo's B33 (account/library/brief/context); the repo's B33 contracts are what exists | Reused: `projectContext` (context bundle, `contextHash`, brief) as a fact source. |
| Phase 35 / 35.1: assessment, evidence classes, zones, regeneration, verification | Implemented on PR #7 (draft, review pending) | Reused: `assessRevision` for engineering answers (evidence classes passed through unchanged); `regenerateRevisionZone` + supplied save + `verifyRevisionRegeneration` for zone actions; `preservationCheck` for comparisons. |
| Phase 38 provider routing | **Not implemented.** The repo infers Phase 38 = exports and provider routing = B39/B43 | Not used. No new routing capability was invented; provider use stays behind the Phase 21 abstraction. |
| Phase 35 V2 research (`NekoArch_Phase35_Engineering_Research_Enhanced_v2_2026-10…`) | **Not found** (all refs and history, container filesystem, `/mnt/attach`, `/mnt/user-data`) | Not used. Engineering replies disclose its absence; no research value, threshold, formula or edition is used. |

## 3. Architecture

```
POST …/turns ──► reserve (Phase 20 lease + messageId idempotency, SQL)
                 └► runTurn (read-only)
                      loadContext ── project, base revision, history(5), Phase 33 bundle, Phase 30 appearance layer
                      classifyTurn ─ deterministic grammar (+ Phase 30 revision grammar for appearance/preservation)
                      ├ questions / options / decisions / comparison / engineering ─► facts with a basis
                      ├ constraints ─► decision memory
                      └ change requests ─► conflicts? ─► CONFLICT
                                         └► Phase 20 planner │ Phase 30 preflight │ Phase 35 regeneration (read-only)
                                            └► pending ACTION (actionHash)
                 finish (SQL, version- and lease-fenced)

POST …/actions/:id/decisions ─► binding checks ─► reserve ─► existing service under an action-keyed receipt
                                ─► finish | advance (SQL: new base must be a child of the old one)
POST …/rebase ─► reconcile actions from project records ─► rebase (SQL)
GET  …/context ─► bounded context document (≤ 12 000 bytes, contextHash)
```

**Core rule:** language is interpreted deterministically or, for requirement wording only, through the Phase 21 `ARCHITECTURAL_INTENT_EXTRACTION` capability whose output must pass `ConversationIntentSchema` (and deterministic understanding takes precedence). Nothing a model returns can create an action, a constraint, a decision or a revision. Every persisted change is made by an existing service after an explicit confirmation.

### 3.1 Decision memory (R2)

Stored in `state.memory` (≤ 48 entries). Each entry has a kind, a source and a status:

| Kind | Source | Meaning | Becomes a decision? |
|---|---|---|---|
| `PRESERVATION` | `USER_EXPLICIT` | "Keep X" (Phase 30 scope vocabulary, optional storey) | Enforced against every later operation until released explicitly (`references.release`) |
| `REQUIREMENT` | `USER_EXPLICIT` | A requirement the user stated (Phase 20 intent field) | Only when a proposal built from it is approved |
| `PROPOSAL` | `USER_EXPLICIT` | A prepared, unconfirmed change | Settles to `ACCEPTED` on commit, `SUPERSEDED`/`REJECTED` otherwise |
| `SUGGESTION` | `SYSTEM_SUGGESTION` | An option the backend listed (the four Phase 30 finish presets) | Never; selecting one creates a proposal; the selected suggestion is marked `ACCEPTED` only after its commit |
| `ACCEPTED_DECISION` | `USER_CONFIRMED` | Recorded only after a confirmed operation persisted a revision; carries `resultRevisionId` and the scopes it changed | Is one; a later change to the same scopes is a conflict until superseded explicitly (`references.supersede`) |

Derived facts are not stored: they are recomputed from records on every turn, each with a basis (`PROJECT_RECORD`, `DERIVED`, `USER_STATED`, `MEMORY`, `SUGGESTION`, `MISSING`). Missing information is reported as `MISSING`, never filled in.

### 3.2 Change intents and affected scopes (R3, R5, R9)

A `ChangeIntent` names the project, base revision, operation, capability (status and existing route), affected scopes, desired change, protected constraints, required inputs, ambiguities, validations, expected output and verification. Affected scopes use the Phase 30 preservation vocabulary:

| Operation | Affects |
|---|---|
| `EXTERIOR_APPEARANCE` | `EXTERIOR_APPEARANCE` (target storeys or building-wide) |
| `RESTORE` | Exactly the scopes that differ between base and source models (entity-level diff by canonical hash), plus `EXTERIOR_APPEARANCE` if the appearance layers differ |
| `ZONE_REGENERATION` | Exactly the scopes that differ between base and candidate, per storey; plus building-wide `EXTERIOR_APPEARANCE` when the base has an appearance layer (a supplied revision carries none) |
| `REQUIREMENTS_CHANGE` | Every scope, building-wide (the generator regenerates the whole design, so nothing can be guaranteed) |

A `LEVEL` constraint conflicts with any change that touches that storey or is building-wide. Conflicts are reported, never resolved by the backend.

### 3.3 Actions (R4, R5)

| Kind | On turn (read-only) | `CONFIRM` | `APPROVE_CANDIDATE` |
|---|---|---|---|
| `EXTERIOR_APPEARANCE`, `RESTORE` | Phase 30 `planPreflight` with the structured operation and the conversation's constraints as `preserve` | `createPreflight` (must reproduce the shown `preflightHash`) and `executeOperation` → `CANDIDATE_READY` | `approveOperation` (QA, geometry lock) → `COMMITTED` |
| `ZONE_REGENERATION` (structured request required) | Phase 35 regeneration candidate | Recompute (must reproduce `expectedModelHash`), supplied save, Phase 35 verification → `COMMITTED` with `VERIFIED` (or the actual non-verified status) | — |
| `REQUIREMENTS_CHANGE` | Phase 20 proposal | Not here: the action's `confirmation` names the existing `/proposals/approve` route | — |

Before any underlying write: the `actionHash` must match, the resent structured request must hash to the prepared one, and the action is re-checked against current constraints. Each underlying write runs under an idempotency receipt keyed by action and step, so a retried confirmation replays rather than repeats it. A deterministic refusal is recorded as `FAILED`; a transient or server error records nothing. If the commit succeeded but the conversation update was lost, the next decision or rebase reconciles it from the project record (child of the base and the expected model hash, or the Phase 30 operation's committed revision). One pending action at a time; a new one supersedes the previous one, and a new constraint withdraws a pending action it would violate.

### 3.4 Persistence (R7)

No new table. Additive optional fields in the existing `state` JSONB (`memory`, `turns` ≤ 10, `actions` ≤ 8), so Phase 20 rows and responses are unchanged. Messages keep their Phase 20 shape (user role); turns are the assistant role (`role: 'assistant'`, `inReplyTo` = message id). Migration `0025_conversation_turns.sql` replaces `conversation_write` forward-only, keeping every existing branch and adding `advance` (new base must be the project's current revision and a direct child of the old base) and `rebase` (any newer current revision), both fenced by state version, by any live lease of another worker and by the server HMAC envelope; both clear the Phase 20 submission receipt of the old base. Retention and deletion are unchanged: memory, turns and actions live inside the conversation row, deleted with the conversation (`DELETE …/conversations/:id`) or cascaded with the project.

### 3.5 Bounds and failure handling (R6, R10)

| Bound | Value |
|---|---|
| Turn text | 2 000 characters (Phase 30 grammar limit) |
| Turn and decision body | 40 960 bytes; rebase 1 024 |
| Context document | ≤ 12 000 bytes; closed memory, history, then trailing facts are dropped (`truncated: true`) |
| Memory / turns / actions | 48 / 10 / 8; closed entries dropped oldest-first; active constraints and decisions are never dropped silently (422 `CONVERSATION_MEMORY_LIMIT`) |
| State | trimmed below 120 000 bytes (oldest turns, then oldest messages) under the 131 072-byte column check |
| Rate limits | turns, decisions and rebase are in the existing `generate` group |
| Provider | Phase 21 timeouts, retries, circuit breaker and output-size bound; failures surface as stable 503 codes (e.g. `PROVIDER_TIMEOUT`) with nothing recorded |

Logs (existing pino redaction): conversation, project, turn, classification, status, action, decision, revision, verification, interpretation mode, provider outcome, `contextHash`, `contextBytes`, duration. No message text, prompts, credentials or tokens.

## 4. Engineering evidence (R8)

Engineering questions are answered only from the Phase 35 assessment of the base revision: per domain, its status, assurance level, evidence class (passed through unchanged, `null` when nothing is computed) and blocker codes, with the report's `claims` (all `NOT_CLAIMED`) and limitations. Each reply discloses: no validated solver; no standard edition, clause, load value, safety factor or rate; the V2 research set is unavailable; nothing is professionally reviewed (software never assigns `professionally_reviewed`). Requests for a value add an explicit "not given" disclosure.

## 5. Known limitations and unsupported capabilities

- No free-text model answers: the Phase 21 `EXPLANATION`/`LANGUAGE_INTERPRETATION` capabilities are `PLANNED`. Replies are composed from records by rules; wording outside the grammar gets a clarification listing what is supported.
- Option lists exist only for exterior finishes (the four Phase 30 presets). "The second option" resolves only against options the backend itself listed in this conversation.
- No operation changes storey heights, moves or resizes stairs, designs structure, changes interior finishes, or produces renders, panoramas or video — refused with the nearest supported alternative.
- Requirement regeneration is limited to the Phase 20 planner (up to two floors) and regenerates the whole design; it conflicts with every active constraint once a revision exists.
- Zone regeneration needs a structured request; templates, zones and window rules are never inferred from wording.
- Constraints on supplied revisions are enforced at the scope level of the Phase 30 vocabulary; Building Model V2 has no shafts, risers, panels or load paths to protect.
- A conversation does not follow a newer revision automatically; `rebase` is explicit.
- The OpenAPI document regenerated with identical semantics for the Phase 30 operations; only `$ref` targets moved, because the generator references the first occurrence of shared sub-schemas, which is now inside `Conversation`.

## 6. Frontend contract notes

The F25–F28 chat contracts (`/messages`, `/proposals/approve`, `/tools`) are unchanged for conversations that do not use turns. New, additive: `/turns`, `/actions/:actionId/decisions`, `/rebase`, `/context`, and the opt-in `turnsOnly` flag on creation. Every action carries a `confirmation` descriptor (`method`, `route`, `body`, `requires`) so the client never constructs operation bodies itself. No frontend repository was inspected in this phase; Phase 30 frontend integration verification remains deferred.

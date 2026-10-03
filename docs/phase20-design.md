# Phase 20 — conversational architectural intelligence

## Verified starting point

The working directory for this implementation is the Linux `designflow` checkout, not the Windows path in the request. HEAD is `094e6856a61abfeee78881dbc98fe34ef10eb970`, branch `main`. The last verified checkpoint is `backend-v1-phase18-complete`. Phase 19 is present as uncommitted implementation and evidence; `backend-v1-phase19-complete` does not exist. No commit, tag, branch change, staging, reset, stash or push was performed.

`phase20-evidence/baseline.json` records incoming Git status and source hashes. A recovery copy is `/tmp/designflow-phase20-incoming.tar.gz`. The Phase 19 design, baseline, review report and verification manifest were inspected. The actual checkout differs from that historical report: `apps/web` is absent, its tracked README is already deleted, and there is no `web:build` script. The absence is preserved.

The inspected integration boundaries are the Phase 18 candidate/interpreter/provider modules; native generator V1/V2 input and normalization; Building Model V2; independent blueprint QA; signed project revision commits and freshness identities; owner JWT repositories; Phase 16 workflow planning/execution/source reuse; and downstream takeoff, construction and costing services. No solver, QA algorithm, quantity engine or historical migration is replaced.

## Pipeline and authority

Authenticated owner request → bounded conversation lease → deterministic interpretation, optionally a local HTTP model for unknown wording → strict untrusted intent schema → merge pending changes into native requirements → native normalization → durable proposal and diff → explicit exact-proposal approval → existing `saveProjectRevision` generation and independent QA → atomic signed revision commit and conversation receipt.

The planner imports public normalization, units and identity helpers. It cannot call generation, SQL, shell or arbitrary code. Import-boundary tests explicitly permit the new validation helpers while continuing to prohibit generator entry points and dynamic execution. The Phase 18 interpreter and its V2-modification rejection remain unchanged; Phase 20 has a separate preservation-aware path.

## State, identity and retention

Each owner can keep 100 conversations total and 20 per project. A conversation supports 100 accepted message transitions; start a new conversation to continue after that cap. Each state stores schema version 1, CAS version, explicit base revision, solver selection, exact cumulative intent, pending intent, immutable base requirements, proposed native requirements, pending questions, unsupported requirements, field provenance, current proposal, provider provenance and a deterministic display summary.

The last 20 display messages are retained, with further oldest-message trimming at 120 KB serialized state to respect PostgreSQL's 128 KiB JSONB bound for multibyte text. Summaries never supply authoritative requirements. Historical messages are not sent to inference; only structured intent and unresolved questions are supplied within a 12 KB context budget. Native requirements remain available even after message trimming.

A new message supersedes the previous proposal. Each proposal diff covers the whole change from the approved base, including earlier unapproved edits. Only the latest proposal is stored; superseded approval identities cannot be used again. The state machine is `DRAFT → NEEDS_CLARIFICATION | AWAITING_APPROVAL | FAILED`; clarification and review states can accept a new message. `AWAITING_APPROVAL → SUBMITTED` requires exact explicit approval. Typed generation rejection records `FAILED` and its actual safe error code. `REJECTED` is reserved in the schema; there is no separate reject endpoint. Deleting the conversation discards its state and replay receipt, leaving accepted immutable revisions intact. Profile/project deletion cascades conversation data. There is no automatic age-based deletion job. Proposals expire after 24 hours; a fresh message creates a new review version.

Client-supplied conversation IDs make create retries identifiable. Message requests use `messageId`, `expectedVersion` and `baseRevisionId`, rather than a second idempotency header. The latest accepted message replays exactly without another inference call, with changed payload returning conflict. Earlier message retries after a newer transition conflict on version; historical response snapshots are deliberately not retained. After submission the conversation status is terminal, so fetch the current conversation rather than expecting its pre-submission message response. Approval results replay for the conversation lifetime, including after later project revisions. Deleting the conversation removes this replay facility.

A 60-second durable lease protects provider work and approval generation across processes. Concurrent requests receive `MESSAGE_IN_PROGRESS`; an abandoned lease may be reclaimed after expiration. Expired workers cannot finish using an old token. No project lock is held while waiting for inference or running the solver. SQL locks the individual conversation only during state transitions and uses the existing project CAS for revision writes. Uncertain transport failures retain the lease so a committed result can be recovered. No promise of exactly-once inference is made for a process crash before persistence; accepted retries are protected.

## Requirements and language

The free parser preserves Phase 18 English/Hinglish count, plot/unit, floor, kitchen connection and floor-allocation grammar. Phase 20 adds conversational filler, explicit unit corrections, bigger-kitchen clarification, privacy/daylight/ventilation preference switches circulation width, explicit room dimensions (for example `make the kitchen 3 by 4 metres`), unique-room floor movement and named room adjacency. Singular repeated-room references require clarification; plural bedroom/bathroom dimensions explicitly apply to that type. It preserves room counts and all unrelated native fields when applying a patch. Inferred upstairs language cannot override a persisted or explicitly supplied one-floor constraint. An ambiguous room reference is not resolved by choosing an arbitrary room.

Kitchen enlargement requires minimum width and depth, supplied by a typed clarification answer or validated inference. Minimum dimensions do not establish that actual generated geometry grew. Bedroom floor allocation preserves common group constraints; heterogeneous bedroom groups require an explicit native update. Count changes spanning multiple existing groups also require an explicit allocation. Rooms, relationships, site, stairs and V2 settings have strict user-only `nativeUpdate` fields for exact advanced inputs. These fields are explicit replacements of the supplied native collections/objects, not a JSON Patch API: send their complete desired values; omitted top-level fields are preserved. Provider output cannot populate `nativeUpdate`.

`restoreRevisionId` reads stored native requirements through the owner/project-scoped revision repository. The revision must belong to the same project and solver version. Restoration proposes a new revision on the current base; it never changes historical geometry in place. A textual request for a previous version without an ID asks for clarification. Native updates/restoration still require approval and QA. Unsupported requirements remain visible until the user explicitly retracts their names with `removeUnsupported`; ordinary new turns do not silently erase them.

V1 remains the default. Only `layoutV2: {}` at conversation creation opts a new design into V2; existing V2 bases retain V2. Existing V1 revisions cannot be converted through this API. V2 room edits clone native requirements and retain exact site/buildable polygons, setbacks, parking, separations, cardinal preferences, objective weights, hard privacy constraints, seed, resource budgets and stairs. A rectangular phrase cannot overwrite an existing constrained/nonrectangular site. Native validation rejects room/relationship conflicts. The solver retains at most two floors, 24 rooms, bounded orthogonal sites and a single inscribed rectangular envelope. No twisting skyscrapers, arbitrary building footprints or structural certification are introduced.

## Optional inference

Set `AI_CONVERSATION_MODE=fallback` (default), `disabled`, or `local`. Local mode requires `AI_CONVERSATION_MODEL` and `AI_CONVERSATION_ENDPOINT`; optional `AI_CONVERSATION_API_KEY` stays server-side. Example endpoint: `http://127.0.0.1:11434/v1/chat/completions`. Only numeric IPv4/IPv6 loopback HTTP endpoints at the exact `/v1/chat/completions` path are allowed. Remote hosts, DNS names, embedded credentials, queries, fragments, redirects and user-request endpoint overrides are rejected. In a container, the service must share the inference server's loopback namespace; arbitrary Docker hostnames are intentionally unsupported.

The adapter uses the stateless JSON chat-completions interface documented in [Ollama's compatibility reference](https://docs.ollama.com/api/openai-compatibility). It requests non-streaming JSON, temperature 0 and a bounded `max_tokens`. An operator must install and select a compatible model; this work does not install one or measure its language accuracy. No SDK, paid model, GPU, vector store or new runtime dependency is mandatory.

Existing timeout/token settings bound the adapter to 1–30000 ms and 128–4096 output tokens. Response reading is capped at 16 KiB, including streaming transport chunks. Cancellation covers the HTTP request and body. Malformed JSON, privileged fields, tool/function calls, truncated completions, HTTP authentication/rate-limit/unavailability errors, redirects and timeouts produce typed failures. Unknown language remains unresolved on fallback. Usage tokens are not currently collected; configured token caps are enforced in the request and byte limits independently constrain actual responses.

## API

All routes use authenticated caller repositories and existing quotas. Message and approval routes share the expensive-operation quota. Bodies are limited to 8 KiB for creation/approval/tools and 32 KiB for messages.

| Method/path under `/api/projects/:projectId/conversations` | Contract |
| --- | --- |
| POST collection | `{conversationId, baseRevisionId, layoutV2?: {}}` |
| GET collection | `limit` 1–20 and UUID cursor; ascending-ID pagination |
| GET `/:conversationId` | Current bounded state and proposal |
| DELETE `/:conversationId` | Delete conversation data, retain accepted revisions |
| POST `/:conversationId/messages` | `{messageId, expectedVersion, baseRevisionId, text, answers?, nativeUpdate?, restoreRevisionId?, removeUnsupported?}` |
| POST `/:conversationId/proposals/approve` | `{proposalId, proposalVersion, baseRevisionId, requirementsHash, approve:true}` |
| POST `/:conversationId/tools` | At most four strict registered read-only actions |

Registered tools are `READ_CURRENT_REVISION`, `CHECK_CAPABILITIES`, `COMPARE_REQUIREMENTS`, `EXPLAIN_QA_RESULT` and `PLAN_EXISTING_WORKFLOW`. Each has validated inputs and outputs. The workflow planner reuses Phase 16 ownership/source checks and does not execute or persist a workflow. Only the user-facing existing workflow endpoint executes downstream work. Model tool calls are rejected; there is no model-controlled function dispatcher, recursive agent loop, shell, SQL or URL-fetch tool.

Approval explicitly names the exact version, base, proposal ID and requirements hash. The server reads the persisted proposal; it does not accept geometry, QA or replacement requirements in an approval body. The existing solver generates a real generation ID and model hash, runs independent QA and signs the normal project commit. A narrow repository wrapper submits that signed commit through `conversation_write`; PostgreSQL verifies the proposal binding and atomically calls existing `project_write` together with recording `SUBMITTED` and the response. Existing revision CAS, signatures, ownership, immutable history and QA acceptance stay authoritative.

## Database and security

Forward-only migration `0012_conversations.sql` adds `architectural_conversations`, owner-only SELECT RLS, project/owner indexes, `conversation_read` and HMAC-protected `conversation_write`. Ordinary authenticated and anon clients cannot INSERT/UPDATE/DELETE state. Both RPCs check caller JWT ownership and project association. The write HMAC includes caller, operation, exact input and expiry; an authenticated user cannot forge approval logic through a direct RPC. The existing signing key is reused, not exposed through a new configuration table. No service-role repository is used by conversation routes.

The table holds exact intent, bounded display messages and the accepted replay response; deployments must treat these as private project data. Caller credentials, signing keys and provider credentials are not placed in model prompts or application logs. Logging uses route templates, conversation ID, state version, status, durations, action names and typed failure codes. Logger redaction adds text, messages, intent and conversation API keys. Basic injection/credential patterns are rejected, but keyword matching is not a complete prompt-injection defense: strict schemas, absence of executable tools, owner authorization and separate user approval are the trust boundary. Do not send secrets as architectural text.

## Explanation boundaries and remaining work

Explanations distinguish defaults, inferred floor allocations, inherited requirements and changed top-level fields. They expose actual persisted QA summaries and safe actual generation failure codes. Before generation, feasibility and physical performance are unavailable. No model-authored quantities, costing, certification, light levels, ventilation performance or engineering compliance are accepted as evidence. The existing capabilities registry still marks future visualization and engineering modes as planned.

This is a bounded backend implementation, not a conversational frontend or unrestricted architectural assistant. General pronoun resolution, unrestricted natural-language per-room dimensions/relationships, qualitative size inference, automatic alternate-design search, cross-version restoration, forced stair placement beyond the native schema, historical proposal archives, model usage accounting and multi-provider routing remain unimplemented. Explicit native updates cover supported advanced solver inputs. Phase 21 can extend typed intents/provider routing after language-corpus and operator-model evaluation. Worker-isolated hard solver cancellation and larger-scale load testing are separate operational improvements. The backend does not certify engineering design.

See `phase20-review-report.md`, the verification manifest and actual PostgreSQL/Supabase acceptance artifacts for measured results; source code and mocks alone are not release evidence.

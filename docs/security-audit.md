# Phase 19/20 security and migration review

## Boundary review

Conversation HTTP routes authenticate through `requestContext` and use caller-scoped repositories. Strict schemas reject client geometry, QA, replacement requirements, forged state and undeclared approval fields. Approval reads the persisted proposal and checks its ID, version, requirements hash, base revision and expiry. SQL rechecks proposal binding and lease ownership. `submit` calls the existing signed `project_write` inside the same transaction before writing the conversation receipt. No service-role repository was introduced into application routes.

Migration `0012_conversations.sql` is additive. Its table has project/profile cascading foreign keys, owner/project indexes, bounded JSONB state, version and retained-message checks, owner-scoped SELECT RLS and no ordinary direct-write privileges. `conversation_read` and `conversation_write` are SECURITY DEFINER with an empty search path, explicit caller/ownership checks and narrowly granted EXECUTE. Writes bind an HMAC to the exact caller, operation, input and expiry. The signing secret remains in `project_private`, outside ordinary client access. Owner-level advisory locks serialize quota checks; row locks protect state transitions. Existing revision CAS protects the project. All migrations, including 0012, are unchanged by stabilization.

Table checks are a second line of defense, not a complete alternative to strict application state validation: signed server writes are trusted to supply the full schema. The server signing key is part of the trusted boundary. Authenticated users cannot acquire it or directly write rows. A direct owner read can retrieve their own receipt; it cannot execute an approval.

The registered tools have enumerated names, strict inputs/outputs and a maximum of four actions. Their implementation reads current revision identity, capabilities, proposal differences, persisted QA or an existing workflow plan. Planning does not execute a workflow. No dynamic tool dispatcher, recursive execution, shell or SQL tool is exposed to model output.

## Local inference

The adapter permits only HTTP numeric loopback at `/v1/chat/completions`; it rejects remote hosts, DNS names, URL credentials, alternate paths, query strings and fragments. Redirect following is disabled. Credentials are used only in headers. Inference context is capped at 12,000 bytes, transport output at 16,384 bytes, text at 4,000 characters, timeout at 30 seconds, and requested tokens at 4,096. Strict intent validation rejects model-authored native updates and tool/function calls. The provider cannot supply geometry or approvals. Logs use fixed event messages and redact credentials, text, messages, intents, bodies, envelopes and models.

Controlled local HTTP tests exercise response validation, malformed/oversized output, privileged output, tool calls, redirects, timeout, caller cancellation and failure fallback. These are protocol/security checks, not evidence of a real model's architectural language accuracy. No Ollama executable or default model manifests were found; no paid or real model inference was used.

## Durability and adversarial verification

The expanded PostgreSQL suite exercises concurrent approval and message processing, exact response replay, wrong/expired/superseded proposals, foreign-project restoration, cross-owner reads, anonymous access, prohibited direct writes, forged signatures, validly signed but wrong-user/operation/input/expiry envelopes, owner/project quota races and the state ceiling. An injected database receipt-write failure rolls back the revision; a simulated lost response after a committed write replays the original receipt through another API instance. Expired message leases are reclaimed and late workers rejected. These fault injections run only in disposable embedded PostgreSQL, never against pre-existing local Supabase data.

The suite does not claim globally exactly-once inference or simulate a full operating-system crash at every machine instruction. A process failure before persistence can cause inference to run again. Accepted receipts protect revision replay. Uncertain transport failures deliberately retain the lease until recovery/expiry. A rejected message can leave a 60-second lease; retries must observe the API's conflict response.

## Migration operation and recovery

Migrations 0001–0011 retain their Phase 18 bytes; 0012 retains its incoming bytes. The existing local Supabase already had 0012 applied, so no migration, reset or live schema change was necessary. Disposable PostgreSQL tests replay migrations from scratch. Existing local row digests and RLS/migration state are checked before/after acceptance in [data-preservation-report.md](data-preservation-report.md).

Before deploying to another environment, verify its backup and applied migration history, then apply only missing additive migrations through the normal reviewed migration mechanism. Do not reapply an already applied 0012 or reset data. To disable conversational inference, use `AI_CONVERSATION_MODE=disabled`; this is not a removal of stored data or all conversation endpoints. For application rollback retain the additive table and receipts. Any schema correction should be a new forward migration; dropping conversations would destroy replay receipts and is not an automatic rollback procedure.

Final commands, exit codes and evidence are in [stabilization-report.md](stabilization-report.md). A passing bounded test suite is evidence for these concrete controls, not a claim of exhaustive security proof or production-scale capacity.

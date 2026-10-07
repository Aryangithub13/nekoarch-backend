# Repair verification and rollout notes

The original authoritative repository was repaired with explicit user authorization. Work is on `codex/phases-1-23-audit-repair`; historical release tags are not repair tags. No remote push, deployment or Phase 24 implementation is authorized by this run.

## Migration order

Apply `supabase/migrations/0013_conversation_serialization.sql` before running the new message-route cleanup behavior. It replaces `public.conversation_write` using the existing signature and grants, adds token-fenced `cancel-message`, and locks the project row before the conversation. It does not rewrite application rows or old migrations. Older API code remains compatible with the new function. Applying new API source without migration 0013 leaves failure cleanup unavailable until the existing lease expires, so that order is not an acceptable completed rollout.

The local repository Supabase stack was upgraded with `npx supabase migration up --local` after fresh/upgrade disposable PostgreSQL tests. `evidence/upgrade-preservation.json` verifies that this changed no pre-existing application row, RLS flag or policy. This is local verification, not remote deployment. Other environments require their ordinary reviewed migration/release procedure.

## Runtime configuration

`PROJECT_COMMIT_SECRET` remains redacted and validated by the existing environment schema. Production `/health/ready` now returns 503 when it is absent, because the full API cannot mutate projects/conversations. `/health/live` and read endpoints remain available. Presence does not prove that the configured secret matches the database key; existing signed-write acceptance verifies that separately.

Readiness does not assert engineering correctness, provider availability or arbitrary IFC support. Existing authentication, owner-scoped access, signed writes and provider policy remain authoritative.

## Reproduce the release run

Run `python3 docs/backend-repair-1-23/verify-repair.py` from the repository root with Node 22+, installed lockfile dependencies, the existing local Supabase stack and Docker available. It uses actual repository scripts, records exact commands/exits/timings and fails on source drift or gate failure. It never resets the database or moves tags. Live Supabase acceptance creates fixture records using the existing harness; before/after row digests distinguish these additions from historical data.

The independent IFC interpreter is `/tmp/designflow-phase23-ifc/bin/python` with `scripts/requirements-ifc.txt`. This temporary development environment may need recreation after a reboot; the repair run recreated it with the bundled Python 3.12 interpreter and `uv`. It is not part of the production image.

To preserve historical Phase 23 artifacts, the runner invokes the unchanged benchmark and IFC/profile scripts in a temporary working directory where `docs/phase23-evidence` links to the new repair evidence directory. That directory contains newly generated seven-family fixtures, independent verification and timings. This changes only the output destination, not fixture definitions, validators, production source or acceptance criteria. New Supabase receipts are moved from the harness's legacy default output directory into repair evidence; pre-existing receipts remain untouched.

## Preserved boundaries

Historical model/requirements/generation identity algorithms remain unchanged. Native nested landing order stays significant under `generation-freshness-v1`. Newly rejected physical defects are not silently repaired in historical revisions. Stored data and identity hashes remain intact.

BIM remains the released two-storey, 24-room rectangle/L/setback architectural profile. Structural columns, T/cross/freeform expansion, certified materials and conversational BIM workflow authority are not added. IFC remains IFC4 ADD2 TC1 with a native TypeScript exporter. Room names such as “guest room” require explicit native selection where the schema cannot distinguish them. General multi-plate support remains explicitly unevaluated unless one plate demonstrates support.

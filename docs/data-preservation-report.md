# Data and source preservation — 2026-10-03

**PASS:** every pre-existing public-table row digest remains present after local Supabase acceptance and PgTAP. This includes all 587 pre-existing projects, 642 immutable revisions and QA records, and 360 workflows. Migration history, table RLS flags and policy definitions are unchanged. No database reset, schema change or migration application was performed against the existing stack.

The snapshots use sorted MD5 digests of complete PostgreSQL row JSON, including revision model JSON, for before/after change detection; comparisons use multisets to retain duplicate-row counts. They do not expose raw model geometry or private signing keys. Source preservation separately uses SHA-256. Digest equality is a practical preservation check, not a claim of resistance to an adversarial MD5 collision.

| Public table | Before | After | New fixture rows | Pre-existing rows missing/changed |
| --- | ---: | ---: | ---: | ---: |
| `architectural_conversations` | 0 | 0 | 0 | 0 |
| `cost_estimates` | 0 | 0 | 0 | 0 |
| `generation_logs` | 0 | 0 | 0 | 0 |
| `idempotency_records` | 3 | 3 | 0 | 0 |
| `plans` | 0 | 0 | 0 | 0 |
| `profiles` | 1 | 1 | 0 | 0 |
| `project_audit_events` | 1337 | 1412 | 75 | 0 |
| `project_revision_construction_calculations` | 352 | 371 | 19 | 0 |
| `project_revision_cost_estimates` | 247 | 261 | 14 | 0 |
| `project_revision_qa_runs` | 642 | 679 | 37 | 0 |
| `project_revision_takeoffs` | 505 | 530 | 25 | 0 |
| `project_revisions` | 642 | 679 | 37 | 0 |
| `project_workflow_runs` | 360 | 387 | 27 | 0 |
| `projects` | 587 | 620 | 33 | 0 |
| `rate_table_entries` | 9 | 9 | 0 | 0 |
| `rate_table_versions` | 1 | 1 | 0 | 0 |

The existing Supabase test cleanup deliberately retains immutable projects containing downstream takeoffs/workflows after deleting only test Auth users. Consequently, new retained fixture rows are expected; they are not changes to earlier user records. [retained-test-fixtures.json](stabilization-evidence/retained-test-fixtures.json) identifies their IDs, timestamps, creator/owner identities where stored, and digests. This task did not purge them or alter retention triggers. The 33 retained projects, 37 revisions/QA rows, 25 takeoffs, 19 construction calculations, 14 cost estimates, 27 workflows and 75 audit records are listed separately. Conversations returned to zero. Existing profile, rate and idempotency rows are unchanged.

Fault injection, lease expiry manipulation, quota fixtures, receipt rollback and concurrency experiments run in disposable embedded PostgreSQL databases created specifically for each test suite; they do not modify this existing stack. The standalone conversation benchmark also uses its own disposable database.

[Before snapshot](stabilization-evidence/database-before.json), [after snapshot](stabilization-evidence/database-after.json), [comparison](stabilization-evidence/data-preservation.json), [migration hashes](stabilization-evidence/migration-preservation.json).

All twelve migration source files retain their incoming SHA-256 hashes. Migrations 0001–0011 also match Phase 18 exactly. No accepted historical geometry or requirement identity was reinterpreted. The SHA-256 inventory and verified source recovery archive are described in [repository reconciliation](repository-reconciliation.md). The current recovery locations are in the final note below; copy them to off-machine storage before relying on them as a durable backup.


Final recovery check: the original `/tmp` files were no longer present at handoff. The clean incoming source was reconstructed from unchanged Git HEAD and all 659 file hashes reverified. Replacement source archive and verified history bundle are in `/home/aryan/.codex/visualizations/2026/10/03/01a1014c-bebc-73f1-b0ce-d7bc8e1f1807/recovery`; [incoming.json](stabilization-evidence/incoming.json) records their SHA-256 hashes. These local copies are not off-machine backups.

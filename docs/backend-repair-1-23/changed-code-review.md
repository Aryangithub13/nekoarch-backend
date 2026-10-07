# Second-pass adversarial review

This is a separate review pass by the implementing agent, not an external human review. The PostgreSQL interleavings exercise an independent database engine; IFC verification uses independent IfcOpenShell/OpenCASCADE. Final verification results are recorded separately and must pass before release classification.

## Geometry and resource boundaries

Reviewed the entire native invariant and independent QA delta, the Zod shape boundary, quantity consumers and native/BIM revalidation paths. Native invariants and QA do not call one another. Both use absolute storey elevations and positive interval penetration; exact contact remains valid. A bounding box can reject a pair, but a box intersection never establishes collision without exact polygon predicates. Hollow sections/plate infill are considered. Duplicate findings are bounded to the first collision per later element; this still rejects an invalid model and does not deduplicate quantity output.

Space support needs a floor top at the space's level elevation. Voids under modeled occupied/circulation spaces cannot disappear through outer-ring containment. Only the represented stair-flight footprint can justify a matching void; independent stair checks still require correct rise, landings, access and destination penetration. A stairwell classification alone is insufficient. A separate solid infill may establish support. General multi-plate union support remains explicitly not proven by the existing QA contract; no new geometric union engine was introduced.

This pass found and repaired R01 (floating floor), R02 (dirty-schema quadratic work), R04 (infill false rejection) and R06 (pairwise collision performance regression). Before/after failures and timings are retained. The 4096-vertex invalid ring is rejected before quadratic topology work; bounded valid geometry retains the original exact checks. The broad-phase optimization reduced the observed 200-column check from 430 ms to 10.2 ms. Regression tests include 1024 separated and coincident columns.

## Conversation semantics

Reviewed persistent intent, pending intent, native replacements, explicit answers, fallback defaults and final proposal creation. An unrelated turn cannot erase contradiction keys. Explicit native room/site replacement supersedes only corresponding keys. Inferred floors cannot resolve an explicit floor conflict. R05 repaired the additional case where a unit-only correction accidentally resolved contradictory site dimensions. Full dimension answers remain a valid resolution. Unit correction removes stale depth-unit metadata, while explicit mixed-dimension answers preserve it.

Plural capture normalization happens at the language boundary. Floor reduction removes obsolete stair requirements without silently relocating explicitly upstairs rooms. Explicit zero counts remove groups and their incident room relationships; other groups and constraints remain. Guest-room identity is not present in the native contract, so guest-room removal requires clarification/native selection rather than deleting arbitrary bedrooms. Existing solver choice, parametric edit authority, unsupported constraints, provider precedence and exact proposal approval remain unchanged.

## Database and lease fencing

Reviewed the forward migration against the released function, signed envelope checks, owner/RLS filters, lease expiry, replay, project revision CAS and deletion cascade. Migration 0013 changes only the function; historical migrations remain byte-identical. Project-before-conversation locking prevents stale project snapshots and matches project deletion/cascade ordering. The nested revision write reacquires a lock already held by its transaction. Existing concurrent approval, atomic rollback and receipt retry tests pass in disposable PostgreSQL.

Message cancellation is a separate signed action. It clears only the matching current token and its uncommitted receipt, leaving accepted state/proposals intact. A stale worker cannot clear a replacement worker. If finish committed but its response was lost, its token is already null and cleanup is a no-op; replay survives. Cleanup failure preserves the original error and the bounded lease fallback. Approval's ambiguous-write handling is preserved. A cancellation signal is checked before finish; an already-started successful database commit is not claimed to be rolled back by a later network disconnect.

The production readiness change describes the full mutation-capable service; absent signing configuration returns unavailable. It does not disable liveness or read-only requests. It verifies presence/shape through existing environment parsing, not remote agreement with the database signing key.

## Quotas, telemetry and security

Reviewed route registration, authentication quota consumption and both error-redaction stages. Workflow execution POST now shares the generation bucket. R03 removes GET revision-list calls from that bucket. Read calls use the read bucket and workflow planning remains an ordinary write operation. Limits retain their documented per-process scope.

Telemetry accepts only an explicit set of route templates, not user-supplied paths/query strings. Both safeError and sanitizeEvent retain only known internal package coordinates; messages, locals, request data, credentials and arbitrary frame paths remain excluded. Tests enumerate actual registered route templates and test raw identifier/query rejection. No authentication, provider transport, HMAC algorithm, RLS policy or public/private artifact authority was broadened.

## Historical compatibility and scope

No canonicalization implementation, identity version, generator algorithm, lockfile, released migration, historical tag or Phase 23 evidence was changed. Seven stored fixture model hashes still match. The database-wide identity query validates stored generation/model/requirements identities without rewriting any row. Invalid historical geometry, if present, may now fail revalidation; immutable data is preserved rather than silently rewritten.

D05 is a documented development environment invocation issue. D07/D17 were already repaired by Phase 23 closure. D06, D10, D15, D18 and D20 reflect preserved identity/product contracts. No structural BIM, T/cross/freeform architecture, new workflow authority, Python production dependency or Phase 24 feature was added.

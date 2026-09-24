# Phase 12 design (written before implementation)

Baseline: main at f202a44, backend-v1-phase11-complete; clean working tree and empty tag-to-HEAD diff.

1. V1 plans contain planar metre geometry and legacy sharing/estimate contracts. Complete millimetre V2 documents have different semantics and must not be coerced into plans. All new contracts live in the API package (which can depend on both generator and QA without a shared-package cycle).
2. Projects hold identity, owner, title, ACTIVE/ARCHIVED status, PRIVATE/PUBLIC visibility, timestamps and a nullable current revision. Revisions hold immutable complete V2 JSON, source, parent, sequence and creator. QA runs hold full immutable reports and engine/schema/rule-pack versions. Composite foreign keys keep parent/current/acceptance QA references within their project/revision. Deletion is not exposed; account deletion leaves inaccessible history, consistent with V1.
3. One RPC locks the project, compares baseRevisionId, inserts revision and QA, advances the pointer, records a safe audit event and stores the retry receipt in one transaction. Database-generated IDs/timestamps and a locked counter allocate revision identities. The initial project is independent of generation.
4. Both generated and supplied documents pass the complete V2 schema and independent QA. FAIL returns a bounded typed error without writes. Server QA uses a fixed product rule pack and reachability check, with exterior doors on the lowest storey as the server entrance policy. Report JSON remains intact. Acceptance QA is anchored on the revision; additional historical runs are possible without changing it.
5. RLS allows owner reads only; no direct client architectural writes. Narrow SECURITY DEFINER RPCs have fixed search paths and explicit auth.uid() ownership checks. An intentional public RPC projects only current architecture and QA summary, never owner IDs or history. Safe metadata changes are separate from revisions. Client roles cannot read or mutate audit logs or signing secrets.
6. The locked current pointer must equal baseRevisionId (null for the first save). Stale saves return REVISION_CONFLICT; archived projects reject new revisions. Existing durable idempotency storage, canonical fingerprints, 24-hour expiry and advisory-lock convention are reused. Receipt replay precedes stale/archive checks, including inside the transaction; project ID is included in the normalized fingerprint.
7. V1 routes, historical migrations, model contracts, algorithms and estimate behavior remain unchanged. Minimal existing-file changes wire new routes, transport, rate limits, configuration, runtime dependency and tests.

## Backend QA trust boundary

A caller JWT alone cannot prove server-side QA was run: otherwise callers could send a fabricated PASS directly to PostgREST. Revision commits therefore require an HMAC-SHA256 attestation over the exact envelope (caller, project, base, model, report, source, operation, receipt identity, short expiry). PostgreSQL verifies it with a secret in a non-exposed private schema. The API receives the same secret via PROJECT_COMMIT_SECRET; it is never sent to a client or logged. Migration generates a fresh key; local acceptance reads it administratively during setup, while every tested operation uses real caller JWT/RLS. Production operators provision the API secret from the private database key through their secret manager. Missing configuration fails revision writes closed; V1 is unaffected. This is an attestation, not a second authentication system or service-role query path.

## Bounds and migration policy

Keep the existing 1 MiB body limit for supplied models. Generation and metadata use the existing small-body limit. Lists use bounded keyset cursors and return metadata only. QA error details contain at most 20 findings with bounded fields. No global limit increase.

Migration is forward-only and additive, applied once by the migration ledger. Local reset is supported; rollback requires operator review because dropping these tables destroys history. No automatic down migration, hard-delete API, re-audit API, collaboration ACL or subsequent phase work.

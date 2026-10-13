# NekoArch Next-Phase Readiness

| Field | Value |
|---|---|
| Date of inspection | 2026-10-13 |
| Baseline | `phase31/development` @ `ea2b5d0c0533e7e3f682b42a029fef7c0b3f5359` |
| Inputs | [authoritative-roadmap-reconciliation.md](authoritative-roadmap-reconciliation.md) (§3 phase status, §4 conflicts, §5 scope determination); [post-audit-risk-register.md](post-audit-risk-register.md) (risks R01–R22); [../audit/AI-training-architecture-audit-2026-10-13.md](../audit/AI-training-architecture-audit-2026-10-13.md) |
| Status | **Recommendation only.** Nothing here is authorized. Every acceptance criterion below is **PROPOSED**, because no original Phase 39 criteria were recovered (R01) |

## 1. Recommendation

The next implementation phase should be **Phase 39**, conditional on the four owner decisions in §2. Phase 39 is the first phase after the merged baseline. Its *theme* is supported by two independent repository sources:

| Source | Strength | What it says |
|---|---|---|
| `docs/phase36/phase36-handoff.md` §9 (`a7e3da4`) | Written with the original roadmap present | "specialist AI workers (B39–43)" |
| `docs/phase30/phase30-report.md` §K; `docs/modernization/modernization-report.md` §E and §I | Later-phase assignments | "Interior/exterior AI modules, generative alternatives, provider routing → 39, 43"; "F51–F54 … AI modules → planned (B39)" |

Phase 39's deliverables and acceptance criteria are **not** recoverable. The plan in §4 is therefore a PROPOSED first slice: the AI capability foundation that every reading of Phases 39–43 needs. It is not a reconstruction of the original Phase 39.

### 1.1 Why not another phase first

| Candidate | Why not next | Evidence |
|---|---|---|
| Phase 36 gateway, later slices | Blocked on owner decisions D1–D7 (provider, sweeper identity, callbacks, budget, privacy) and rulings on G7, G8 and G12 | R18; KB roadmap §4.2–4.3 |
| Phase 40 | **Role UNRESOLVED** (conflict C5). If it is an audit, it is read-only and can run in parallel with 39. If it is an AI phase, it follows 39 | Reconciliation §4 C5 |
| Phase 41 or 43 | Depend on 39's provider and capability contracts. Phase 43 also needs remote placement, which is a schema literal `DISABLED` | `apps/api/src/compute/contracts.ts` |
| Phase 44 | Touches every owner-scoped RLS policy and RPC (`0006`–`0027`). Unsafe alongside any schema work | Reconciliation §5 |
| Phase 45 | Theme Medium for push progress only. Touches jobs, scene and `http-protection.ts` | Reconciliation §5 |
| Phase 46 | Last by definition | — |

## 2. Decisions required before implementation begins

| # | Decision | Why it blocks | Recommended default (PROPOSED) |
|---|---|---|---|
| D-A | Confirm Phase 39 as "specialist AI modules and provider routing", and resolve conflict C4: Phase 38 = documentation/evidence, provider routing = 39 | Without it, 39 is built on an unconfirmed theme (R01, R15) | Confirm |
| D-B | Rule on Phase 40's role (C5) | Determines whether 39 and 40 run in parallel | Treat 40 as a read-only readiness audit of `ea2b5d0`, plus a delta after 39 |
| D-C | AI policy: allowed providers (local-only or a named free tier), privacy floor, whether user text may be stored for evaluation, and budget unit and ceiling | Privacy (R08), spend (R07), dataset capture | Local OpenAI-compatible endpoint only; `LOCAL_ONLY`; no storage of user text; metered providers stay refused (`allowMetered:false`) |
| D-D | What "interior/exterior design" outputs mean | Determines slice 2 | Structured specifications attached to Building Model V2 entity IDs (finishes, materials, furnishing schedule), not images. Deferred to slice 2 |

Not blocking for slice 1, but **blocking any release or deployment**:
- **R03:** read-only hosted migration check by an authorized operator.
- **R04:** a `workflow_dispatch` run of `supabase-acceptance` on `ea2b5d0`.

Recommended housekeeping before slice 1 (owner authorization required):
- **R02:** refresh and merge the knowledge-base registers.
- **R14:** review and merge `phase37/read-cap`.
- **R22:** base every branch on `phase31/development`, not `main`.

## 3. Dependencies (VERIFIED interfaces on `ea2b5d0`)

| Dependency | Location | What Phase 39 uses it for |
|---|---|---|
| Phase 21 orchestrator | `apps/api/src/ai/orchestration/{orchestrator,registry,transport,conversation}.ts`; `contracts/ai-orchestration.ts` | Routing, privacy, retries, circuit, fallback. To be generalized (R06) |
| Phase 18/20 interpreters | `ai/architectural-interpreter.ts`, `ai/conversation-planner.ts`, `ai/fallback-parser.ts` | Deterministic baselines for evaluation |
| B31 references | `apps/api/src/references/*` | **Not consumed in slice 1.** A later slice needs untrusted-content handling (R10) |
| B33 brief/context | `apps/api/src/account/*`, `0023` | Not consumed in slice 1 (Phase 41 per the weak assignment) |
| B32 jobs / B36 gateway | `apps/api/src/jobs/*`, `apps/api/src/compute/*` | Not used in slice 1. An AI job kind would need a forward migration of the SQL `check (kind in …)` (`phase36-handoff.md` §3) |
| B37 graph / B38 evidence | `services/dependency-graph-service.ts`, `services/evidence-service.ts` | Not changed in slice 1. AI artifacts as graph nodes come in a later slice |
| Discovery | `services/overview-service.ts` (`aiCapabilities`) | Capability status reporting (R16) |

## 4. Phase 39, slice 1: AI capability foundation (PROPOSED plan)

**Scope.**
- Make the AI layer able to host more than one capability safely and measurably.
- No new user-facing AI feature is enabled by default.
- No provider, credential or paid account is added.
- No migration.
- No change to engineering blockers or claims.

### 4.1 Workstreams

| WS | Topic | Change (PROPOSED) | Primary files |
|---|---|---|---|
| WS1 | Capability-specific schemas | A versioned descriptor per capability: `{capability, inputSchema, outputSchema, promptId, promptVersion, privacyFloor, maxOutputTokens, deterministicFallback?}`. A generic `execute(capability, input)` routes and validates against the descriptor's output schema. The existing `interpret()` and `orchestrate()` become thin wrappers with byte-identical behavior | `ai/orchestration/*`, `contracts/ai-orchestration.ts`, new `ai/capabilities/*` |
| WS2 | Offline golden evaluation | A repository-authored, CC0 golden set of briefs with expected outputs (including Hinglish and adversarial/injection cases). An `eval:ai` script runs the deterministic baseline and any configured adapter over **recorded** responses. Reports are keyed by commit, dataset hash, model ID and prompt hash. No network in CI | new `test-support/ai-eval/**`, `scripts/eval-ai.ts`, `package.json` script |
| WS3 | Versioned prompts | Prompts move from inline constants (for example `INTENT_SYSTEM_PROMPT`) to a registry with an ID, a version and a sha256 of the exact text. Any change to the text without a version bump fails a test | `ai/conversation-provider.ts`, new `ai/prompts/*` |
| WS4 | Privacy enforcement | Each descriptor declares a privacy floor. Routing refuses a route below the floor *before* any adapter call. `LOCAL_ONLY` descriptors can never reach a `REMOTE_OPENAI_COMPATIBLE` adapter, whatever the policy | `orchestrator.ts` `routes()` |
| WS5 | Provider failure behavior | Keep the existing semantics (retries ≤ policy, circuit, `ALL_PROVIDERS_FAILED`, deterministic fallback). Make them per-capability. A capability with no deterministic fallback fails closed with a typed error; it never returns partial or unvalidated output | `orchestrator.ts` |
| WS6 | Provenance | Add `promptId`, `promptVersion`, `promptHash`, `outputSchemaVersion` and `descriptorVersion` to `AiProvenanceSchema` as **optional** fields. Stored conversation states without them still parse | `contracts/ai-orchestration.ts` |

**Parallelism inside the slice.** WS2 (data and script only) and the WS3 prompt inventory can proceed independently of WS1. WS4, WS5 and WS6 build on WS1.

### 4.2 Measurable acceptance criteria (PROPOSED; not original criteria)

| ID | Criterion | How it is measured |
|---|---|---|
| A1 | No regression: every existing test passes unchanged | `npx vitest run` on Node 22.22.0 and 22.23.3. Zero modified assertions in `ai-*`, `conversations*`, `conversation-turns*` and `interpretation*` tests (diff review) |
| A2 | Compatibility: for `ARCHITECTURAL_INTENT_EXTRACTION`, the outputs and provenance of the existing paths are byte-identical apart from the new optional fields | New snapshot test over the existing fixture adapters |
| A3 | Each descriptor validates output against its own schema. A wrong-shape output yields `PROVIDER_SCHEMA_VIOLATION` and fallback (or a typed failure) | Unit tests per descriptor, including one negative case each |
| A4 | Privacy floor: 0 adapter invocations for any request whose floor forbids the route | Test with a spy adapter, extending `ai-orchestration.test.ts:37` |
| A5 | Prompt integrity: changing prompt text without a version bump fails a test. Provenance carries the prompt hash | Unit test |
| A6 | Golden set: at least the existing grammar's supported intents, at least one Hinglish case, and at least 10 injection cases. Every record has a licence (CC0 or project-authored) and a hash | Script and schema check |
| A7 | Baseline report: `eval:ai` run on the deterministic baseline produces a report recording schema-valid rate, field exact match, invented-value count and injection violations | Report committed under `docs/phase39/` |
| A8 | Injection: 0 out-of-schema fields, 0 approvals and 0 tool calls across the injection cases | `eval:ai` |
| A9 | Engineering boundaries unchanged: Phase 35 assessment, evidence-package claims and compute claims stay byte-identical on the existing fixtures | Existing `engineering*`, `evidence*` and `compute*` tests |
| A10 | Discovery is truthful: `aiCapabilities` reports exactly the descriptors registered as `AVAILABLE`; nothing new is `AVAILABLE` without a descriptor, tests and an evaluation report | Modernization route-catalog and OpenAPI drift tests; discovery test |
| A11 | No migration, environment variable or dependency is added (or each is explicitly approved) | `git diff --stat` on `supabase/migrations`, `.env.example`, `package-lock.json` |
| A12 | Release gates as per the KB roadmap §5: build, typecheck, lint, full suite on both Node versions, container smoke, `npm audit --omit=dev --audit-level=high` | CI run on the PR head |

### 4.3 Migrations

**Slice 1 needs none.**
- Prompts and descriptors live in code.
- Provenance stays in the existing conversation state JSON.
- Evaluation artifacts are repository files.

Migrations later slices would need, identified from evidence and **not authorized**:

| Need | Why a migration | Number |
|---|---|---|
| A persisted AI spend ledger and budget enforcement (R07) | No table holds usage | Next free: `0028` |
| An AI job kind | `durable_jobs.kind` is a SQL `check` constraint (`phase36-handoff.md` §3) | — |
| AI-derived artifacts as revision-bound, graph-visible records (R09) | Same pattern as `0014`–`0019` | — |

Each requires owner approval, a migration-replay pin and a local Supabase receipt.

### 4.4 Out of scope for slice 1

- Interior/exterior modules (D-D).
- Reference or brief consumption (Phase 41 per the weak assignment; needs R10 hardening).
- Image, render or 3D generation (Phase 43).
- Remote providers and metered spend (D-C, R07, R18).
- Fine-tuning and dataset capture from users (D-C).
- Multi-storey generation (R11).
- Any change to engineering blockers (R12).

## 5. Execution allocation (PROPOSED; requires D-B)

| | Account A | Account B |
|---|---|---|
| Branch | `phase39/ai-capability-foundation` from `ea2b5d0` | `phase40/readiness-audit` from `ea2b5d0` (only if D-B rules 40 = audit) |
| Owns | `apps/api/src/ai/**`, `contracts/ai-orchestration.ts`, `test-support/ai-eval/**`, `docs/phase39/**`, and the shared hotspots: `lib/http-protection.ts`, `services/overview-service.ts`, `docs/modernization/openapi.json` and `api-routes.json`, the Sentry allowlist, `package.json`, the CI workflow | `docs/phase40/**` only |
| Migrations | None in slice 1; `0028` reserved to A | None |
| Merge order | After CI is green | Docs-only, any time; then a delta audit of A's merge |

If D-B rules that Phase 40 is an AI phase, Account B should instead do read-only verification of R03, R04, R14 and R19 (no code). There is no second code stream this round.

## 6. Unresolved questions

1. D-A to D-D (§2).
2. Commit the original roadmap to `docs/sources/` (R01); this would resolve most open items.
3. Who performs the hosted check (R03), and when?
4. Should the knowledge-base branch be merged (R02), and should `phase37/read-cap` be merged (R14)?
5. Should `main` be retired or realigned with the default branch (R22)? Do not rewrite history without explicit instruction.

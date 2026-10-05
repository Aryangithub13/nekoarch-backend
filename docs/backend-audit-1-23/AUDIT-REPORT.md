# NekoArch.ai Authoritative Backend Audit Report
## Phases 1–23 Complete Adversarial Audit
### Independent Principal Systems, Security, Computational Geometry, Database/RLS, BIM/IFC & Reliability Review

---

## 1. Executive Summary & Audit Classification

**FINAL AUDIT CLASSIFICATION: `AUDIT COMPLETE — MAJOR DEFECTS FOUND`**

This report represents an exhaustive, adversarial, audit-only review of the authoritative NekoArch backend (`designflow`) spanning all historical and contemporary milestones from **Phase 1 through Phase 23**. In strict compliance with the audit charter:
- **Zero source files were modified.**
- **Zero production fixes were applied.**
- **Zero git commits, tags, or merges were performed.**
- **The external frontend (`NekoArch`) was untouched.**
- Every finding was subjected to the mandatory 7-step back-and-forth analysis (Suspicion → Pro-Argument → Counter-Argument → Reproduction → Counter-Reproduction → Root Cause Analysis → Final Verdict).

### Defect Count Breakdown

| Severity | Count | Defect IDs | Key Subsystems Impacted |
|---|---|---|---|
| **P0 (Critical)** | **0** | — | No unauthenticated remote code execution or cross-tenant data leaks found. |
| **P1 (High)** | **6** | D01, D02, D08, D09, D11, D12 | Conversation State, Geometry Invariants, Core QA, Database Concurrency |
| **P2 (Medium)** | **15** | D03, D04, D05, D06, D07, D10, D13, D14, D15, D16, D17, D18, D19, D20, D21 | Rate Limiting, BIM/IFC Projection, Telemetry, Unit Parsers, CI/CD Tooling |
| **P3 (Low)** | **0** | — | Bounded minor issues elevated or grouped into specific technical cards. |
| **Total Confirmed Defects** | **21** | **D01–D21** | Verified across unit, database, IFC, and conversational runtimes. |

---

## 2. Repository Baseline & Environment Evidence

All baselines were established and preserved prior to audit execution:
- **Authoritative Root:** `/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow`
- **Git Commit (HEAD):** `7086209efd9e337a2c175b9bed1e562fde54ca68` (`Backend V1 Phase 22 complete`)
- **Git Branch:** `main`
- **Git Tags:** Latest committed tag is `backend-v1-phase22-complete`. **Tag `backend-v1-phase23-complete` does not exist.**
- **Working Tree State:** Working tree contains Phase 23 BIM/IFC implementations in an uncommitted/untracked state (`apps/api/src/bim/`, `scripts/verify-ifc.py`, `tests/bim/`).
- **External Recovery Archive:** Created before diagnostics at:
  `/home/aryan/.gemini/antigravity-ide/brain/5d21d47a-a9bc-4022-96c6-3469d5411c77/backup-source-baseline.tar.gz`
  - SHA-256: `ac294036f2bca7b25b5fcbe0340e5b94d04e39935c80b4973d9f9b546f07a3b4`
- **File Manifest:** 1,084 total files cataloged in `docs/backend-audit-1-23/source-manifest.json`.
- **Runtime Environment:** Node.js `v20.18.0`, PostgreSQL 16 (via local Supabase container), Python 3.12 (`ifcopenshell` virtualenv at `/tmp/designflow-phase23-ifc`).

---

## 3. Phase 1–23 Review Matrix

Every phase was evaluated independently against its architectural goals, test coverage, and cross-phase integrity:

| Phase | Milestone Name | Status | Key Findings / Confirmed Defects |
|---|---|---|---|
| **Phase 1** | Core Monorepo Setup & Contracts | **PASS** | TypeScript project references, Zod contracts, and pnpm monorepo structure sound. |
| **Phase 2** | Geometric Primitives & 2D Math | **PASS** | `Point2Mm`, polygonal winding, and polygon-contains algorithms verified mathematically. |
| **Phase 3** | Wall System & Storey Boundaries | **PASS** | Wall axis offsetting and intersection joints calculate cleanly on integer millimeter grid. |
| **Phase 4** | Spatial Topology & Adjacency | **PASS** | Adjacency graphs and floor containment verified. |
| **Phase 5** | Persistence, APIs & Security RLS | **PASS WITH FINDINGS** | RLS blocks direct table tampering, but `PROJECT_COMMIT_SECRET` is not required at startup (**D19**). |
| **Phase 6** | Procedural Generation Engine V1 | **PASS** | Deterministic generator produces reproducible layouts across identical seeds. |
| **Phase 7** | Generator & API Integration | **PASS** | Route handling and DTO serialization pass regression tests. |
| **Phase 8** | Production Hardening & Runtime | **DEFECT FOUND** | Rate limiter omits workflows (**D16**); Sentry drops modern routes and package stack frames (**D13**). |
| **Phase 9** | Building Model V2 Schema | **DEFECT FOUND** | Column-column duplicate collision omitted from model invariants (**D08**). |
| **Phase 10** | Precision Blueprint Solver V1 | **PASS** | Bounded candidate search and solver iterations operate deterministically. |
| **Phase 11** | Independent Blueprint QA | **DEFECT FOUND** | Core QA ignores slab voids under occupied rooms (**D09**) and slab overlap ignores 3D collisions (**D14**). |
| **Phase 12** | Projects & Immutable Revisions | **PASS** | HMAC-SHA256 signature scheme prevents unauthenticated direct SQL mutations. |
| **Phase 13** | Quantity Takeoff Engine | **PASS WITH FINDINGS** | Net deduction algorithms accurate, but contaminated by unvetted duplicate columns (**D08**). |
| **Phase 14** | Construction Materials & Specs | **DEFECT FOUND** | `quantityDecimalPlaces` schema enforces min(6), rejecting integer/standard commercial formats (**D18**). |
| **Phase 15** | BOQ / Cost V2 Engine | **PASS** | Exact `BigInt` rational arithmetic prevents IEEE 754 precision drift; rounding rules verified. |
| **Phase 16** | Multi-Mode Workflows | **DEFECT FOUND** | Workflow registry omits BIM and IFC capabilities (**D15**); rate limiter omits workflow route (**D16**). |
| **Phase 17** | Generation Identity & Freshness | **DEFECT FOUND** | `canonicalBuilding` fails to sort nested stair landings by ID, causing hash divergence (**D06**). |
| **Phase 18** | Natural-Language Interpreter | **PASS** | Regex fallbacks and ambiguity detection correctly identify room constraints and unit mismatches. |
| **Phase 19** | Precision Solver V2 | **PASS** | 2-floor vertical alignment and straight stair placement solve reliably. |
| **Phase 20** | Conversational Architectural Intelligence | **DEFECT FOUND** | Contradictions wiped (**D01**); unit depth stuck (**D02**); case-sensitive plural (**D03**); floor reduction failure (**D04**); lease lockup (**D11**); TOCTOU race (**D12**); room count zero failure (**D21**). |
| **Phase 21** | AI Provider Orchestration | **PASS** | Outstanding SSRF defense: DNS resolution, IPv4 BlockList, socket IP pinning, and redirect bans. |
| **Phase 22** | Advanced Parametric Architecture | **PASS** | Parametric L-wings, 2-floor setbacks, and parametric QA checks function accurately. |
| **Phase 23** | BIM Digital Building Model & IFC | **DEFECT FOUND** | Missing test venv (**D05**); omitted spaceIds disconnects IFC (**D07**); columns banned (**D10**); service access edges (**D17**); arbitrary boundary limits (**D20**). |

---

## 4. Master Defect Analysis Table (D01–D21)

| ID | Title | Severity | Affected Phase | Files | Root Cause Summary | Final Verdict |
|---|---|---|---|---|---|---|
| **D01** | Conversation Contradiction Eradication | **P1** | Phase 20 | `apps/api/src/ai/conversation-planner.ts` | Overwriting `state.intent.contradictions` with empty patch on subsequent turns. | **CONFIRMED DEFECT** |
| **D02** | Unit Correction Retains Stale Depth Unit | **P1** | Phase 20 | `apps/api/src/ai/conversation-planner.ts` | Spreading site intent patch without deleting `depthUnit`, freezing depth to feet. | **CONFIRMED DEFECT** |
| **D03** | Case-Sensitive Plural Room Parsing | **P2** | Phase 20 | `apps/api/src/ai/conversation-planner.ts` | `name.endsWith('s')` on raw uppercase regex capture group causes false ambiguity error. | **CONFIRMED DEFECT** |
| **D04** | Floor Reduction Rejected on Stale Stairs | **P2** | Phase 20 | `apps/api/src/ai/conversation-planner.ts` | Reducing floors to 1 retains `r.stair`, violating generator requirement schema. | **CONFIRMED DEFECT** |
| **D05** | Package Script `test:ifc` Fails | **P2** | Phase 23 | `package.json` | Hardcoded `python3` lacks `ifcopenshell` virtual environment binding. | **CONFIRMED DEFECT** |
| **D06** | Stair Landing Identity Hash Mismatch | **P2** | Phase 17/23 | `apps/api/src/lib/generation-identity.ts` | Nested `stair.landings` array omitted from ID sorting in `canonicalBuilding`. | **CONFIRMED DEFECT** |
| **D07** | Omitted `spaceIds` Disconnects BIM/IFC | **P2** | Phase 23 | `apps/api/src/bim/project.ts` | Optional `wall.spaceIds` leaves IFC rooms with zero `IfcRelSpaceBoundary` records. | **CONFIRMED DEFECT** |
| **D08** | Coincident Duplicate Columns Contamination | **P1** | Phase 9/11/23 | `invariants.ts`, `blueprint-qa/src/core.ts` | Neither invariants nor QA check pairwise column-column collision. | **CONFIRMED DEFECT** |
| **D09** | Slab Voids Under Occupied Rooms Ignored | **P1** | Phase 11 | `packages/blueprint-qa/src/core.ts` | Core QA verifies space against slab outer ring but ignores slab void polygons. | **CONFIRMED DEFECT** |
| **D10** | BIM Rejects Models Containing Columns | **P2** | Phase 23 | `apps/api/src/bim/core.ts` | Line 33 throws `BIM_UNSUPPORTED_MODEL` if `m.columns.length > 0`. | **CONFIRMED DEFECT** |
| **D11** | Abandoned Lease Locks Conversations | **P1** | Phase 20 | `apps/api/src/routes/conversations.ts` | Missing `try-finally` around `planConversation` leaves 60s lease active on error. | **CONFIRMED DEFECT** |
| **D12** | TOCTOU Race in `conversation_write` | **P1** | Phase 20 | `supabase/migrations/0012_conversations.sql` | Project row selected before acquiring conversation lock, reading stale revision. | **CONFIRMED DEFECT** |
| **D13** | Sentry Drops Phase 6–23 Routes & Frames | **P2** | Phase 8/20-23 | `apps/api/src/lib/sentry.ts` | Hardcoded Phase 5 route whitelist and package stack frame filter strip telemetry. | **CONFIRMED DEFECT** |
| **D14** | Slab Overlap Ignores 3D Roof Collisions | **P2** | Phase 11/14 | `invariants.ts`, `blueprint-qa/src/core.ts` | Equality check on `topOffsetMm` bypasses 3D collision check for roof slabs. | **CONFIRMED DEFECT** |
| **D15** | Workflows Omit BIM & IFC Capabilities | **P2** | Phase 16/23 | `apps/api/src/workflows/registry.ts` | `CAPABILITIES` array was never extended to include BIM projection or IFC export. | **CONFIRMED DEFECT** |
| **D16** | Workflows Excluded from Generate Quota | **P2** | Phase 8/16 | `apps/api/src/lib/http-protection.ts` | Heavy workflow execution route missing from `'generate'` rate limit bucket. | **CONFIRMED DEFECT** |
| **D17** | BIM Creates Access Edges for Service Ducts | **P2** | Phase 23 | `apps/api/src/bim/project.ts` | `kind !== 'window'` incorrectly treats MEP service openings as spatial circulation. | **CONFIRMED DEFECT** |
| **D18** | Construction Schema Rejects Low Decimals | **P2** | Phase 14/15 | `packages/construction-calculations/src/spec.ts` | `quantityDecimalPlaces` enforces `min(6)`, rejecting discrete/whole numbers. | **CONFIRMED DEFECT** |
| **D19** | Missing Startup Check for Commit Secret | **P2** | Phase 5/8 | `apps/api/src/config/env.ts` | `PROJECT_COMMIT_SECRET` not required in production, crashing mutations with 503. | **CONFIRMED DEFECT** |
| **D20** | BIM Restricts Story Boundaries to 4 or 6 | **P2** | Phase 23 | `apps/api/src/bim/core.ts` | Level boundary check `![4, 6].includes(length)` rejects valid T/cross buildings. | **CONFIRMED DEFECT** |
| **D21** | Setting Room Count to 0 Corrupts Schema | **P2** | Phase 20 | `apps/api/src/ai/conversation-planner.ts` | Line 98 sets `count = 0` instead of filtering, violating `min(1)` schema. | **CONFIRMED DEFECT** |

---

## 5. Domain-Specific Audit Findings

### 5.1 Security, Auth & Row-Level Security (RLS)
- **Positive Findings:** Direct table mutation by authenticated users is completely revoked on `public.project_revisions`, `public.project_workflow_runs`, and `public.conversations`. All mutations must route through `SECURITY DEFINER` RPC functions requiring HMAC-SHA256 signatures validated against `project_private.project_secrets`. Direct queries to `project_private` return SQL error `42501`.
- **Defects Discovered:** Missing production validation for `PROJECT_COMMIT_SECRET` in `env.ts` (**D19**); omission of workflow endpoint from heavy compute rate limits (**D16**).

### 5.2 AI Provider Orchestration Transport
- **Positive Findings:** The transport implementation in `apps/api/src/ai/orchestration/transport.ts` was confirmed to be exceptionally secure:
  - DNS resolution is explicitly performed ahead of time.
  - Every IP is vetted against a hardcoded `BlockList` covering all private, broadcast, loopback, and carrier-grade NAT subnets.
  - The vetted IP is pinned directly to the TLS lookup handler, defeating DNS rebinding.
  - HTTP redirects are strictly rejected with socket destruction.

### 5.3 Computational Geometry, Invariants & Independent QA
- **Positive Findings:** Exact polygon clipping, Sutherland-Hodgman clipping, and point-in-polygon containment algorithms operate cleanly on integer coordinates.
- **Defects Discovered:** 
  - Coincident duplicate columns completely bypass invariants and QA (**D08**).
  - Core QA verifies space containment against slab outer perimeter while completely ignoring slab holes/voids (**D09**).
  - 3D slab collisions with unequal top offsets are ignored (**D14**).

### 5.4 Quantity Takeoff, Construction Calculations & BOQ Costing
- **Positive Findings:** Net deduction formulas for openings correctly subtract wall faces and volumes; BOQ costing utilizes exact `Rational` fractions backed by `BigInt` numerators and denominators, guaranteeing exact currency arithmetic without IEEE 754 drift.
- **Defects Discovered:** 
  - Unvetted duplicate columns double structural takeoff and cost (**D08**).
  - `ConstructionOptionsSchema` rejects commercial whole-number display formatting (**D18**).

### 5.5 Conversational State Machine & Natural Language Planning
- **Defects Discovered:** 
  - Unresolved contradiction eradication across turns (**D01**).
  - Unit correction preserves stale mixed depth units (**D02**).
  - Case-sensitive plural room matching causing false ambiguity rejections (**D03**).
  - Conversational floor count reduction fails due to stale stairs (**D04**).
  - Abandoned 60-second lease blocks interactive user retries on failure (**D11**).
  - TOCTOU database race in proposal approval (**D12**).
  - Setting room count to zero violates requirements schema (**D21**).

### 5.6 BIM Digital Building Model & IFC Exporter
- **Positive Findings:** IFC 2x3 STEP file generation complies with buildingSMART standards; GlobalId encoding passes strict IfcOpenShell verification; placement matrices and extrusion representations are syntactically sound.
- **Defects Discovered:** 
  - Broken test script runtime (**D05**).
  - Omitted optional `spaceIds` strips all space boundaries from IFC (**D07**).
  - Blanket ban on structural columns (**D10**).
  - Service ducts incorrectly assigned spatial circulation edges (**D17**).
  - Arbitrary restriction of floor boundaries to strictly 4 or 6 vertices (**D20**).

---

## 6. Empty / Stub / Dead Code Inventory

A comprehensive AST and text scan of production code revealed:
1. `apps/api/src/workflows/registry.ts`: PLANNED capabilities (`PROFESSIONAL_2D`, `INTERIOR_DESIGN`, `EXTERIOR_DESIGN`, `SCENE_3D`, `WALKTHROUGH`, `ENGINEERING_ANALYSIS`, `HOLOGRAPHIC_MODEL`) are explicitly marked as `'PLANNED'`. When planned, the planner sets `action: 'UNAVAILABLE'`. If forced, `executeWorkflow` cleanly rejects with 422 `CAPABILITY_NOT_IMPLEMENTED`.
2. `apps/api/src/ai/conversation-planner.ts:245`: Cleanup loops delete intent fields properly, but fail to prune rooms when count reaches 0 (**D21**).
3. `apps/api/src/lib/sentry.ts:28`: Hardcoded route list represents dead/stale configuration from Phase 5 (**D13**).

---

## 7. Existing Test Weaknesses

The existing test suites (`test:unit`, `test:bim`, `test:parametric`) achieved 100% pass rates (1,907/1,907 tests) while missing 21 significant defects because:
1. **Fixture Monoculture:** All tests reused pre-generated models from `generateBlueprintV2` (which always populate `spaceIds` and never contain columns or floor holes).
2. **Single-Turn Bias:** Conversational tests only verified single-turn inputs or immediate resolutions, never testing follow-up prompts after contradictions.
3. **No Concurrency Testing:** Database tests executed sequentially, failing to detect transaction race conditions in `conversation_write`.
4. **Isolated Virtualenvs:** `test:ifc` was never run in a standard clean container where global `python3` lacked `ifcopenshell`.

---

## 8. Recommended Repair Ordering (Phase 24 / Separate Run)

When the separate repair phase commences, repairs should be executed in this exact sequence:

1. **Step 1: Core Geometry Invariants & QA (D08, D09, D14)**
   - Add pairwise column collision checking in `invariants.ts` and `blueprint-qa/src/core.ts`.
   - Add slab void intersection testing against occupied spaces in `slabsColumnsAudit`.
   - Update slab overlap testing to check 3D vertical interval overlap.
2. **Step 2: Database Concurrency & Secrets Configuration (D11, D12, D19)**
   - Re-select and lock project row in `0012_conversations.sql` under conversation row lock.
   - Add `try-finally` in conversation message route to release abandoned leases.
   - Enforce `PROJECT_COMMIT_SECRET` in `env.ts` when `NODE_ENV === 'production'`.
3. **Step 3: Conversation Planner State Machine (D01, D02, D03, D04, D21)**
   - Preserve unresolved contradictions across unrelated turns in `conversation-planner.ts`.
   - Delete `depthUnit` on site unit corrections.
   - Use `name.toLowerCase().endsWith('s')` for plural matching.
   - Clean up `stair` when reducing floors from 2 to 1.
   - Filter room out of `r.rooms` when count reaches 0.
4. **Step 4: Canonical Identity & Model Freshness (D06)**
   - Sort nested `stair.landings` by ID in `generation-identity.ts` and SQL functions.
5. **Step 5: BIM & IFC Projections (D05, D07, D10, D17, D20)**
   - Fix `test:ifc` script to bind to virtualenv.
   - Allow columns in `bim/core.ts` and permit orthogonal level boundaries up to 32 vertices.
   - Add polygonal fallback for space boundaries when `wall.spaceIds` is omitted.
   - Restrict `accesses` graph edges to doors and traversable passage openings.
6. **Step 6: Workflows, Rate Limiting & Telemetry (D13, D15, D16, D18)**
   - Add `/api/projects/:projectId/workflows` to `'generate'` rate limit group.
   - Update Sentry allowed routes and package stack frame patterns.
   - Allow `quantityDecimalPlaces: min(0)` in construction options.
   - Register BIM and IFC capabilities in `workflows/registry.ts`.

# Capability, validation and risk register

**Baseline 2026-10-13 (r3), against `phase31/development` @ `5476f41`.** This file records what each engineering capability actually is, how far it has been verified or validated, and the known limitations and risks. Evidence classes are defined in [README §1](README.md). Source values and research status are tracked in the [research document](../research/NekoArch_Phase35_Engineering_Research_Enhanced_v2_2026-10.md).

## 1. Persisted vocabularies (do not rename)

`apps/api/src/engineering/contracts.ts` (CONFIRMED, code):
- **Assurance levels:** `CONCEPT_FEASIBILITY`, `GEOMETRIC_VERIFICATION`, `PRELIMINARY_CALCULATION`, `PRELIMINARY_COST_ESTIMATE`, `CODE_APPLICABILITY`, `VALIDATED_STRUCTURAL_ANALYSIS`, `PROFESSIONAL_DESIGN_AND_APPROVAL`.
- **Domain statuses:** `EVALUATED`, `PARTIALLY_EVALUATED`, `REQUIRES_INPUTS`, `REQUIRES_SOURCE_VERIFICATION`, `REQUIRES_SOLVER`, `REQUIRES_PROFESSIONAL_REVIEW`, …
- **Blocker kinds:** `MISSING_INPUT`, `INPUT_CONFLICT`, `SOURCE_NOT_VERIFIED`, `NO_VALIDATED_SOLVER`, `NOT_IMPLEMENTED`, `PROFESSIONAL_REVIEW`. In `assess.ts:38`, any `NO_VALIDATED_SOLVER` blocker makes the domain `REQUIRES_SOLVER`.
- **Cost-rate `evidenceClass`:** `USER_ASSERTED_OFFICIAL_SCHEDULE`, `CONTRACTOR_QUOTATION`, `USER_SUPPLIED`, `NON_AUTHORITATIVE_BENCHMARK`, `SYNTHETIC`, with backend verification `NOT_VERIFIED_BY_BACKEND` (`engineering/cost.ts:14`).
- **Per-domain R6 `evidenceClass`** (`conceptual`, `assumption_based`, `professionally_reviewed`): exists **only on PR #7** (`3717a80`), not on the default branch.
- **Phase 36 claims** (`apps/api/src/compute/contracts.ts`): `engineeringValidity`, `solverValidation`, `professionalReview`, `environmentReproducibility`. All are always `NOT_CLAIMED`.

## 2. Engineering assessment domains (B35, `engineering/assess.ts` lines 125–165)

| Domain | Assurance level | Blockers emitted | What that means |
|---|---|---|---|
| `HEIGHT_AND_STOREYS`, `AREAS_AND_VOLUME`, `BASE_SLENDERNESS` | `GEOMETRIC_VERIFICATION` | — (input-dependent) | Deterministic geometry from the stored model |
| `SITE_AND_GEOMETRY` | `GEOMETRIC_VERIFICATION` | `NOT_IMPLEMENTED` (`VERIFIER_NOT_EVALUATED`) when the B34 verifier did not run | Geometry and site checks only |
| `PRELIMINARY_COST` | `PRELIMINARY_COST_ESTIMATE` | Input- and source-dependent | Conceptual cost from caller-supplied, sourced rates; no built-in rates |
| `GRAVITY_LOADS`, `FIRE_AND_LIFE_SAFETY` | `CODE_APPLICABILITY` | `PROFESSIONAL_REVIEW` | Not computed |
| `WIND_LOADS` | `CODE_APPLICABILITY` | `NO_VALIDATED_SOLVER` (`NO_WIND_RESPONSE_METHOD`) + review | **`REQUIRES_SOLVER`**; not computed |
| `SEISMIC_LOADS` | `CODE_APPLICABILITY` | `NO_VALIDATED_SOLVER` (`NO_SEISMIC_ANALYSIS_METHOD`) + review | **`REQUIRES_SOLVER`** |
| `GEOTECHNICAL_AND_FOUNDATIONS` | `VALIDATED_STRUCTURAL_ANALYSIS` | `NO_VALIDATED_SOLVER` (`NO_FOUNDATION_DESIGN_METHOD`) + review | **`REQUIRES_SOLVER`** |
| `LATERAL_DRIFT_AND_STABILITY` | `VALIDATED_STRUCTURAL_ANALYSIS` | `NO_VALIDATED_SOLVER` (`NO_LATERAL_STABILITY_SOLVER`) + review | **`REQUIRES_SOLVER`**. The Phase 24 solver cannot establish drift |
| `DYNAMIC_RESPONSE` | `VALIDATED_STRUCTURAL_ANALYSIS` | `NO_VALIDATED_SOLVER` (`NO_MODAL_OR_DYNAMIC_SOLVER`) + review | **`REQUIRES_SOLVER`** |
| `MEMBER_DESIGN` | `VALIDATED_STRUCTURAL_ANALYSIS` | `NOT_IMPLEMENTED` (`NO_MEMBER_DESIGN`) + review | Not computed. The blocker kind is `NOT_IMPLEMENTED`, not `NO_VALIDATED_SOLVER` |
| `PROGRESSIVE_COLLAPSE` | `VALIDATED_STRUCTURAL_ANALYSIS` | `NOT_IMPLEMENTED` + review | Not computed |
| `VERTICAL_TRANSPORT` | `PRELIMINARY_CALCULATION` | `NOT_IMPLEMENTED` (`NO_LIFT_TRAFFIC_ANALYSIS`) | No lift-traffic analysis |
| `CODE_COMPLIANCE` | `CODE_APPLICABILITY` | `NOT_IMPLEMENTED` (`NO_COMPLIANCE_DETERMINATION`) + review | No compliance determination |
| `CERTIFICATION_AND_APPROVAL` | `PROFESSIONAL_DESIGN_AND_APPROVAL` | `PROFESSIONAL_REVIEW` | Never assigned by software |

Class: CONFIRMED (code). A test asserts that these statuses are unchanged by a Phase 36 job: `compute.integration.test.ts`, "leaves Phase 35 engineering blockers unchanged", passed on 2026-10-13. Standards referenced in `engineering/sources.ts` (IS 875 Parts 1–3, IS 1893 Part 1, IS 16700, NBC) are `IDENTIFICATION_ONLY`, `NOT_VERIFIED`, with a `null` edition; no value from them is used.

## 3. Validation ladder per capability

Each column records what evidence exists at that level. A blank cell means no evidence was found, not that the level was passed.

| Capability | Input validation | Deterministic calculation | Solver execution | Verified against analytical cases | Validated against independent reference | Standard coverage | Professional review |
|---|---|---|---|---|---|---|---|
| Linear-static 3D frame solver (B24, `structural/frame-solver.ts`) | Yes (Zod + `structural/validate.ts`) | Yes | Yes, bounded | **Yes**: `structural.test.ts` "Phase 24 analytical verification (independent closed forms)": cantilever PL³/3EI, wL⁴/8EI, propped cantilever reactions. Passed 2026-10-13 | **None found** (no comparison with independent analysis software or benchmark sets) | None (no IS/ACI/AISC/ASCE/Eurocode profiles; `phase24-design.md` §1) | None |
| Geometry, areas, volume, slenderness (B35) | Yes | Yes | n/a | Fixtures and regression tests (REPORTED in Phase 35 reports) | None | n/a | None |
| Conceptual cost (B15, B35) | Yes | Yes (decimal arithmetic) | n/a | Regression tests | None | No built-in rates | None |
| Wind, seismic, foundations, drift, dynamics | — | — | **No** | — | — | Identification only | — |
| Member design, progressive collapse, lift traffic, compliance | — | — | **No** (not implemented) | — | — | — | — |
| Scene compile (B29), optimization study (B28), run through the B36 gateway | Yes | Yes (deterministic engines) | Local worker pools | Output re-validated by service validators before storage (tested) | n/a: these are artifacts, not engineering results | n/a | n/a |

Supported scale (REPORTED, design documents):
- B23 BIM/IFC: ≤ 2 storeys.
- B26 building systems: refuses > 2 storeys.
- B29 scene: within the BIM profile.
- B35 zone assessment: ≤ 64 zones and 256 levels (PR #7).

No claim of arbitrary building scale is supported.

## 4. Technical limitations (current)

1. No engineering domain beyond geometry, conceptual cost and the bounded frame solver produces computed results. All load, response and design domains are blocked (§2).
2. The frame solver is verified only against closed-form cases. It has no independent validation and no design-code coverage (§3).
3. Phase 36 runs only `SCENE_COMPILE` and `OPTIMIZATION_STUDY` on local pools. Remote execution is impossible by configuration. A `SUCCEEDED` job means "accepted by the service validator", never engineering validity.
4. Phase 36 owner quotas count gateway consents only. Plain B32 submissions are governed by B32 limits (≤ 4 active per project, ≤ 120 per hour) and B33 limits (≤ 8 active per owner).
5. Environment reproducibility is not claimed anywhere. Inputs, versions and Node version are recorded for gateway jobs.
6. Immutable evidence tables (consent records, reference events, stored analyses) block project deletion. No deletion API exists; an erasure policy is undecided.
7. The AI layer (`apps/api/src/ai/`) defaults to `fallback` modes. `AI_CONVERSATION_MODE` accepts `fallback`, `local` or `disabled`, and `local` requires an endpoint and model (`config/env.ts:31,54`). External providers are configured only through `AI_ROUTING_CONFIG`. No provider is enabled by default (CONFIRMED, code).

## 5. Security and operational risks

| # | Risk | Status | Class |
|---|---|---|---|
| R-1 | **Default branch fails typecheck** (Phase 36 test file) | Open; one-line fix known ([decisions Q1](decisions-register.md)) | CONFIRMED |
| R-2 | **CI does not run on pushes to the default branch**, and its PR subsets omit 15 test files that the full suite runs (`compute`, `jobs`, `account`, `references`, `verification`, `repair-*`, `postgres-harness`, `worker-bootstrap`) | Open; PR #7 fixes it | CONFIRMED |
| R-3 | A PR merged with failing CI and no review (PR #10) | Occurred; owner process decision | CONFIRMED |
| R-4 | Hosted database state unverified (believed `0017`; `0018`–`0025` pending) | Open; needs a read-only operator check | REPORTED |
| R-5 | Duplicate migration version `0025` if `phase36/conversational-ai` merges unchanged; Git does not flag it | Open | CONFIRMED |
| R-6 | Original roadmap and research missing; phase assignments for 37–46 are REPORTED or UNKNOWN | Open | CONFIRMED |
| R-7 | The approved PR #7 now conflicts with the default branch | Open; 2 additive conflicts | CONFIRMED |
| R-8 | In-process job runner: a process stop between commit and dispatch leaves jobs `QUEUED` until an owner read recovers them (no sweeper by design, OD-05) | Accepted limitation; tested recovery path | CONFIRMED |

No new security defect was found in this pass. The Phase 36 security properties (signed quotes, ownership, RLS, grants, immutability) are covered by passing tests: [status-register §3](status-register.md).

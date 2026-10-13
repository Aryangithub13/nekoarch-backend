# NekoArch Phase 35 Engineering Research — Enhanced V2 Research Protocol

> **Document status: RECONSTRUCTED RESEARCH FRAMEWORK — NOT THE ORIGINAL V2 RESEARCH**
>
> Created: 2026-10-13  
> Intended canonical filename: `NekoArch_Phase35_Engineering_Research_Enhanced_v2_2026-10.md`  
> Approval state: owner review required  
> Research state: **No engineering standards or numerical design values are validated by this document.**
>
> The original V2 research set was reported missing from repository refs and local search locations. This file provides a reusable research protocol, source registry, and claim-validation framework. It does not fabricate or replace missing research findings.

## 1. Purpose and boundaries

This file is the default research-integrity companion for NekoArch engineering, cost estimation, calculation, and solver-related prompts. It is intended to prevent unsupported model-generated values from being mistaken for verified engineering evidence.

It is a **process document**, not a structural design manual. It contains no validated load values, design equations, cost factors, tolerance values, standard clauses, or solver-validation claims.

## 2. Mandatory use instructions for AI coding agents

Before implementing or modifying engineering calculations:
1. Read this document and any project-specific engineering contract or phase handoff.
2. Identify the jurisdiction, building use, materials, structural system, site conditions, applicable authority, and required design basis. If essential context is missing, ask or report the missing inputs.
3. Locate the primary source for every applicable standard, code, material property, load rule, equation, cost rate, or engineering threshold.
4. Record exact title, issuing organization, edition/amendment, jurisdiction, clause/table/page/equation, URL or controlled local path, retrieval date, and access limitations.
5. Separate source facts, derived calculations, assumptions, heuristics, model suggestions, software behavior, and professional judgments.
6. Verify equation dimensional consistency, unit conversions, boundary conditions, sign conventions, rounding, and applicable limits.
7. Use independent calculation or a separately implemented reference check for safety-relevant numerical outputs.
8. Test nominal, boundary, invalid, extreme, and failure inputs.
9. State exactly what is and is not validated. A provider job finishing successfully does not validate the engineering result.
10. Never claim professional review unless a named qualified reviewer actually reviewed the exact output and the review evidence is recorded.

## 3. Evidence classes

Use explicit classes in API responses, stored artifacts, UI labels, and reports. Keep the actual project enum names if they differ; map them deliberately rather than silently renaming persisted contracts.

| Class / status | Meaning | Permitted claim |
|---|---|---|
| `UNVERIFIED` | Not checked against adequate evidence | May be shown only with a clear unverified label |
| `MODEL_SUGGESTION` | Produced by an AI model or provider | Suggestion only; not a verified engineering result |
| `ASSUMPTION` | Explicit input assumption not confirmed by evidence | Must identify the assumption and its impact |
| `DETERMINISTIC_CHECKED` | Calculation completed by deterministic code and passed listed checks | Only the checks actually executed may be claimed |
| `SOURCE_SUPPORTED` | Inputs/formulas/limits are linked to an identified authoritative source | Does not by itself prove the whole design is safe |
| `INDEPENDENTLY_VERIFIED` | A separate calculation or reference implementation agrees within a documented tolerance | Record method, tolerance, and cases tested |
| `VALIDATED_FOR_DECLARED_SCOPE` | Verification evidence supports a clearly bounded solver/use case | Never generalize beyond the tested scope |
| `PROFESSIONALLY_REVIEWED` | Qualified professional reviewed the exact artifact and the review record exists | Must include review identity/qualification as appropriate, scope, date, artifact hash/version, and disposition |

Do not assign `VALIDATED_FOR_DECLARED_SCOPE` or `PROFESSIONALLY_REVIEWED` based solely on AI output, provider success, unit tests, or a green CI run.

## 4. Research lifecycle

### Stage A — Define the question

For each research item record:
- research ID;
- engineering or cost question;
- intended software feature and decision supported;
- jurisdiction and applicable project type;
- required inputs and units;
- output and units;
- exclusions and unsupported cases;
- consequence of error and required review level.

### Stage B — Locate and register sources

Prefer, in order where applicable:
1. Official standards/code publisher or competent authority.
2. Government regulations, official technical publications, and official amendments.
3. Peer-reviewed research or recognized technical institutions for questions not settled by the applicable code.
4. Manufacturer technical data for the exact product/system and version.
5. Secondary summaries only for discovery, not as the sole authority for safety-critical requirements.

Do not assume a source is freely accessible, current, legally applicable, or applicable to the user's jurisdiction. Verify each point.

### Stage C — Extract atomic claims

Every material statement should have a stable claim ID and one or more source IDs. Record the exact source location. Do not attach one broad citation to a paragraph containing unrelated claims.

### Stage D — Verify the mathematics

For each equation or algorithm record:
- equation/algorithm identifier and exact source;
- variable definitions and units;
- input domain and assumptions;
- dimensional analysis;
- conversion rules;
- boundary conditions;
- numerical method and precision;
- known singularities, instability, and failure cases;
- independent test vectors and expected results;
- reviewer and verification date.

### Stage E — Review and approve

A claim may move from research to implementation only when the evidence needed for its risk class is present. Safety-critical solver validation requires an explicit test plan and evidence; no claim may be promoted merely because a deadline or phase milestone has arrived.

### Stage F — Maintain freshness

Re-check standards, prices, provider limits, and other time-sensitive values before use. Store `checked_at`, `valid_from`, `valid_until` if applicable, and a review trigger. Do not silently reuse expired cost or provider assumptions.

## 5. Source registry template

Copy one record per source.

| Field | Required content |
|---|---|
| `source_id` | Stable ID, e.g. `SRC-0001` |
| `title` | Exact source title |
| `publisher` | Standards body, government, journal, manufacturer, provider, or other issuer |
| `source_type` | Standard, code, regulation, paper, official guidance, product data, market quote, test report |
| `jurisdiction` | Country/state/city or `not applicable` |
| `edition_version` | Exact edition, amendment, revision, or version; never infer |
| `published_date` | Date stated by the source, if known |
| `retrieved_date` | Date actually retrieved |
| `canonical_url` | Direct official URL or controlled repository path |
| `exact_locator` | Clause, table, equation, page, section, figure, or dataset field |
| `access_status` | Public, licensed, paywalled, unavailable, or not yet checked |
| `integrity_check` | File hash/version or other reproducibility detail where possible |
| `applicability` | Why it applies to the declared project and jurisdiction |
| `limitations` | Known exclusions, ambiguities, and access restrictions |
| `review_status` | `NOT_REVIEWED`, `CHECKED`, `APPROVED_FOR_DECLARED_USE`, `REJECTED` |
| `reviewer` | Person/role and date where available |

## 6. Claim and calculation register template

| Field | Required content |
|---|---|
| `claim_id` | Stable ID, e.g. `CLM-0001` |
| `claim_text` | One atomic, testable statement |
| `claim_type` | Source fact, equation, derived value, assumption, heuristic, provider claim, software behavior |
| `source_ids` | Registry IDs supporting the claim |
| `source_locator` | Exact clause/table/page/equation or code/test location |
| `jurisdiction_scope` | Where the claim is applicable |
| `inputs_and_units` | Explicit inputs and units |
| `method` | Equation, algorithm, test, or derivation |
| `independent_check` | Reference calculation or verifier and result |
| `status` | `NOT_RESEARCHED`, `SOURCE_FOUND`, `EXTRACTED`, `INDEPENDENTLY_CHECKED`, `APPROVED_FOR_DECLARED_SCOPE`, `REJECTED`, `EXPIRED` |
| `uncertainty` | Known uncertainty, interval, sensitivity, or reason unknown |
| `limitations` | Boundaries of permitted use |
| `reviewer_and_date` | Reviewer and actual review date |
| `implementation_refs` | Code, tests, API schema, and artifact versions consuming the claim |

## 7. Required validation checklist for calculations and solvers

Before a numerical capability is described as validated, the owner/team must identify which checks are applicable and retain evidence for them.

- [ ] Applicable jurisdiction, code/standard, edition, amendments, and project scope recorded.
- [ ] Every important formula, coefficient, threshold, and material property has a source ID and exact locator.
- [ ] Units are explicit at API boundaries and internally consistent.
- [ ] Input ranges, missing values, and invalid combinations are rejected safely.
- [ ] Dimensional analysis completed.
- [ ] Boundary cases and known analytical/reference cases tested.
- [ ] Independent implementation or calculation agrees within a declared, justified tolerance.
- [ ] Sensitivity and numerical stability reviewed where relevant.
- [ ] Failure paths, unsupported configurations, and solver convergence failures are tested.
- [ ] Result provenance includes input hash, algorithm/version, source-set version, units, timestamps, and verification status.
- [ ] Results cannot be silently relabeled as validated after external-provider execution.
- [ ] Professional review is recorded if claimed.
- [ ] A clear list of exclusions and unsupported use cases is published.

A checked box must link to actual evidence; do not mark checks complete from intention alone.

## 8. Current capability boundaries — known limitations

The supplied project context and Phase 36 reconciliation report state that NekoArch must not imply the existence of validated solvers for:
- wind design;
- seismic design;
- drift verification;
- foundation design;
- individual structural member design;
- lift/elevator engineering.

The report identifies `apps/api/src/structural/frame-solver.ts` as a limited linear-static frame solver. This statement is reported from the reconciliation document and must be verified against the exact source, tests, and validation record before any production capability claim. Do not infer that the solver is validated for building-code design or general structures.

The gateway must preserve Phase 35 blockers such as `REQUIRES_SOLVER` and `NO_VALIDATED_SOLVER` until a validated result exists. Do not remove a blocker because a remote job completed.

## 9. Standards research queue — deliberately unfilled

These are research work items, **not claims that a particular standard applies**. Determine jurisdiction and project context first, then identify official sources.

| Research ID | Topic | State | Required before implementation |
|---|---|---|---|
| `RCH-001` | Jurisdiction and applicable building regulations | `NOT_RESEARCHED` | Owner/project context and official authority |
| `RCH-002` | Structural loading basis and combinations | `NOT_RESEARCHED` | Applicable code, edition, exact clauses, independent check |
| `RCH-003` | Wind actions and building exposure | `NOT_RESEARCHED` | Jurisdiction, site data, official standard and scope |
| `RCH-004` | Seismic actions and detailing requirements | `NOT_RESEARCHED` | Seismic context, applicable standard and qualified review plan |
| `RCH-005` | Drift/serviceability limits | `NOT_RESEARCHED` | Applicable system and code provisions |
| `RCH-006` | Foundation/geotechnical design inputs | `NOT_RESEARCHED` | Site investigation data and qualified geotechnical basis |
| `RCH-007` | Member design and material resistance | `NOT_RESEARCHED` | Material/system-specific standards and validation evidence |
| `RCH-008` | Lift/elevator engineering | `NOT_RESEARCHED` | Applicable elevator regulations and specialist design scope |
| `RCH-009` | Construction quantities and cost rates | `NOT_RESEARCHED` | Geography, date, source quotes, taxes, scope, uncertainty |
| `RCH-010` | Environmental/sustainability calculations | `NOT_RESEARCHED` | Defined methodology, boundaries, source factors and versions |
| `RCH-011` | Computational tolerance and solver acceptance | `NOT_RESEARCHED` | Analytical/reference cases, error metrics and reviewer |
| `RCH-012` | Provider runtime, pricing, and resource ceilings | `NOT_RESEARCHED` | Current official provider terms and owner-approved budget |

Do not fill this queue with guessed code numbers, standard editions, numerical thresholds, prices, or coefficients.

## 10. Cost-estimation integrity

Every cost estimate must identify:
- geography and currency;
- price date and source;
- unit basis (for example, per item, per mass, per area, or per volume);
- included/excluded work and taxes;
- quantity derivation and waste assumptions;
- labor, transport, overhead, contingency, and escalation treatment where applicable;
- uncertainty/range and major drivers;
- whether rates are actual quotes, published rates, historic records, or heuristics.

Never present a single precise amount as guaranteed. Never invent local market rates or treat an LLM-generated number as a sourced rate. Refresh time-sensitive rates and preserve the original source.

## 11. External compute and provider integrity

For compute gateway and remote-provider work:
- Provider identity and version must be explicit.
- Credentials stay server-side and are referenced by environment/configuration names, not embedded in source or logs.
- Inputs sent externally require a documented privacy/data-transfer class and consent policy.
- Jobs need bounded time, concurrency, retries, cancellation, and cost ceilings.
- Provider output must be schema-validated, size-limited, associated with the correct project/revision/input hash, and checked by the relevant deterministic validator.
- Use idempotency and deduplication to prevent duplicate spending.
- A remote provider's `success` status means only that the provider reports job success; it does not prove technical correctness.
- Record provenance, algorithm/provider version, input and output hashes, timestamps, verification steps, and failures.
- Default remote execution to disabled until a provider and budget are explicitly approved.
- Never send sensitive project data to a provider without the required consent and authorization.

## 12. Research source integrity rules

1. Do not fabricate citations, titles, URLs, page numbers, clause numbers, quotations, or standard editions.
2. Prefer the issuing organization’s official publication for standards and regulations.
3. When only a secondary source is available, label it secondary and do not imply direct verification of the primary source.
4. Keep the source document or stable locator, retrieval date, edition/version, and relevant excerpt/claim linkage.
5. Record paywall or access restrictions; do not claim to have read inaccessible material.
6. Keep research statements separate from engineering judgment and product decisions.
7. When a source changes, preserve the old version and record what changed and which claims need revalidation.
8. Use source hashes for downloaded documents when licensing and tooling permit.
9. Avoid reproducing copyrighted standards text beyond permitted excerpts; record the locator and paraphrase the requirement.
10. If the original V2 research set is later recovered, compare it against this framework and preserve provenance rather than silently merging inconsistent claims.

## 13. Reproducibility metadata

For each research release, record:
- research-set version and date;
- owner/editor;
- source registry version;
- claim registry version;
- jurisdiction and project assumptions;
- code/test commit hashes that consume the research;
- independent reviewer and review date;
- known gaps and excluded use cases;
- change log and superseded records.

Suggested research-set version: `v2-reconstructed-protocol-2026-10-13`. This is a new reconstruction label, not evidence that the missing original V2 was recovered.

## 14. Open items

- [ ] Recover the original `NekoArch_Phase35_Engineering_Research_Enhanced_v2_2026-10...` file if available.
- [ ] Identify the initial target jurisdiction(s) for building and cost research.
- [ ] Populate the source registry from actual official documents.
- [ ] Populate claim records with exact source locators and independent checks.
- [ ] Establish solver-specific validation criteria and professional-review process.
- [ ] Verify the current `frame-solver.ts` behavior and its test coverage before making any capability claim.
- [ ] Confirm which research claims, if any, are approved for implementation.
- [ ] Have the owner review this reconstructed protocol before calling it authoritative.

## 15. Change log

- `2026-10-13` — Created as a transparent reconstruction because the original V2 research set was reported missing. No engineering standards, numerical values, or solver-validation findings were fabricated.

---

## Addendum A — Repository reconciliation (2026-10-13, revision 2)

> Everything above this line is the owner-supplied reconstruction, kept verbatim (sha256 of the supplied file: `10aa185db3c843324e92d6d95d1a5e49298a3541134485f06395892782481447`). This addendum records how the framework relates to the code that exists. It adds **no** standard, clause, equation, numerical value, cost rate or validation result. The original V2 research set remains **unrecovered**.

### A.1 Evidence classes: framework (§3) versus repository enums

The framework says to keep the project's actual enum names and map them deliberately. The persisted contracts that exist today:

| Contract | Values | Where | Basis |
|---|---|---|---|
| Assurance level (per domain) | `CONCEPT_FEASIBILITY`, `GEOMETRIC_VERIFICATION`, `PRELIMINARY_CALCULATION`, `PRELIMINARY_COST_ESTIMATE`, `CODE_APPLICABILITY`, `VALIDATED_STRUCTURAL_ANALYSIS`, `PROFESSIONAL_DESIGN_AND_APPROVAL` | `apps/api/src/engineering/contracts.ts` on `phase31/development` (B35, PR #4) | CONFIRMED (code) |
| Domain status | `EVALUATED`, `PARTIALLY_EVALUATED`, `REQUIRES_INPUTS`, `REQUIRES_SOURCE_VERIFICATION`, `REQUIRES_SOLVER`, `REQUIRES_PROFESSIONAL_REVIEW`, `UNSUPPORTED` | same | CONFIRMED (code) |
| Source verification | `verificationStatus: NOT_VERIFIED`, `permittedUse: IDENTIFICATION_ONLY`, `edition: null` | `apps/api/src/engineering/{contracts,sources}.ts` | CONFIRMED (code) |
| R6 evidence class | `conceptual`, `assumption_based`, `professionally_reviewed` (software never assigns the last) | `engineering/contracts.ts` **only on `3717a80`** (PR #7, commit `28077fa`); definitions in `docs/phase35/phase35-design.md` §2.1 at that commit | CONFIRMED in code on PR #7; **not on the default branch** |

A mapping between the framework's eight classes and these enums is **PROPOSED only**. The one correspondence that holds by definition is `PROFESSIONALLY_REVIEWED` ↔ `professionally_reviewed` / `PROFESSIONAL_DESIGN_AND_APPROVAL`: never assigned by software, and requiring a recorded review. Every other correspondence is **UNKNOWN** until it is reviewed against the Phase 35 §2.1 definitions. No persisted enum is renamed by this document.

### A.2 Capability boundaries (§8) checked against the repository

| Statement | Evidence | Basis |
|---|---|---|
| The structural solver is a bounded linear-static 3D frame solver: no wind, seismic, P-Δ, nonlinear or dynamic analysis; no design code profiles; strength and grade not represented | `docs/phase24/phase24-design.md:5,11,13,79,85`; `apps/api/src/structural/frame-solver.ts` | CONFIRMED (design doc and source present). Tests were not re-run for this document |
| Wind, seismic, drift, foundation, member design, lift and code-compliance domains are blocked (`REQUIRES_SOLVER` / `NO_VALIDATED_SOLVER` / `REQUIRES_SOURCE_VERIFICATION` / `REQUIRES_PROFESSIONAL_REVIEW`), not computed | `apps/api/src/engineering/assess.ts`, `contracts.ts` (B35) | CONFIRMED (code) |
| Lift work is limited to elevator-shaft proposals and egress graph distances; > 2 storeys refused | `docs/phase26/phase26-design.md` | REPORTED |
| Conceptual cost (`conceptual-cost-v1`, `CONCEPTUAL_PARAMETRIC`) uses only caller-supplied, sourced rates; no built-in rate, location factor or CPWD factor | `docs/phase35/phase35-design.md` §7; `docs/phase35-1/phase-1-46-reconciliation.md` §6 @ `3717a80` | CONFIRMED (design) / REPORTED (R8 exclusion) |

### A.3 Existing identification-only source catalogue (relates to §9 queue items RCH-002 to RCH-004 and RCH-007)

`apps/api/src/engineering/sources.ts` already names six candidate documents **for identification only**: IS 875 Parts 1–3, IS 1893 Part 1, IS 16700 and the National Building Code of India. All are jurisdiction `IN`, with edition, effective date, URL and retrieval date `null`; their amendment status is `UNKNOWN`, and they are marked `NOT_VERIFIED`. No value from any of them is used. This records a fact about the code. It is **not** a claim that these documents apply to any project, and it does not advance any research item beyond `NOT_RESEARCHED`. A source-registry record (§5) may be created for them only once an edition and locator have actually been retrieved.

### A.4 Consistency with Phase 36

§11 (external compute and provider integrity) matches the Phase 36 requirements recorded in `docs/roadmap/…` §4.2 (G2–G6, G11, G13): remote execution is disabled by default, a provider's success is not correctness, results are verified before persistence, credentials are server-side, consent is required for data transfer, and Phase 35 blockers are unchanged by a remote job. No change is needed.

### A.5 Change log

- `2026-10-13 r2` — Addendum A added (repository reconciliation). The supplied text above is unchanged.

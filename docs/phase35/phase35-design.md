# Phase 35 design: supertall engineering assessment and verification

## 1. Principle

Phase 35 adds a **preliminary engineering assessment** of a stored revision. It does two things and no more:

1. It computes the quantities that can be established **deterministically and exactly** from the model: storey heights, building height, gross floor area, gross volume and minimum base width. It also does conceptual cost arithmetic on rates the caller supplies with their sources.
2. For every other engineering question a tall-building concept raises, it says **why that question cannot be answered here yet**. The reasons are: missing inputs, unverified governing sources, no validated solver, not implemented, or professional review required.

No structural load, load combination, wind or seismic parameter, soil property, foundation size, member size, drift, stability, dynamic, collapse or compliance value is derived, assumed or approximated anywhere. A successful response never means a building is safe, compliant, certified or approved, and the report's `claims` say so.

Like the Phase 34 verifier it builds on, the assessment is **derived on read**. It is deterministic, identified by an input hash and a result hash, and nothing is stored.

Roadmap mapping: the Phase 34 design assigns *"High-rise specific checks (wind, drift, egress) → B35"*, and the modernization report assigns *"Large/complex models, supertall"* to B34/B35. B35 delivers the deterministic part of that and turns the rest into explicit, machine-readable blockers. It does not pretend to deliver the rest.

## 2. Assurance levels

Every domain states the level of assurance its question needs, not a level the backend reached. The seven levels are kept distinct:

| Level | Meaning | Provided by B35? |
|---|---|---|
| `CONCEPT_FEASIBILITY` | The concept can be described and reasoned about | Indirectly |
| `GEOMETRIC_VERIFICATION` | Exact dimensional facts of the model | **Yes** (with the Phase 34 verifier) |
| `PRELIMINARY_CALCULATION` | Deterministic engineering arithmetic on verified inputs | Only geometric quantities |
| `PRELIMINARY_COST_ESTIMATE` | Traceable arithmetic on sourced rates | **Yes** (caller-supplied rates only) |
| `CODE_APPLICABILITY` | Which provisions of which verified source apply | No: sources are unverified |
| `VALIDATED_STRUCTURAL_ANALYSIS` | Validated solvers with real load cases and boundary conditions | No |
| `PROFESSIONAL_DESIGN_AND_APPROVAL` | Qualified engineers and the competent authority | Never by software |

### 2.1 Evidence classes (R6)

Each domain result also carries `evidenceClass`. It answers a different question from the assurance level: **what does the computed result rest on?** The assurance level states what the question needs, so the two are never mapped onto each other.

| `evidenceClass` | Assigned when | Domains in B35 |
|---|---|---|
| `conceptual` | The domain is computed from the stored model alone (exact geometry) | `HEIGHT_AND_STOREYS`, `AREAS_AND_VOLUME`, `SITE_AND_GEOMETRY`, `BASE_SLENDERNESS`, when computed |
| `assumption_based` | The domain is computed and rests on caller-supplied values (rates, adjustments, declared context) | `PRELIMINARY_COST`, when computed |
| `professionally_reviewed` | A recorded professional review exists | **Never assigned by software.** It needs a recorded review (a B38 evidence package) and a reviewer identity. |
| `null` | Nothing is computed, so there is no result to classify | Every blocked domain (loads, solvers, compliance, certification) |

The class labels are the roadmap's wording as reported in the B36 handoff. The definitions above are this backend's own, because the canonical roadmap text is unavailable. Report §5.2's earlier proposal mapped *assurance levels* to classes; that is withdrawn, because it would have labelled an uncomputed domain (for example `VERTICAL_TRANSPORT` at `PRELIMINARY_CALCULATION`) as `conceptual`.

## 3. Domains

| Domain | Level | Outcome in B35 |
|---|---|---|
| `HEIGHT_AND_STOREYS` | Geometric | Evaluated (partially, if the top storey height is undetermined) |
| `AREAS_AND_VOLUME` | Geometric | Evaluated (volume needs every storey height) |
| `SITE_AND_GEOMETRY` | Geometric | Evaluated through the Phase 34 verifier |
| `BASE_SLENDERNESS` | Geometric | Evaluated: an indicator only, with no limit applied |
| `PRELIMINARY_COST` | Cost | Evaluated, partially evaluated or requires inputs (§7) |
| `GRAVITY_LOADS` | Code applicability | Requires inputs, then source verification, then review |
| `WIND_LOADS` | Code applicability | Requires inputs, source verification, a validated method, review |
| `SEISMIC_LOADS` | Code applicability | Requires inputs (including a geotechnical investigation), source verification, a solver, review |
| `GEOTECHNICAL_AND_FOUNDATIONS` | Structural analysis | Requires a geotechnical investigation, then a solver and review |
| `LATERAL_DRIFT_AND_STABILITY` | Structural analysis | Requires a solver: the Phase 24 frame solver is linear-static with no diaphragm, panels or P-delta effects |
| `DYNAMIC_RESPONSE` | Structural analysis | Requires a solver |
| `MEMBER_DESIGN` | Structural analysis | Unsupported |
| `PROGRESSIVE_COLLAPSE` | Structural analysis | Unsupported |
| `FIRE_AND_LIFE_SAFETY` | Code applicability | Requires inputs and source verification, then fire-authority review |
| `VERTICAL_TRANSPORT` | Preliminary calculation | Unsupported (no lift traffic analysis) |
| `CODE_COMPLIANCE` | Code applicability | Unsupported, with statutory review |
| `CERTIFICATION_AND_APPROVAL` | Professional | Requires professional review, always |

**Status precedence** (`domainStatus`): a computed domain is `EVALUATED`, or `PARTIALLY_EVALUATED` when something remains. Any other domain is `UNSUPPORTED` if anything is not implemented. Otherwise its status is set by the first blocker kind present, in this order: `REQUIRES_INPUTS` (missing input or input conflict), `REQUIRES_SOURCE_VERIFICATION`, `REQUIRES_SOLVER`, `REQUIRES_PROFESSIONAL_REVIEW`. Every blocker is listed, not only the first, so supplying the inputs moves a domain to its next real obstacle and never to `EVALUATED`.

`requirements[]` aggregates every missing input and input conflict by input path, with the domains that need it. This is the actionable list to show a user.

## 4. Deterministic calculations

| Quantity | Formula id | Definition | Units and precision |
|---|---|---|---|
| Storey height | `model-height-v2` (B35.1; `model-height-v1` before it) | v2: the next storey's elevation minus this one; for the uppermost storey, the lowest roof level above it; a declared floor-to-floor height is the basis only where it reaches that same level (or, for the uppermost storey, where no level is represented above it). v1 used a declared height unconditionally, which understated storeys with a datum or roof level above them (`docs/phase35-1/phase35-1-design.md` §4.3). v1 text: Declared floor-to-floor height. Otherwise the next storey's elevation minus this one. For the uppermost storey only, the lowest roof level above it. Otherwise `NOT_DETERMINED`. | Integer mm |
| Building height | `model-height-v2` | Top of the uppermost storey minus the lowest storey floor. `null` if the uppermost storey height is undetermined. | Integer mm |
| Gross floor area, plot, FAR, coverage | Phase 34 `complex-verification-v1` | Taken unchanged from the verifier's bases | Exact mm²; ratios as reduced fraction + `HALF_UP_4` |
| Gross volume | `gross-area-volume-v1` | Σ over storeys of gross plate area × storey height. `null` if any storey height is undetermined. | Exact mm³ string; m³ for display (6 dp, half-up) |
| Minimum base width | `convex-hull-min-width-v1` | Minimum caliper width of the convex hull of the lowest storey envelope: min over hull edges of the farthest vertex distance from the edge line, compared exactly on squared rationals | Floored integer mm |
| Height / base width | `convex-hull-min-width-v1` | ⌊√(H²·d·10⁸ / n)⌋ / 10⁴, where width² = n/d | `FLOOR_4` |

All arithmetic is integer, bigint or exact rational, with no floating-point comparisons. Rounding happens only at display. The building height is measured from the **lowest storey floor in the model**: the model has no ground or road level, so `statutoryHeight` is always `NOT_EVALUATED`. No height category (for example "high-rise" or "supertall") is assigned. Such categories depend on a measurement basis and a definition that the model and verified sources do not provide.

Exact findings compare caller-declared targets (`declared.heightMm ± heightToleranceMm`, `declared.storeys`) with the model and report `PASS`/`FAIL`. The floors stated in the current project brief (B33) are compared as `WARNING`, because the brief is user-stated and may count basements differently.

## 5. Inputs: declared, never verified

The request body adds user-declared context. Each item is reported back under `context.provenance: USER_DECLARED_NOT_VERIFIED`. Missing data is never filled with defaults.

- `jurisdiction { country (ISO 3166-1 alpha-2), subdivision?, locality? }`. It is never inferred from the brief's free-text address.
- `occupancy.primary` and `structuralSystem { primaryMaterial, description? }`.
- `evidence[] { kind, referenceId? | citation? }`. A `referenceId` must be a live (non-deleted) Phase 31 reference **of this project**; otherwise the request fails with `422 ASSESSMENT_EVIDENCE_NOT_FOUND`, including for another user's reference. Evidence contents are never read or interpreted (`contentInterpreted: false`). Evidence only records that a document was declared.
- `declared { heightMm?, heightToleranceMm, storeys? }`, `scope[]` (a subset of domains) and `cost` (§7).

Reused context: the B33 current brief (version, hash, `program.floors`); the B34 revision loader, which applies ownership through RLS and the model-hash identity check; and the B24, B26 and B27 per-revision status reads. Those reads appear as `relatedServices` with their artifact counts, so a user can see, for example, that a Phase 24 frame analysis exists but does not establish drift.

## 6. Sources: identification only, fail closed

`engineering/sources.ts` is a candidate registry (`engineering-source-registry-v1`). It currently names only Indian documents by designation and issuer: IS 875 Parts 1–3, IS 1893 Part 1, IS 16700 and the National Building Code of India, all from the Bureau of Indian Standards. Every entry is:

`verificationStatus: NOT_VERIFIED`, `permittedUse: IDENTIFICATION_ONLY`, `edition: null`, `effectiveDate: null`, `amendmentStatus: UNKNOWN`, `url: null`, `retrievedOn: null`.

None of these documents was retrieved, read or checked for edition, amendment or applicability. No value from any of them is used. Editions are deliberately absent, because naming one would assert a currency nobody has checked. A domain that depends on one is `REQUIRES_SOURCE_VERIFICATION` with `CANDIDATE_SOURCE_NOT_VERIFIED`. For any other country, no source is borrowed: the blocker is `GOVERNING_SOURCE_NOT_IDENTIFIED`. When no jurisdiction is declared, the same code says the source depends on it. State and local development control rules may govern instead of national documents, and the registry says this.

Verified source ingestion (retrieved text, extracted and reviewed requirements, deterministic checks against them) belongs to the knowledge-pack mechanism of Phase 27 and later phases. It is out of scope here.

## 7. Conceptual cost (`conceptual-cost-v1`)

`cost { currency, priceBasisDate?, components[], adjustments[], excludedScopes[] }`:

- **Component**: `scope` (one of nine elemental scopes, or `WHOLE_BUILDING`) × `basis` (`GROSS_FLOOR_AREA_M2`, `GROSS_VOLUME_M3`, `PLOT_AREA_M2`, `STOREY_COUNT`, `LUMP_SUM`) × `rate`. The rate is an exact decimal with at most 12 integer and 6 fractional digits. Each component also declares `includes { gst, overheadAndProfit }` as `INCLUDED | EXCLUDED | UNKNOWN`, and a `source`.
- **Source**: `kind` is one of `OFFICIAL_SCHEDULE`, `CONTRACTOR_QUOTATION`, `USER_SUPPLIED`, `MARKET_BENCHMARK`, `THIRD_PARTY_CALCULATOR` or `SYNTHETIC`. It also carries title, issuer, reference, jurisdiction and effective or retrieval date. It is echoed back with an `evidenceClass` and `verification: NOT_VERIFIED_BY_BACKEND`. An "official schedule" is reported as `USER_ASSERTED_OFFICIAL_SCHEDULE`, because the backend has not inspected it.
- **Adjustment**: category (`GST`, `OVERHEAD`, `PROFIT`, `ESCALATION`, `LOCATION_INDEX`, `CONTINGENCY` or `OTHER`), `PERCENT` or `FIXED`, `ADD` or `DEDUCT`, applied to `BASE` or `RUNNING` in a unique `order`, each with its own source.

**Rejected lines.** A rejected line is never priced, and the estimate becomes `PARTIAL`:
- `RATE_JURISDICTION_MISMATCH`: the rate's jurisdiction differs from the site's. For example, a US cost-book rate is never applied in India.
- `OFFICIAL_SOURCE_METADATA_INCOMPLETE`: an official schedule without issuer, reference and effective date.
- `QUANTITY_NOT_AVAILABLE`: for example, a volume basis when the volume is undetermined.

**Blocked estimate.** The status is `BLOCKED`, and no subtotal, adjustment or total is returned:
- `GST_DOUBLE_COUNT_RISK`: a GST adjustment while any priced rate includes GST or does not say whether it does.
- `OVERHEAD_PROFIT_DOUBLE_COUNT_RISK`: the same rule for overhead and profit.
- `DUPLICATE_ADJUSTMENT_CATEGORY`: two adjustments of a single-use category.
- `SCOPE_OVERLAP_WHOLE_BUILDING`: a whole-building rate alongside elemental rates.
- `NOTHING_PRICED`.
- `NEGATIVE_TOTAL`.

**Complete total.** `completeTotal` is returned only when all of these hold: no line is rejected; every elemental scope is priced or explicitly excluded with a reason; a jurisdiction is declared; every priced rate and every adjustment states its own jurisdiction and an effective or retrieval date (otherwise its applicability to the site is unestablished, so it is reported as the requirement `cost.*.source.jurisdiction` or `cost.*.source.effectiveDate`); the GST basis is consistent (`INCLUSIVE_OF_GST`, `EXCLUSIVE_OF_GST` or `GST_ADDED_BY_ADJUSTMENT`); and every overhead and profit treatment is known. Otherwise the result is `PARTIAL`: it has a `pricedTotal`, lists unpriced scopes, and `completeTotal` is `null`.

**Money.** Amounts round half-up to two minor digits per line and per adjustment, using the Phase 15 rule. Exact fractions are returned alongside.

**Warnings.** Warnings cover synthetic rates, non-authoritative rates, undated rates, rates with no stated jurisdiction, envelope-based area bases and a missing contingency.

**India safeguards.** No rate, index, location factor or GST factor is built in. A foreign rate cannot reach a complete total by leaving its jurisdiction unstated: it is then priced only as part of a `PARTIAL` estimate. The CPWD-related `0.973` factor from the research brief is **not** implemented: its source and scope were not available to verify. A caller can still express any such factor as an explicitly sourced adjustment. RSMeans or other foreign cost books are rejected by the jurisdiction rule when the site is in India.

The estimate is `CONCEPTUAL_PARAMETRIC`. Its `claims` (tender, contractor quotation, bill of quantities, final budget, official rate verification) are all `NOT_CLAIMED`.

## 8. Evidence and audit

Each report carries the following:
- `engine`: assessment version, verifier version, source-registry version and formula ids.
- `inputHash`: the canonical hash of the model hash, the verifier input hash, the declared context, the normalized request, the resolved evidence and the related-service counts.
- `resultHash`: the canonical hash of the whole report except `generatedAt` and itself.
- `generatedAt`.

The same revision and request always give the same two hashes. Raw inputs are not logged, and nothing is persisted. Persisting assessments as evidence packages is Phase 38 work, as the Phase 34 design already assigns.

## 9. Resource limits

The request body is limited to 64 KiB, with at most 16 evidence items, 64 cost components, 16 adjustments and 16 excluded scopes. The model is bounded by the Building Model V2 schema (256 levels, 4 096 slabs and so on) and by the Phase 34 operation budget (2 000 000 cell operations). Beyond that budget, checks become `NOT_EVALUATED`, never guesses. Everything else in B35 is linear or O(n²) in hull vertices (≤ 256).

A 163-storey, 834.56 m concept is assessed in about 70 ms in process, and a stored one in about 2 s over HTTP, including saving the revision. The assessment therefore runs in the request. A durable job (Phase 32) would only add latency and state, so none is used. No external compute, paid service or model is required.

## 10. AI

None is used. Every number comes from the deterministic code above. The assessment works with no AI provider configured. AI-assisted extraction of these inputs from natural language, and explanation of blockers, are deferred. Any such feature must go through the same request schema and validation, and must never override declared values or results.

## 11. API

See [phase35-api.md](phase35-api.md). There are two routes, `GET` and `POST` at `/api/projects/:projectId/revisions/:revisionId/engineering-assessment`. The route catalog grows from 123 to 125 entries. Discovery advertises `ENGINEERING_ASSESSMENT` (`DERIVED_ON_READ`).

## 12. Out of scope and deferred

| Item | Phase |
|---|---|
| Validated external structural, wind or seismic solvers behind a compute gateway | B36 |
| Cross-discipline dependency graph and freshness propagation of assessments | B37 |
| Persisting assessments as signed evidence packages; exports | B38 |
| Verified, ingested standards and their extracted, reviewed requirements | Knowledge packs (B27 mechanism), later phases |
| Official rate-book ingestion (CPWD/state PWD schedules) with verified provenance | Later cost work |
| AI-assisted input extraction and explanation | B39/B43 provider work |
| Frontend Phase 35 calculation workspace integration | Deferred: not part of this backend phase |

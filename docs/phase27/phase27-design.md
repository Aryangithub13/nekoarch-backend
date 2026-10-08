# Phase 27 design — Specialized Architectural Knowledge & Engineering Intelligence V1

Status: **DESIGN APPROVED WITH AMENDMENTS 1–5 (2026-10-07) — IMPLEMENTATION IN PROGRESS.** This document is the normative specification. The golden acceptance table (§22) and the truth table (§8) are part of it. Where code and this document disagree, the code is wrong.

Baseline: `4d1f431` (`backend-v1-phase26-complete`), branch `phase27/specialized-knowledge`. The source facts used below come from [phase27-source-audit.md](phase27-source-audit.md).

Approved decisions this design implements:

| Decision | Ruling |
|---|---|
| D1 | Only **bundled** packs in V1. The format can describe external packs, but ingesting them is **DEFERRED**. |
| D2 | COST facts are UNSUPPORTED. |
| D3 | Rules in a conflict get `CONFLICTING_RULES`; nothing picks a winner. |
| D4 | The catalog requires authentication. |
| D5 | A label near-match returns `REVIEW_REQUIRED`. |
| Operator cut | NOT_EXISTS, NOT_EQUAL, BETWEEN and CONDITIONAL are expressed by composition. |
| Literals | Thresholds are canonical decimal strings. |
| Preflight | Size, count and depth limits run before parsing or recursion. |
| Oracle | The golden table is fixed before any code. |
| Truth table | One normative table, implemented twice independently. |
| Validator independence | Separate arithmetic, plus mutation-proven sharing where sharing is unavoidable. |
| Conflicts | Bounded; `NOT_EVALUATED` when the detector cannot decide. |
| Precision | Mixed-precision facts keep their provenance. |
| Usefulness | The golden run must produce meaningful results. |
| Claims | The NOT_CLAIMED block is mandatory. |
| Amendment 1 | `ANY` stays a first-class combinator: the documented exception to irreducibility, proven equal to `NOT(ALL(NOT…))` exhaustively in both implementations. |
| Amendment 2 | `UPSTREAM_FLOAT` comparisons use the deterministic ULP boundary policy (§10.1). Inside the band the result is `REVIEW_REQUIRED` with reason `FLOAT_BOUNDARY_AMBIGUITY`. |
| Amendment 3 | The near-match case moves to a test-only pack that is not in the catalog. Both bundled packs stay coherent. |
| Amendment 4 | `TRANSITIVE_UPSTREAM_BINDING_CONSISTENCY` is a required invariant (§14.1) with a typed 422. |
| Amendment 5 | Limits stay provisional until benchmarked, then are frozen and re-tested. |

---

## 1. Scope in one paragraph

Phase 27 takes the accepted architectural revision, plus up to three upstream analyses that the caller names explicitly (Phases 24, 25 and 26). From those it extracts a typed, provenance-carrying **fact set**. It then evaluates the rules of the bundled **knowledge packs** the caller selected, using a small declarative predicate language and exact rational arithmetic. It detects contradictions between selected rules within a stated bound. An **independent** validator recomputes the facts and every result. The output is persisted as an immutable, revision-bound advisory snapshot.

A Phase 27 result means only this: *given this explicit rule definition, these authoritative project facts and this exact evaluation engine version, the predicate evaluated this way.* It is not compliance, certification or professional judgement. No LLM is used, and no network access is needed.

## 2. Trust model and pipeline

```
POST /knowledge/analyses
 ├─ preflight: bounded(body, inputBytes) → zod strict input
 ├─ readBim(projectId, revisionId)                       accepted QA, recomputed modelHash (Phase 23, reused)
 ├─ read explicitly named upstream analyses               revision-scoped RPC reads; never "latest"
 │   └─ consistency: systems.binding.structural/environmental must equal the bound ids when both are present
 ├─ resolve packs from the bundled registry               packId+version → pack, checksum verified (§14)
 ├─ facts = extractFacts(bim, upstream)                  facts.ts            (UNTRUSTED)
 ├─ validateKnowledgeModel(facts, bim, upstream, binding) validate.ts        (independent re-derivation)
 ├─ draft = evaluate(packs, facts, input)                evaluate.ts + conflicts.ts (UNTRUSTED)
 ├─ validateKnowledgeResults(draft, packs, facts)        validate.ts         (independent recomputation)
 ├─ SnapshotSchema.parse → outputBytes budget
 └─ signed SECURITY DEFINER knowledge_write              SQL recomputes binding, upstream rows, pack checksums
```

GET routes only read rows and never compute.

## 3. Version literals

| Literal | Meaning |
|---|---|
| `specialized-knowledge-input-v1` | request contract (§4) |
| `specialized-knowledge-model-v1` | binding + fact-set envelope |
| `specialized-knowledge-analysis-v1` | persisted snapshot (§15) |
| `project-facts-v1` | fact schema + V1 fact catalog (§9) |
| `knowledge-pack-v1` | pack schema (§5) |
| `knowledge-rule-v1` | rule + predicate AST (§5–6) |
| `knowledge-rule-evaluator-v1` | evaluation semantics: §7, §8, §11, §12 |
| `knowledge-conflict-detector-v1` | conflict semantics (§13) |
| `specialized-knowledge-validator-v1` | independent fact/model validator |
| `specialized-knowledge-result-validator-v1` | independent result validator |
| `knowledge-units-v1` | the bounded unit table (§11) |

Any change in meaning requires a new literal. The evaluator identity is persisted as `{ name: 'nekoarch-knowledge-evaluator', version: '1.0.0' }`.

## 4. Input contract — `specialized-knowledge-input-v1`

```jsonc
{
  "version": "specialized-knowledge-input-v1",
  "packs": [ { "packId": "nekoarch-demo-dimensional", "version": "1.0.0" } ],   // 1..8, unique by packId
  "sources": {                                                                  // all default null
    "structuralAnalysisId": "uuid|null",
    "environmentalAnalysisId": "uuid|null",
    "systemsAnalysisId": "uuid|null"
  },
  "scope": { "disciplines": ["ARCHITECTURE", "LIFE_SAFETY"] }                    // 1..8, unique
}
```

- All objects are `.strict()`, so an unknown field returns **400**.
- `packId` matches `^[a-z0-9][a-z0-9-]{2,63}$`, and `version` matches `^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$`.
- There is no pack body, inline rule or expected checksum in V1 (D1).
- Disciplines are `ARCHITECTURE, STRUCTURAL, ENVIRONMENTAL, MEP, LIFE_SAFETY, VERTICAL_TRANSPORT, QUANTITY, COST`.
- A rule is **selected** iff its pack is selected and its `discipline` is in `scope.disciplines`. Unselected rules produce no result. The `packs[]` summary still counts them.
- An unknown `packId`/`version` pair returns **422 `KNOWLEDGE_PACK_UNKNOWN`**. Jurisdiction is never inferred. There is no default pack, and a list with no packs fails the schema.
- Canonicalisation for hashing: `packs` sorted by `packId`, and `disciplines` sorted by code unit.

## 5. Knowledge pack schema — `knowledge-pack-v1`

```jsonc
{
  "format": "knowledge-pack-v1",
  "packId": "nekoarch-demo-dimensional",
  "version": "1.0.0",
  "title": "…",                                   // ≤ 200
  "disciplines": ["ARCHITECTURE", "LIFE_SAFETY", "VERTICAL_TRANSPORT"],
  "publisher": { "name": "NekoArch (project-authored)", "kind": "PROJECT_AUTHORED" },
                                                  // kind: PROJECT_AUTHORED | ORGANIZATION | STANDARDS_BODY | AUTHORITY | OTHER
  "jurisdiction": null,                           // or { "code": "…", "name": "…" }; never inferred, demo packs are null
  "edition": "demo-2026-10",
  "effectiveDate": null,                          // ISO date or null
  "sourceType": "SYNTHETIC_DEMONSTRATION",        // | OPEN_LICENSED | ORGANIZATION_POLICY | LICENSED_REFERENCE
  "license": { "spdx": "CC0-1.0", "redistribution": "PERMITTED" },   // | RESTRICTED | UNKNOWN
  "sourceReferences": [ { "refId": "demo-a", "title": "…", "uri": null, "note": "…" } ],     // ≤ 32
  "provenance": { "authoredBy": "NekoArch Phase 27", "method": "HAND_AUTHORED_SYNTHETIC" },
  "rules": [ /* knowledge-rule-v1, 1..256, unique ruleId */ ]
}
```

### Rule — `knowledge-rule-v1`

```jsonc
{
  "ruleId": "a01-door-width-min",                 // ^[a-z0-9][a-z0-9-]{2,63}$
  "version": "1",
  "title": "…",                                   // ≤ 200
  "discipline": "ARCHITECTURE",
  "severity": "WARNING",                          // INFO | WARNING | ERROR (same enum as blueprint-qa)
  "advisory": true,                               // literal true: no V1 rule is a certification
  "reviewDiscipline": null,                       // a Discipline whose professional review the rule recommends, or null
  "scope": { "kind": "OPENING", "labels": ["door"] },   // labels: exact canonical labels, or null = every subject of kind
  "applicability": null,                          // Predicate | null (null = always applicable to scoped subjects)
  "requirement": { "op": "GTE", "left": { "fact": { "factType": "ARCH_OPENING_WIDTH" } }, "right": { "decimal": "900", "unit": "mm" } },
  "requiredFacts": [ { "factType": "ARCH_OPENING_WIDTH", "parameter": null } ],
  "semantics": { "meets": "Opening width is at least the stated minimum.", "doesNotMeet": "Opening width is below the stated minimum." },
  "sourceReference": { "refId": "demo-a", "locator": "DEMO-A-01", "interpretation": "Synthetic threshold for demonstration; not a regulation." },
  "limitations": ["DOOR_CLEAR_WIDTH_NOT_MODELLED"]   // declared unsupported conditions, ≤ 8 codes
}
```

Pack invariants are checked when the module loads and again in tests. A failing bundled pack is a **build defect**: the module refuses to register it, and the unit gate fails.

1. **Preflight** runs before parsing, on the raw JSON:
   - `bounded(pack, PACK_LIMITS.packBytes)` checks plain JSON, depth ≤ 24 and the node budget;
   - `rules.length ≤ 256`.
2. **Decimal literals** are strings that match `^-?(0|[1-9]\d{0,19})(\.\d{0,19}[1-9])?$`. That form is canonical: no exponent, no `+`, no leading zeros, no trailing fractional zeros. `-0` is rejected. **No JSON number appears anywhere in a pack.**
3. **AST shape**:
   - predicate depth is ≤ 8;
   - nodes per rule are ≤ 64, counted over requirement and applicability;
   - `ALL`/`ANY` take 2..16 children.
   These are checked iteratively before any recursive evaluation.
4. **Fact references**:
   - `requiredFacts` must equal exactly the set of `(factType, parameter)` referenced in `applicability ∪ requirement`;
   - each referenced fact must be defined for `scope.kind`, or be a `BUILDING` fact;
   - `parameter` must be valid for the fact type (§9).
5. **Literal types**:
   - a numeric literal's unit must have the fact's dimension (§11);
   - `EQUALS` values must be in the fact's categorical domain.
6. **References and labels**:
   - `sourceReference.refId` must exist in `sourceReferences`;
   - labels are 1..200 chars, ≤ 32 per selector, unique, and stored verbatim.
7. **Copyright**: packs carry identifiers, thresholds and ≤ 300-char interpretations only. No source text is reproduced.

## 6. Operator inventory (primitives) and irreducibility

V1 has **7 predicate primitive families (8 operators: EXISTS, EQUALS, GTE, LTE, ALL, ANY, NOT, MANUAL_REVIEW)** and **3 operand forms**. Nothing else exists. There are no aliases, no property paths, no expressions and no regexes.

### Predicates

| # | Primitive | Shape | Why it is irreducible |
|---|---|---|---|
| P1 | `EXISTS` | `{op, fact}` | It is the only primitive that maps an **absent** fact to a definite truth value. Every comparison maps absence to `INPUT_INCOMPLETE` (§7), so no composition of the others can produce `DOES_NOT_MEET` from absence. |
| P2 | `EQUALS` | `{op, fact, value: string \| boolean}` | Categorical facts (enum, boolean) have no order, so `GTE`/`LTE` don't apply. `EQUALS` is **rejected on numeric facts**: there numeric equality is `ALL(GTE, LTE)`, and allowing both would be an alias. |
| P3 | `GTE` | `{op, left: Operand, right: Literal}` | The operand order is fixed: value expression on the left, literal on the right. `x ≥ t` can't be built from `LTE` (`NOT(LTE(x,t))` is `x > t`, which is strict). |
| P4 | `LTE` | same | Symmetric argument: `NOT(GTE(x,t))` is `x < t`, which is strict. |
| P5 | `ALL` / `ANY` | `{op, of: Predicate[2..16]}` | Kleene conjunction and disjunction over the status lattice (§8). They can't be built from P1–P4 or NOT alone. Each is De Morgan's dual of the other through NOT, but both are kept, because writing `ANY` as `NOT(ALL(NOT…))` triples the node count. **This is the single deliberate exception, made for bounded AST size.** Both are listed as one primitive family. **Amendment 1:** `ANY` is the single approved exception to the irreducibility rule. Tests prove `ANY(c₁…cₙ) = NOT(ALL(NOT c₁ … NOT cₙ))` for every status combination with n = 2..4 over {T, F, R, I, E}, in the evaluator and in the validator, and each implements `ANY` independently. |
| P6 | `NOT` | `{op, of: Predicate}` | It is the only primitive that negates a definite outcome while letting unknowns pass through unchanged. |
| P7 | `MANUAL_REVIEW` | `{op, reason ≤ 200}` | It is the only primitive whose outcome is unconditionally `REVIEW_REQUIRED`. No fact-based primitive can produce that without a near-match. |

### Operand forms (the left side of GTE/LTE)

| # | Operand | Meaning | Why it is irreducible |
|---|---|---|---|
| O1 | `{fact: FactRef}` | Value of the fact on the current subject, or on the building for BUILDING facts. | Base case. |
| O2 | `{count: {kind, labels \| null}}` | Number of subjects of `kind` whose label is exactly in `labels`, or all subjects of `kind` when `labels` is null. A near-match on any counted subject makes the operand `REVIEW_REQUIRED`. | It is the only quantifier over subjects. Facts are per subject, so no fact can express "how many subjects match". |
| O3 | `{ratio: {numerator: FactRef, denominator: FactRef}}` | Exact rational `n/d`, valid only when both facts have the **same dimension**. The result is unitless (`1`). A zero denominator gives `NOT_EVALUATED` (reason `RATIO_ZERO_DENOMINATOR`). | `n/d ≥ t` can't be written with P3/P4 over single facts, because there is no fact-vs-scaled-fact comparison. |

**Removed by composition (approved cut).** Pack authors write these forms. The engine has no shortcut for them.

| Wanted | Written as |
|---|---|
| NOT_EXISTS(f) | `NOT(EXISTS f)` |
| NOT_EQUAL(f,v) | `NOT(EQUALS f v)` |
| BETWEEN(x,a,b) | `ALL(GTE x a, LTE x b)` |
| x > t | `NOT(LTE x t)` |
| x < t | `NOT(GTE x t)` |
| CONDITIONAL(c ⇒ p) | Rule-level `applicability: c` (the normal form). Inside a predicate, `ANY(NOT c, p)` (material implication). |
| SOURCE_STATUS, BOOLEAN | `EQUALS` over the categorical status or boolean fact |
| GEOMETRIC_WIDTH / DISTANCE / CLEARANCE, REACHABILITY | Fact types (§9) compared with P2–P4. Phase 27 adds **no geometry engine**. |
| COUNT / MINIMUM_COUNT / MAXIMUM_COUNT | `GTE`/`LTE` over operand O2 |
| RANGE | `BETWEEN` (above) |

Every primitive is implemented **twice**, in `evaluate.ts` and in `validate.ts`, from this section and §8 alone. Each gets equality, one-under and one-over boundary tests plus a mutation (§23).

## 7. Result statuses and the rule pipeline

| Status | Meaning (normative) |
|---|---|
| `MEETS_RULE` | Applicable; the requirement predicate evaluated to true over present facts. |
| `DOES_NOT_MEET_RULE` | Applicable; the requirement predicate evaluated to false. |
| `NOT_APPLICABLE` | No subject matched the scope, or the applicability predicate evaluated to false for this subject. |
| `NOT_EVALUATED` | A required upstream source isn't bound, or a ratio had a zero denominator. The engine didn't evaluate. |
| `INPUT_INCOMPLETE` | The source is bound, but a required fact is absent for this subject (for example `headroomMm` not modelled, or electrical demand not evaluated upstream). |
| `UNSUPPORTED` | The rule references a fact type that V1 can't provide (§9 `supported: false`). This is decided statically, before evaluation. |
| `REVIEW_REQUIRED` | A label near-match (§12), or `MANUAL_REVIEW`. A human must decide. |
| `CONFLICTING_RULES` | The rule is in a detected conflict (§13). The isolated outcome is kept in `isolatedStatus` and is **never promoted**. |

Per selected rule, in this exact order:

1. **Static support.** If any `requiredFacts` type has `supported: false`, emit **one** result (`subject: null`) with status `UNSUPPORTED`, and stop.
2. **Static source.** If any required fact's source domain (§9) is not bound, emit **one** result (`subject: null`) with status `NOT_EVALUATED`. Add `missingInputs += {kind: 'SOURCE', source}`, and stop. This is conservative: a disjunction is never partly evaluated over a missing source.
3. **Subjects.** Enumerate the subjects of `scope.kind` in canonical id order.
   - Exact label match makes the subject **in scope**.
   - A near-match (§12) makes it a `REVIEW_REQUIRED` subject result, with the near-match evidence.
   - If nothing is in scope and there is no near-match, emit one `NOT_APPLICABLE` result (`subject: null`).
   - `BUILDING` scope has exactly one subject, `building`.
4. **Applicability** (per in-scope subject):
   - true: go to step 5;
   - false: `NOT_APPLICABLE`;
   - unknown: the subject gets that unknown status, with `applicability.status = 'UNDETERMINED'`.
5. **Requirement:** the predicate status, by §8.
6. **Conflicts:** for rules in a detected conflict, every subject result whose isolated status is `MEETS_RULE`, `DOES_NOT_MEET_RULE`, `INPUT_INCOMPLETE` or `REVIEW_REQUIRED` becomes `CONFLICTING_RULES`, with `isolatedStatus` kept.
7. **Review flag:** `reviewRequired = true` iff the status is `REVIEW_REQUIRED` or `CONFLICTING_RULES`, or the rule declares `reviewDiscipline` and the status is `MEETS_RULE` or `DOES_NOT_MEET_RULE`.

Evaluating a leaf:

- A comparison (P2–P4) over an absent fact, or a fact that has no instance on the subject, gives `INPUT_INCOMPLETE`.
- `EXISTS` over a present fact gives `MEETS_RULE`. Over an absent fact, or one with no instance, it gives `DOES_NOT_MEET_RULE`.

A missing fact can never become a pass.

## 8. Normative status algebra (ALL / ANY / NOT)

Predicate-level statuses are written as follows.

| Symbol | Status | Kind |
|---|---|---|
| **T** | MEETS_RULE | definite |
| **F** | DOES_NOT_MEET_RULE | definite |
| **R** | REVIEW_REQUIRED | unknown |
| **I** | INPUT_INCOMPLETE | unknown |
| **E** | NOT_EVALUATED | unknown |

`UNSUPPORTED`, `NOT_APPLICABLE` and `CONFLICTING_RULES` never occur *inside* a predicate (§7 steps 1, 3, 4, 6).

Unknown precedence, strongest first: **E > I > R**. The reason is the action the user must take: supply a source, then supply data, then review.

**NOT**

| x | NOT x |
|---|---|
| T | F |
| F | T |
| R | R |
| I | I |
| E | E |

**ALL** (binary; n-ary is left-fold, and the operation is associative and commutative)

| ALL | T | F | R | I | E |
|---|---|---|---|---|---|
| **T** | T | F | R | I | E |
| **F** | F | F | F | F | F |
| **R** | R | F | R | I | E |
| **I** | I | F | I | I | E |
| **E** | E | F | E | E | E |

**ANY**

| ANY | T | F | R | I | E |
|---|---|---|---|---|---|
| **T** | T | T | T | T | T |
| **F** | T | F | R | I | E |
| **R** | T | R | R | I | E |
| **I** | T | I | I | I | E |
| **E** | T | E | E | E | E |

Properties required by tests, checked exhaustively over all 5³ triples in both implementations:

- De Morgan: `NOT(ALL(a,b)) = ANY(NOT a, NOT b)`.
- Associativity and commutativity.
- `ALL(T, x) = x`.
- `ANY(F, x) = x`.

A definite F dominates ALL, and a definite T dominates ANY (strong Kleene). This is sound: one false conjunct makes the conjunction false whatever the unknowns are. An unknown never becomes T inside ALL.

## 9. Project fact schema — `project-facts-v1`

```jsonc
{
  "factId": "fact-<40 hex>",          // sha256([factType, parameter, subject.kind, subject.id]) prefix
  "factType": "SYS_EGRESS_DISTANCE",
  "parameter": null,                  // e.g. takeoff itemCode for QUANTITY_TOTAL
  "subject": { "kind": "SPACE", "id": "space-bedroom-1", "label": "bedroom" },
  "status": "PRESENT",                // PRESENT | ABSENT (ABSENT ⇒ value null; makes missing inputs explicit)
  "value": { "kind": "DECIMAL", "exact": "43900", "unit": "mm" },
                                      // | { kind: "ENUM", value } | { kind: "BOOLEAN", value } | null
  "precision": "UPSTREAM_FLOAT",      // §10
  "source": {
    "artifactType": "SYSTEMS_ANALYSIS",   // ARCHITECTURE_REVISION | BIM_QUANTITY_TAKEOFF | STRUCTURAL_ANALYSIS | ENVIRONMENTAL_ANALYSIS | SYSTEMS_ANALYSIS
    "artifactId": "<analysis uuid | revision uuid>",
    "revisionId": "<uuid>", "modelHash": "<64 hex>",
    "engineVersion": "building-systems-analysis-v1",
    "inputHash": "<64 hex | null>",
    "pointer": "/results/lifeSafety/spaces/2/distance/value"     // RFC 6901 into the source artifact
  },
  "derivation": { "method": "DIRECT", "inputs": [] }      // DIRECT | COUNT | MAX | DIFFERENCE | POLYGON_AREA | SUM | BOUNDS_EXTENT; inputs: pointers ≤ 16
}
```

- Facts are sorted by `factId`. Each fact names exactly one `source.pointer`; derived facts also list their input pointers. This answers "where did this number come from?" without an LLM.
- **Subject kinds (9):** `BUILDING, LEVEL, SPACE, OPENING, STAIR, STRUCTURAL_MEMBER, MEP_NETWORK, ELEVATOR, THERMAL_CASE`.
- **Subject labels** used by selectors and near-match:
  - SPACE: `classification`;
  - OPENING: `kind`;
  - STRUCTURAL_MEMBER: `kind`;
  - MEP_NETWORK: `system`;
  - all other kinds: `null`.

### V1 fact catalog

`absent` says what absence means:

- `ABSENT`: the fact is emitted as `status: ABSENT` and gives `INPUT_INCOMPLETE`.
- `NOT_EMITTED`: there is no fact for the subject. `EXISTS` is false; comparisons give `INPUT_INCOMPLETE`.

| factType | Subject | Value / unit | Precision | Source → pointer (derivation) | absent |
|---|---|---|---|---|---|
| `ARCH_STOREY_COUNT` | BUILDING | count | EXACT_INTEGER | geometry levels where `kind = storey` (COUNT) | — |
| `ARCH_BUILDING_HEIGHT` | BUILDING | mm | EXACT_INTEGER | max(storey `elevationMm + floorToFloorHeightMm`) − min(storey `elevationMm`) (DIFFERENCE) | ABSENT if any storey floor-to-floor is null |
| `ARCH_LEVEL_ELEVATION` | LEVEL | mm | EXACT_INTEGER | `levels[i].elevationMm` | — |
| `ARCH_FLOOR_TO_FLOOR_HEIGHT` | LEVEL | mm | EXACT_INTEGER | `levels[i].floorToFloorHeightMm` | ABSENT when null |
| `ARCH_SPACE_AREA` | SPACE | mm2 | EXACT_DECIMAL_STRING | `polygonAreaMm2(boundary)` (POLYGON_AREA) | — |
| `ARCH_SPACE_WINDOW_AREA` | SPACE | mm2 | EXACT_INTEGER | Σ `widthMm × heightMm` of windows whose host wall's explicit `spaceIds` contains the space (SUM) | ABSENT if any wall bounding the space lacks `spaceIds` |
| `ARCH_SPACE_OCCUPANCY` | SPACE | count | EXACT_INTEGER | `spaces[i].occupancy` | ABSENT (generated models carry none) |
| `ARCH_OPENING_WIDTH` / `_HEIGHT` / `_SILL` | OPENING | mm | EXACT_INTEGER | `openings[i].widthMm` / `heightMm` / `sillMm` | — |
| `ARCH_OPENING_IS_SITE_ENTRY` | OPENING | boolean | CATEGORICAL | `site.primaryEntryOpeningId === id` | — |
| `ARCH_STAIR_WIDTH` / `_TREAD_DEPTH` | STAIR | mm | EXACT_INTEGER | `stairs[i].widthMm` / `treadDepthMm` | — |
| `ARCH_STAIR_MAX_RISER` | STAIR | mm | EXACT_INTEGER | max(`riserHeightsMm`) (MAX) | — |
| `ARCH_STAIR_RISER_COUNT` | STAIR | count | EXACT_INTEGER | `riserHeightsMm.length` (COUNT) | — |
| `ARCH_STAIR_HEADROOM` | STAIR | mm | EXACT_INTEGER | `stairs[i].headroomMm` | ABSENT when unset |
| `QUANTITY_TOTAL` (parameter = takeoff `itemCode`) | BUILDING | takeoff unit (mm, mm2, mm3, count) | EXACT_DECIMAL_STRING | `bim.quantities.summary.totals[k].quantity.value` | ABSENT if the total's status ≠ EVALUATED |
| `STRUCT_SECTION_WIDTH` / `_DEPTH` | STRUCTURAL_MEMBER | mm | UPSTREAM_FLOAT | `model.sections[s].dimensions.width/depth.value` | ABSENT for GENERIC sections |
| `STRUCT_MEMBER_LENGTH` | STRUCTURAL_MEMBER | mm | UPSTREAM_FLOAT | `model.members[i].quantities.length.value` | — |
| `ENV_ZONE_FLOOR_AREA` | SPACE | m2 | UPSTREAM_FLOAT | `model.zones[z].floorArea.value` (zone `source.id` = space) | NOT_EMITTED for spaces without a zone |
| `ENV_WINDOW_TO_FLOOR_RATIO` | SPACE | 1 | UPSTREAM_FLOAT | `results.daylightIndicator.zones[z].ratio.value` | NOT_EMITTED |
| `ENV_ENVELOPE_STATUS` | BUILDING | enum CLOSED/INCOMPLETE | CATEGORICAL | `model.envelope.status` | — |
| `ENV_TRANSMISSION_TOTAL` | THERMAL_CASE | W | UPSTREAM_FLOAT | `results.thermal.cases[c].total.value` | ABSENT if case status ≠ ANALYZED |
| `SYS_EGRESS_DISTANCE` | SPACE | mm | UPSTREAM_FLOAT | `results.lifeSafety.spaces[k].distance.value` | ABSENT when null |
| `SYS_EGRESS_REACHABLE` | SPACE | boolean | CATEGORICAL | `…spaces[k].reachable` | NOT_EMITTED |
| `SYS_DISTINCT_EXITS_REACHABLE` | SPACE | count | EXACT_INTEGER | `…spaces[k].distinctExitsReachable` | NOT_EMITTED |
| `SYS_DEAD_END_LENGTH` | SPACE | mm | UPSTREAM_FLOAT | `results.lifeSafety.deadEnds[k].length.value` | NOT_EMITTED (no dead end) |
| `SYS_EGRESS_AVAILABLE` | BUILDING | boolean | CATEGORICAL | `results.lifeSafety.egressAvailable` | ABSENT when null |
| `SYS_PENETRATION_COUNT` / `SYS_BLOCKING_CLASH_COUNT` | BUILDING | count | EXACT_INTEGER | `coordination.penetrations.length` / `coordination.blocking` | — |
| `SYS_ELECTRICAL_CONNECTED_W` | BUILDING | W | EXACT_RATIONAL | `results.electrical.total.connected.W.exact` | ABSENT if `total` null |
| `SYS_ELECTRICAL_DEMAND_W` | BUILDING | W | EXACT_RATIONAL | `results.electrical.total.demand.W.exact` | ABSENT when demand NOT_EVALUATED |
| `SYS_NETWORK_STATUS` | MEP_NETWORK | enum (ROUTED, …) | CATEGORICAL | `results.networks[k].status` | — |
| `SYS_NETWORK_LENGTH` | MEP_NETWORK | mm | UPSTREAM_FLOAT | `results.networks[k].length.value` | — |
| `SYS_DRAINAGE_SLOPE` | MEP_NETWORK | 1 | EXACT_RATIONAL | `drainage.slope.rise / run` (integers) | NOT_EMITTED for non-drainage |
| `SYS_DUCT_MAX_VELOCITY` | MEP_NETWORK | m/s | EXACT_RATIONAL | max over `airflow.segments[*].velocity.exact` (MAX) | ABSENT if any segment velocity null |
| `SYS_ELEVATOR_STATUS` / `_VERTICAL_ACCESS` | ELEVATOR | enum | CATEGORICAL | `verticalTransport.elevators[k].status` / `.verticalAccess` | — |
| `SYS_ELEVATOR_DOOR_WIDTH` | ELEVATOR | mm | EXACT_INTEGER | `…elevators[k].door.widthMm` | — |
| `SYS_ELEVATOR_SHAFT_WIDTH` / `_DEPTH` | ELEVATOR | mm | EXACT_INTEGER | `shaft.maxX − minX` / `maxZ − minZ` (BOUNDS_EXTENT) | ABSENT if shaft null |
| **Declared, `supported: false`** | | | | | |
| `COST_TOTAL` | BUILDING | MONEY | — | COST UNSUPPORTED in V1 (D2) | — |
| `STRUCT_UTILISATION` | STRUCTURAL_MEMBER | 1 | — | no capacity check exists in Phase 24 | — |
| `ARCH_DOOR_CLEAR_WIDTH` | OPENING | mm | — | not modelled | — |
| `ARCH_FIRE_RATING` | OPENING | enum | — | not modelled | — |
| `SYS_OCCUPANT_LOAD` | SPACE | count | — | Phase 26 `NOT_EVALUATED` | — |

Additional rules:

- **Source domain** per prefix: `ARCH_` and `QUANTITY_` are architecture (always bound); `STRUCT_` is structural; `ENV_` is environmental; `SYS_` is systems. Elevator, network and thermal-case subjects exist only when their source is bound.
- **Per-source subjects** are keyed as follows:
  - MEP_NETWORK by network `key` (for example `SANITARY` or `HVAC_SUPPLY:sa`);
  - ELEVATOR by elevator `key`;
  - THERMAL_CASE by case `key`;
  - STRUCTURAL_MEMBER by member `requestKey`.
- Unsupported types are **in the schema on purpose**. Packs written against future capabilities then stay valid and report `UNSUPPORTED` honestly, instead of failing to parse.

## 10. Provenance and precision model

| precision | Origin | Example |
|---|---|---|
| `EXACT_INTEGER` | integer schema fields (`.int()`) and counts | door width 900 |
| `EXACT_DECIMAL_STRING` | exact decimal strings produced by the engines | space area `"84532500"` mm² |
| `EXACT_RATIONAL` | `exact` strings in `n/d` or decimal form, and integer ratios | duct velocity `"25/6"` m/s, slope `1/40` |
| `UPSTREAM_FLOAT` | a `z.number()` field that is **not** integer-constrained in the source schema | egress distance 43900, WFR `0.04961240310077519` |
| `CATEGORICAL` | enums and booleans | `CLOSED` |

Rules:

1. Precision is decided by the **source schema**, not by the value. An integral-looking double (`43900`) is still `UPSTREAM_FLOAT`.
2. An `UPSTREAM_FLOAT` value enters as the exact rational of its JSON decimal serialization (ECMAScript shortest round-trip, which is what was stored and is what `decimalRatio` reads). Phase 27 **never rounds, snaps, widens or narrows** it, and adds no tolerance. It can't be more precise than the stored artifact, and it says so.
3. A derived fact takes the weakest precision of its inputs (`UPSTREAM_FLOAT < EXACT_RATIONAL < EXACT_DECIMAL_STRING < EXACT_INTEGER`).
4. Every result reports `precision`, the weakest precision among the facts it observed.
5. An `UPSTREAM_FLOAT` comparison never decides a boundary on representation noise alone (§10.1).

### 10.1 Float representation-boundary policy — `knowledge-float-boundary-v1` (Amendment 2)

The policy applies to `GTE` / `LTE` whose left operand is a single `{fact}` with catalog precision `UPSTREAM_FLOAT`. `RATIO` operands may not reference `UPSTREAM_FLOAT` facts; this is a pack validation error (DEFERRED, §25). `COUNT` operands are always exact.

Definitions:

- **r**: the exact rational of the stored JSON decimal, unchanged (§10 rule 2).
- **f**: the exact factor from the fact's stored unit to its canonical unit (§11).
- **t**: the normalised threshold, in the canonical unit.
- **ulp(r)**: the IEEE-754 binary64 spacing at r, as an exact rational:
  - if r = 0, then ulp = 2⁻¹⁰⁷⁴;
  - otherwise let e = ⌊log₂|r|⌋, computed exactly over BigInt, and clamp it to e ≥ −1022 (the subnormal range). Then ulp = 2^(e−52).
- **K = 16**: `FLOAT_BOUNDARY_ULPS`, a version-locked constant. Sixteen binary64 spacings cover the shortest-decimal round-trip (½ ulp) plus the rounding accumulated by the short arithmetic chains of the Phase 24–26 engines (sums, products, unit scalings). The resulting relative width is ≤ 16·2⁻⁵² ≈ 3.6·10⁻¹⁵, so it never hides an engineering-scale difference. It is a count of representable spacings, not a domain percentage.

Algorithm (both implementations, written independently):

```
band = K · ulp(r) · f          (exact rational)
diff = |r · f − t|             (exact rational)
if diff ≤ band  → REVIEW_REQUIRED, reason FLOAT_BOUNDARY_AMBIGUITY
else            → the exact comparison r·f {≥|≤} t → MEETS_RULE / DOES_NOT_MEET_RULE
```

- The test is inclusive, so exact equality with a float fact is ambiguous by design.
- The raw value is never rounded or replaced. The trace exposes `observed.exact` (the raw value), `threshold.normalized`, `basis: { policy: 'knowledge-float-boundary-v1', ulps: 16, ulp: "<exact>", band: "<exact>", diff: "<exact>" }` and `reason`.
- `ulp` uses different BigInt methods in each implementation:
  - **evaluator:** iterative doubling and halving of a power-of-two rational against |r|;
  - **validator:** the bit-length difference of numerator and denominator, then one correction step.

Known-answer tests: stored `1.0000000000000033` against `"1"` is 14.9 ulp from the threshold, so inside the band. Stored `1.0000000000000038` against `"1"` is 17.1 ulp, so outside. Golden row B4: stored `6644.340000000001` W against 6644.34 W, with diff = 10⁻¹² W ≤ 16·2⁻⁴⁰ W, so `REVIEW_REQUIRED`.

## 11. Units and exact arithmetic — `knowledge-units-v1`

| Dimension | Units (exact factor to canonical) | Canonical |
|---|---|---|
| length | `mm` = 1, `m` = 1000 | mm |
| area | `mm2` = 1, `m2` = 10⁶ | mm2 |
| volume | `mm3` = 1, `m3` = 10⁹ | mm3 |
| power | `W` = 1, `kW` = 1000 | W |
| apparent power | `VA` = 1, `kVA` = 1000 | VA |
| flow | `L/s` = 1, `m3/s` = 1000 | L/s |
| velocity | `m/s` = 1 | m/s |
| ratio | `1` = 1, `%` = 1/100 | 1 |
| count | `count` = 1 | count |
| money | `MONEY` (no conversion; only COST_TOTAL, unsupported) | — |

- Each fact type has one canonical unit. A literal is normalised into the fact's canonical unit by multiplying by its exact factor.
- A literal whose unit is in a different dimension is a **pack validation error**, so it is caught at load and never reaches evaluation.
- Units are never inferred from locale, and there is no implicit unit.
- Arithmetic uses BigInt rationals throughout: `[n, d]` with `d > 0`, always reduced. Comparison is by cross-multiplication. No IEEE-754 operation takes part in any authoritative decision.
- The **evaluator** (`knowledge/units.ts`) and the **validator** (`knowledge/validate.ts`) each have their own:
  - decimal parser;
  - unit table;
  - rational reducer;
  - comparator.
  Neither imports the other's, and neither uses `@designflow/shared#decimalRatio` or systems `units.ts` (§16).

## 12. Label matching and near-match (D5)

- **Exact match:** the subject label is equal to a selector label, compared code unit by code unit. Only exact matches are in scope.
- **Near-match key:** `nk(s) = s.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()`. This is deterministic for the pinned Node major and its ICU data, as recorded in the verification evidence.
- **Near-match:** the label is **not** exactly in `labels`, but `nk(label)` equals `nk(l)` for some `l` in `labels`. The subject result is then `REVIEW_REQUIRED`, with:

```jsonc
"nearMatch": { "observed": "kitchen", "expected": ["Kitchen"], "sourceEntity": { "kind": "SPACE", "id": "space-kitchen-1" },
               "reason": "LABEL_NEAR_MATCH_CASE_OR_WHITESPACE_OR_NORMALIZATION", "evidence": ["fact-…"] }
```

- **No match and no near-match:** the subject is out of scope and produces no result. Only an empty scope gives `NOT_APPLICABLE`.
- Phase 27 never mutates or normalises the project model. `nk` exists only for the comparison. The validator implements `nk` independently.
- In `COUNT` operands, a near-match on any candidate subject makes the operand `REVIEW_REQUIRED`.
- **Amendment 3 test pack.** `test-support/knowledge-fixtures.ts` holds `test-label-matching` v0.0.1. It is not registered in the catalog and can't be selected through the API. Its three rules run against `space-kitchen-1` (label `kitchen`):

  | Selector labels | Expected status |
  |---|---|
  | `[kitchen]` | evaluates normally: **MEETS_RULE**, 29.025 m² ≥ 5 m² |
  | `[ Kitchen ]` | **REVIEW_REQUIRED**, with nearMatch evidence |
  | `[pantry]` | **NOT_APPLICABLE** |

  The test asserts the canonical source label is byte-identical before and after.

## 13. Conflict detection — `knowledge-conflict-detector-v1`

Conflict detection is static, over the **definitions** of the selected rules, across packs and within a pack. It does not depend on project data.

1. **Constraint keys** of a rule are the fact references and COUNT descriptors in its `requirement`.
2. **Normal form.** A requirement is in *scalar normal form* if it is one of the following, all over the **same** `{fact}` operand:
   - `GTE(f,a)` or `LTE(f,b)`;
   - `NOT(GTE(f,a))` (`f < a`) or `NOT(LTE(f,b))` (`f > b`);
   - `ALL` of these;
   - `EQUALS(f,v)` or `NOT(EQUALS(f,v))`.

   Numeric bounds become an exact interval with open or closed ends, in the canonical unit. Categorical forms become an allowed or excluded set.
3. **Pairs.** Only rule pairs that share a constraint key are considered. For each pair:

   | Condition (checked in order) | Pair outcome |
   |---|---|
   | different `scope.kind`, or both `labels` non-null and disjoint (exact) | `NO_OVERLAP` (analysed) |
   | either requirement not in normal form | `NOT_EVALUATED` |
   | `applicability` differs (canonical `digest` of the AST, null ≠ non-null) | `NOT_EVALUATED` |
   | intersection of the two constraint sets is empty | **`CONFLICT`** |
   | otherwise | `NO_CONFLICT` |

4. **Per-rule `conflictAnalysis`:**
   - `CONFLICT` if the rule is in any conflict pair;
   - otherwise `NOT_EVALUATED` if any of its pairs is `NOT_EVALUATED`;
   - otherwise `EVALUATED`.

   A rule with no pairs is `EVALUATED`, because under the V1 definition nothing else constrains its facts. The engine never reports "no conflict" for a pair it could not analyse.
5. **Conflict record:**

   ```jsonc
   { "conflictId": "cnf-<40 hex>",
     "rules": [ { "packId", "ruleId", "sourceReference" } ],   // sorted
     "factType": "…", "parameter": null,
     "scope": { "kind": "…", "labels": [ /* sorted */ ] },
     "constraints": [ /* normalised intervals or sets */ ],
     "reason": "EMPTY_INTERSECTION" }
   ```

   Records are sorted by `conflictId`. The caller resolves priority. Phase 27 never picks a winner.

Bound: ≤ `conflictPairs` pairs. The pair count is computed before any work is done, and overflow returns a 422 resource limit.

## 14. Binding, input identity and pack checksums

```jsonc
"binding": {
  // architecture (BimBindingSchema, reused verbatim)
  "projectId", "revisionId", "modelHash", "generatorVersion", "generationId", "requirementsHash", "parameterHash",
  "bimVersion": "bim-semantic-v1",
  "knowledgeModelVersion": "specialized-knowledge-model-v1",
  // explicit upstream (null when not supplied)
  "structural":    { "analysisId", "inputHash", "modelVersion": "structural-model-v1" } | null,
  "environmental": { "analysisId", "inputHash", "modelVersion": "environmental-model-v1" } | null,
  "systems":       { "analysisId", "inputHash", "modelVersion": "building-systems-model-v1" } | null,
  // knowledge
  "engine": { "knowledgeEngine": "specialized-knowledge-analysis-v1", "factExtractor": "project-facts-v1",
              "ruleEvaluator": "knowledge-rule-evaluator-v1", "conflictDetector": "knowledge-conflict-detector-v1", "units": "knowledge-units-v1" },
  "packs": [ { "packId", "version", "checksum" } ],   // sorted by packId
  "disciplines": [ … ]                               // sorted
}
```

- `inputHash = digest({ version: 'specialized-knowledge-analysis-v1', binding, input })`, where `digest` is the existing `costHash`, equal to SQL `project_private.cost_hash`. Changing **any** of the following changes `inputHash`: the revision, an upstream analysis or its input hash, a pack version or checksum, an engine literal, the disciplines, or the input.
- `factsHash = digest(facts)` is persisted, so fact drift is detectable.
- **Pack checksum** = `digest(pack)`, the full canonical pack JSON (64 hex). For bundled packs, `packs.ts` holds the checksum as a **literal constant** next to each pack. On first use, the registry recomputes `digest(pack)` and refuses a mismatch; the unit gate does the same.
- **Parity requirement:** packs contain only strings, booleans, arrays, objects and null. There are no JSON numbers (§5), so JS `costCanonical` and SQL `canonical_json` agree byte for byte. A parity test hashes every bundled pack in both runtimes.
- The snapshot embeds each selected pack **verbatim**. `knowledge_write` recomputes `cost_hash(pack)` for each embedded pack, and that must equal both the binding checksum and the column. A forged or altered pack is therefore rejected in SQL as well.
### 14.1 `TRANSITIVE_UPSTREAM_BINDING_CONSISTENCY` (Amendment 4)

Before facts are extracted, and again in the model validator, every bound upstream snapshot must satisfy all of these:

1. **Same project, revision and architecture.** `binding.projectId`, `binding.revisionId` and `binding.modelHash` equal the knowledge binding's. This holds for each of S, E and Y.
2. **Same identity as its row.** The snapshot's `inputHash` equals its row's `inputHash`, which the knowledge binding records. Its model version equals the expected literal (`structural-model-v1`, `environmental-model-v1`, `building-systems-model-v1`).
3. **Nested references agree.** Y may reference its own structural or environmental analysis (`Y.binding.structural`, `Y.binding.environmental`). For each nested reference X:
   - if the knowledge request binds the same discipline, then `X.analysisId`, `X.inputHash` and `X.modelVersion` must equal the knowledge binding's entry for it;
   - if it doesn't, the nested reference is recorded as provenance only, and no facts are taken from it.

A violation returns 422 `TRANSITIVE_UPSTREAM_BINDING_INCONSISTENT`, naming the invariant and the conflicting field. Snapshots that disagree with each other are never combined.

## 15. Output / snapshot — `specialized-knowledge-analysis-v1`

```jsonc
{
  "version": "specialized-knowledge-analysis-v1",
  "binding": { … }, "inputHash": "…", "factsHash": "…", "input": { … },
  "packs": [ { "packId", "version", "checksum", "pack": { /* verbatim knowledge-pack-v1 */ },
               "rulesTotal": 15, "rulesSelected": 15 } ],
  "facts": { "version": "project-facts-v1", "items": [ /* §9, sorted by factId */ ],
             "summary": { "present": n, "absent": n, "bySource": { … } } },
  "evaluator": { "name": "nekoarch-knowledge-evaluator", "version": "1.0.0" },
  "results": [ {
      "resultId": "kr-<40 hex>", "packId", "packVersion", "ruleId", "ruleVersion", "discipline", "severity",
      "subject": { "kind", "id", "label" } | null,
      "applicability": { "status": "APPLICABLE | NOT_APPLICABLE | UNDETERMINED | NOT_DECLARED", "trace": … | null },
      "status": "…", "isolatedStatus": "…", "precision": "…",
      "observedFacts": [ "fact-…" ],                                      // sorted
      "evidence": [ { "factId", "pointer", "artifactType", "artifactId" } ],   // sorted, ≤ 16
      "trace": { "op": "GTE", "status": "F",
                 "observed": { "exact": "1000", "unit": "mm", "factId": "…" },
                 "threshold": { "literal": "1001", "unit": "mm", "normalized": "1001", "canonicalUnit": "mm" },
                 "comparison": "1000 >= 1001", "truth": false, "children": [] },
      "explanation": { "summary": "Observed ARCH_STAIR_WIDTH 1000 mm; rule requires >= 1001 mm; 1000 >= 1001 is false.",
                       "semantics": "Stair width is below the stated minimum." },
      "nearMatch": { … } | null, "conflictIds": [ … ], "conflictAnalysis": "EVALUATED | CONFLICT | NOT_EVALUATED",
      "reviewRequired": false, "reviewDisciplines": [],
      "sourceReference": { "packId", "refId", "locator", "interpretation" } } ],
  "conflicts": [ … ],
  "missingInputs": [ { "kind": "SOURCE | FACT", "source"?, "factType"?, "subject"?, "ruleIds": [ … ] } ],
  "unsupported": [ { "factType", "ruleIds": [ … ], "reason" } ],
  "disciplineSummary": { "ARCHITECTURE": { "MEETS_RULE": n, …all 8 statuses… }, … },
  "summary": { "rulesSelected", "results", "byStatus": { … }, "conflicts", "rulesConflictNotEvaluated" },
  "validation": { "model": { "validator": "specialized-knowledge-validator-v1", "status": "VALID", "diagnostics": [] },
                  "results": { "validator": "specialized-knowledge-result-validator-v1", "status": "VALID", "diagnostics": [],
                               "recomputed": { "facts", "results", "conflicts" } } },
  "status": { "analysis": "EVALUATED", "validation": "VALIDATED" },
  "claims": { /* §15.1, all NOT_CLAIMED */ },
  "limitations": [ … ≤ 16 ]
}
```

**Ordering.**

- Results are sorted by `(packId, ruleId, subject.kind, subject.id)`, with a null subject first. Every other collection has a stated sort key.
- Comparison is by code unit, using the same `compare` as Phase 23. Iteration over objects is never used to order output.
- The `explanation.summary` wording is produced by a template. It is fixed text with exact numbers substituted in, with no LLM and no locale. It is advisory; the `trace` is authoritative.

### 15.1 Claims (mandatory; schema literal, validator and SQL CHECK)

`architecturalCompliance, structuralCompliance, electricalCompliance, plumbingCompliance, hvacCompliance, fireCodeCompliance, lifeSafetyCertification, accessibilityCompliance, elevatorCertification, energyCertification, buildingCodeCompliance, legalCompliance, professionalCertification`: every one is `"NOT_CLAIMED"`.

Phase 27 adds **no** `knowledgeRuleEvaluationComplete` flag: `summary.byStatus` already says exactly what was evaluated, so a completion flag adds nothing.

## 16. Independent validator architecture

`knowledge/validate.ts` is its own implementation. Its allowed imports are:

- `zod`;
- `./contracts.js`, for schemas, version literals and the fact catalog table (data, not logic);
- `@designflow/boq-cost#costHash`, for ids and checksums only. That is never a decision path, and SQL cross-checks it.

The import-graph gate (§24, G-indep) walks the **transitive** relative imports of `validate.ts`. It fails if the walk reaches `facts`, `evaluate`, `conflicts` or `units`, or any `systems/`, `structural/` or `environmental/` module other than their `contracts.js`. It also fails on any `@designflow/shared` import except schema types. The evaluator, in turn, may not import `validate.ts`.

`validateKnowledgeModel(facts, bim, upstream, expectedBinding)`:

- re-derives **every** fact from the BIM geometry and the upstream snapshots, using its own code (its own shoelace area, MAX, COUNT, bounds extent and decimal reader);
- requires set equality with the evaluator's facts over `factId`, `value`, `status`, `precision`, `source` and `derivation`. This kills "forge observed fact", "drop provenance" and "mislabel precision";
- checks binding equality and the upstream identity: same revision, input hash and model version.

`validateKnowledgeResults(draft, packs, facts)` independently:

- selects rules (pack × discipline);
- runs static UNSUPPORTED and NOT_EVALUATED;
- enumerates subjects with its own label and `nk` near-match;
- evaluates applicability and requirement with its own truth tables and rational comparator;
- recomputes conflicts with its own interval logic.

It then requires:

- equality of every result field: status, isolatedStatus, precision, observedFacts, evidence, trace numbers, conflictIds and conflictAnalysis;
- completeness: every selected rule has results, and there are no extras;
- canonical ordering;
- summary and discipline counts;
- claims all NOT_CLAIMED;
- the pack checksums.

Any difference makes the result `INVALID`, which gives 422 `KNOWLEDGE_RESULT_INVALID` and nothing is persisted.

**Shared primitives.** The only shared code on a decision path is `costHash` (identity). Its corruption is covered by the SQL recompute (M08, M27). Every arithmetic and normalisation routine exists twice. Mutants are planted in **both** copies (M20, M26, M28).

## 17. Persistence — migration `0017_specialized_knowledge_analyses.sql`

The migration is additive only and mirrors 0016. Migrations 0001–0016 are untouched.

- **Table** `public.project_revision_specialized_knowledge_analyses`:
  - identity and binding columns: `id uuid pk`, `project_revision_id → project_revisions`, `acceptance_qa_id`;
  - nullable FKs to the upstream analyses: `structural_analysis_id → …structural_analyses`, `environmental_analysis_id → …environmental_analyses`, `systems_analysis_id → …building_systems_analyses`;
  - version checks: `knowledge_model_version` (check = literal), `analysis_version` (check = literal);
  - hashes: `model_hash`, `input_hash`, `facts_hash` (64 hex);
  - `pack_identities jsonb` (array of `{packId, version, checksum}`);
  - evaluator identity: `evaluator_name`, `evaluator_version`;
  - `status = 'VALIDATED'`, `snapshot_json` (`octet_length ≤ 9_000_000`), `created_at clock_timestamp()`.
- **Constraints**:
  - FK `(project_revision_id, acceptance_qa_id)` → qa_runs;
  - `unique(project_revision_id, input_hash)`.
- **CHECK** that ties the columns to the snapshot:
  - version, inputHash, factsHash and binding revision, modelHash and knowledgeModelVersion;
  - the upstream ids equal `binding.{structural,environmental,systems}.analysisId`;
  - `pack_identities = snapshot.binding.packs`;
  - evaluator name and version;
  - `status.analysis = 'EVALUATED'` and `status.validation = status`;
  - **each of the 13 claims = 'NOT_CLAIMED'**;
  - `results`, `facts.items` and `conflicts` are arrays.
- **RLS on**:
  - `revoke all` from public, anon, authenticated and service_role;
  - `grant select` to authenticated and service_role;
  - owner-only select policy (via `projects.owner_id = auth.uid()`);
  - `immutable_revision` trigger on update and delete;
  - indexes on `(project_revision_id, created_at desc, id desc)` and on each FK.
- **`idempotency_records.operation` CHECK** is dropped and re-added with `/api/projects/:projectId/revisions/:revisionId/knowledge/analyses` appended.
- **`public.knowledge_write(p_input, p_context, p_envelope, p_signature)`**: SECURITY DEFINER, `search_path = ''`, `lock_timeout 5s`. It runs, in order:
  1. HMAC envelope check (user, operation, input, context, 600 s expiry);
  2. ownership check, even on replay;
  3. revision check;
  4. accepted-QA check;
  5. idempotency receipt (advisory lock, fingerprint conflict P8001);
  6. **binding recomputation** from `r.model_json`: modelHash via `cost_hash(canonical_building)`, generator, generation, requirements and parameter hashes, plus the version literals;
  7. sources: `input.sources.* = binding.*.analysisId`;
  8. **upstream verification** for each non-null upstream: a row exists in **this revision**, with `input_hash` and model version equal to the binding;
  9. **pack verification**: `jsonb_array_length(snap->'packs') = jsonb_array_length(binding->'packs')`, and for each `i`, `cost_hash(snap->'packs'->i->'pack') = snap->'packs'->i->>'checksum' = binding->'packs'->i->>'checksum'`, with packId and version agreeing;
  10. advisory lock on `(revision, inputHash)`, with a nondeterminism check: on an existing row, `facts_hash` and `results` must be identical;
  11. insert;
  12. receipt.
- **Error codes** `P2701` (not found), `P2702` (revision not accepted) and `P2703` (provenance or binding invalid) are mapped by `knowledgeDatabaseError`.
- **`public.knowledge_read(action get|list|status, …)`**: same contract as `systems_read`, including the keyset cursor, `limit` 1..100, `projectCurrentRevisionId`, and status showing up to 20 analyses for this revision and 20 for other revisions.
- **Grants**: execute to authenticated only, and `revoke … from public, anon`.
- **Currency.** An analysis is `CURRENT` iff its revision is the project's current revision; otherwise it is `STALE`. `?require=current` on a stale analysis returns **409 `KNOWLEDGE_RESULT_STALE`**. An analysis is never re-applied to another revision: reading it through another revision's URL returns 404.

## 18. API (`/api/projects/:projectId/revisions/:revisionId/knowledge`)

| Route | Behaviour |
|---|---|
| `GET /packs` | Authenticated owner, with a revision ownership check (404 for foreign or unknown). Returns catalog metadata only: packId, version, title, disciplines, publisher, jurisdiction, edition, effectiveDate, sourceType, license, checksum and ruleCount. No rule bodies. Deterministic order. |
| `POST /validate` | Runs preflight, the input schema, pack resolution, `readBim`, the upstream reads and consistency check, fact extraction and model validation, plus the static budgets (rules, pairs, subjects). Returns binding, selected rules per pack, static `UNSUPPORTED` / `NOT_EVALUATED` predictions, readiness, claims and limitations. **Does not evaluate predicates and does not persist.** |
| `POST /analyses` | The full pipeline (§2). Returns 201 with the detail. Idempotent with `Idempotency-Key` through `durableCommand`. |
| `GET /analyses` | Keyset-paginated summaries with `currency`. |
| `GET /analyses/:analysisId[?require=current]` | Detail with `currency`. 409 if stale and `require=current`. |
| `GET /status` | Analyses of this revision, plus stale analyses of other revisions. Never computes. |

Errors:

| Status | Code |
|---|---|
| 400 | `VALIDATION_ERROR` (malformed body, unknown field, bad cursor) |
| 401 | anonymous |
| 404 | project, revision or analysis not found, including foreign |
| 409 | `KNOWLEDGE_RESULT_STALE`, idempotency conflict |
| 422 | `KNOWLEDGE_PACK_UNKNOWN`, `KNOWLEDGE_SOURCE_UNSUPPORTED`, `TRANSITIVE_UPSTREAM_BINDING_INCONSISTENT`, `KNOWLEDGE_RESOURCE_LIMIT`, `KNOWLEDGE_MODEL_INVALID`, `KNOWLEDGE_RESULT_INVALID`, `REVISION_NOT_ACCEPTED` |
| 503 | `KNOWLEDGE_UNAVAILABLE` (signer or RPC missing) |

Error bodies follow the existing `ApiError` shape, with request ids preserved and no secrets or stack traces. The full contract goes in `phase27-api.md`.

## 19. Resource limits (provisional; final values from benchmarks)

These numbers are **proposals** with a written rationale. `benchmark-knowledge.ts` measures the §42 fixtures, and the final table is set at no more than about ½ of the measured comfortable ceiling, with the evidence recorded. Every overflow returns typed **422 `KNOWLEDGE_RESOURCE_LIMIT`**, checked *before* the expensive step it protects.

| Limit | Proposal | Rationale |
|---|---|---|
| `inputBytes` | 16 KiB | The input is refs, uuids and enums; a real request is under 1 KiB. |
| `packsSelected` | 8 | Two demo packs, with 4× headroom. |
| `rulesPerPack` | 256 | Matches the blueprint-qa precedent. |
| `rulesSelected` | 1024 | Bounds results and pairs. |
| `packBytes` | 256 KiB | Checked at registration with `bounded()`. |
| `predicateDepth` | 8 | Deepest demo rule is 3. |
| `nodesPerRule` | 64 | Deepest demo rule is 5. |
| `childrenPerAllAny` | 2..16 | — |
| `labelsPerSelector` | 32 | — |
| `facts` | 20 000 | The BIM profile max (28 spaces, 200 openings, 2 levels, 1 stair) plus 320 networks, 4 elevators and 8 cases gives ≈ 4k. |
| `subjectResults` | 50 000 | 1024 rules × ~200 openings would be 204k, so the limit forces typed rejection, not an OOM. |
| `conflictPairs` | 100 000 | Pairs are counted before comparing. |
| `evidencePerResult` | 16 | — |
| `traceNodesPerResult` | 64 | — |
| `outputBytes` | 8 MiB | Below the 9 MB SQL CHECK. |
| `calculationMs` | 5 000 | Expected to be well under 100 ms; this is a backstop. |

The benchmark set follows prompt §42, adapted to the source ceiling:

- small single-storey, L-shaped and two-storey setback;
- maximum-room fixture;
- wet two-storey bound to S, E and Y individually and together;
- both packs together;
- a synthetic high-rule-count pack (1024 generated rules over the catalog, test-only, never bundled);
- the conflict scenario.

For each, the run records facts, rules selected, applicable, evaluated and not evaluated, conflicts, evaluator ms, validator ms, snapshot bytes and RSS delta.

## 20. Security

| Threat | Defence |
|---|---|
| Executable or expression packs | There is no `eval`, `Function`, regex-from-data or property path. Operators and fact types are closed enums. A lint and grep gate forbids `eval` and `new Function` in `knowledge/`. |
| Prototype pollution or arbitrary traversal | `bounded()` rejects non-plain objects. Zod `.strict()` and `z.enum` keys. Fact lookup uses `Map`, keyed by catalog enum. |
| Recursion bombs, deep or huge input | Byte, node and depth preflight before zod; iterative AST depth and node checks before evaluation; length caps on every string and array. |
| ReDoS | No user-supplied regex. All schema regexes are anchored and linear. Labels are compared by equality. |
| SQL injection | RPC-only access with jsonb parameters; no dynamic SQL. |
| Cross-tenant or fake upstream ids | Revision-scoped reads in the service, plus SQL existence, revision, input hash and model version checks. |
| Forged pack checksum or content | Literal checksum, registry recompute, validator recompute and SQL `cost_hash` recompute. |
| Stale artifact reuse | `unique(revision, inputHash)`, currency on read, and 404 across revisions. |
| Path traversal | Packs are imported TS modules. No file paths come from input. |

## 21. Bundled demonstration packs

Both packs are project-authored, **synthetic** and `CC0-1.0`, with `jurisdiction: null` and `sourceType: SYNTHETIC_DEMONSTRATION`. Their titles say "demonstration thresholds — not a regulation". Neither uses a real code name.

`unit` is written inline, and `[labels]` are exact.

### Pack A — `nekoarch-demo-dimensional` v1.0.0 (ARCHITECTURE, LIFE_SAFETY, VERTICAL_TRANSPORT) — 15 rules (A11 retired per Amendment 3; ids are not reused)

| Rule | Disc. | Scope | Applicability | Requirement |
|---|---|---|---|---|
| A01 `a01-door-width-min` | ARCH | OPENING `[door]` | — | `GTE(ARCH_OPENING_WIDTH, "900" mm)` |
| A02 `a02-stair-width-min` | ARCH | STAIR | — | `GTE(ARCH_STAIR_WIDTH, "1001" mm)` |
| A03 `a03-riser-max` | ARCH | STAIR | — | `LTE(ARCH_STAIR_MAX_RISER, "187" mm)` |
| A04 `a04-tread-min` | ARCH | STAIR | — | `GTE(ARCH_STAIR_TREAD_DEPTH, "0.279" m)` |
| A05 `a05-headroom-min` | ARCH | STAIR | — | `GTE(ARCH_STAIR_HEADROOM, "2000" mm)` |
| A06 `a06-bedroom-area-min` | ARCH | SPACE `[bedroom]` | — | `GTE(ARCH_SPACE_AREA, "9" m2)` |
| A07 `a07-garage-area-min` | ARCH | SPACE `[garage]` | — | `GTE(ARCH_SPACE_AREA, "15" m2)` |
| A08 `a08-window-sill-min` | ARCH | OPENING `[window]` | — | `GTE(ARCH_OPENING_SILL, "900" mm)` |
| A09 `a09-egress-distance-max` | LIFE_SAFETY | SPACE (all) | — | `LTE(SYS_EGRESS_DISTANCE, "40" m)` |
| A10 `a10-lift-over-two-storeys` | VERT | BUILDING | `NOT(LTE(ARCH_STOREY_COUNT, "2" count))` | `GTE(COUNT(ELEVATOR, null), "1" count)` |
| A12 `a12-lift-door-min` | VERT | ELEVATOR | — | `GTE(SYS_ELEVATOR_DOOR_WIDTH, "800" mm)` |
| A13 `a13-dead-end-max` | LIFE_SAFETY | SPACE (all) | `EXISTS(SYS_DEAD_END_LENGTH)` | `LTE(SYS_DEAD_END_LENGTH, "20" m)` |
| A14 `a14-stair-all` | ARCH | STAIR | — | `ALL(GTE(TREAD,"250" mm), LTE(MAX_RISER,"190" mm), GTE(HEADROOM,"2000" mm))` |
| A15 `a15-stair-any` | ARCH | STAIR | — | `ANY(GTE(HEADROOM,"2000" mm), GTE(ARCH_STAIR_WIDTH,"900" mm))` |
| A16 `a16-headroom-below-2500` | ARCH | STAIR | — | `NOT(GTE(ARCH_STAIR_HEADROOM, "2500" mm))` |

### Pack B — `nekoarch-demo-coordination` v1.0.0 (ARCHITECTURE, ENVIRONMENTAL, MEP, STRUCTURAL, QUANTITY, COST)

| Rule | Disc. | Scope | Applicability | Requirement |
|---|---|---|---|---|
| B01 `b01-window-sill-max` | ARCH | OPENING `[window]` | — | `LTE(ARCH_OPENING_SILL, "850" mm)` (**conflicts with A08**) |
| B02 `b02-wfr-indicator-min` | ENV | SPACE `[living]` | — | `GTE(ENV_WINDOW_TO_FLOOR_RATIO, "0.05" 1)` |
| B03 `b03-wfr-exact-min` | ENV | SPACE `[living]` | — | `GTE(RATIO(ARCH_SPACE_WINDOW_AREA, ARCH_SPACE_AREA), "0.0496" 1)` |
| B04 `b04-transmission-max` | ENV | THERMAL_CASE | — | `LTE(ENV_TRANSMISSION_TOTAL, "6.64434" kW)` |
| B05 `b05-duct-velocity-max` | MEP | MEP_NETWORK `[HVAC_SUPPLY, HVAC_RETURN]` | — | `LTE(SYS_DUCT_MAX_VELOCITY, "4.1666" m/s)` |
| B06 `b06-demand-max` | MEP | BUILDING | — | `LTE(SYS_ELECTRICAL_DEMAND_W, "5" kW)` |
| B07 `b07-connected-max` | MEP | BUILDING | — | `LTE(SYS_ELECTRICAL_CONNECTED_W, "1.75" kW)` |
| B08 `b08-drainage-slope-min` | MEP | MEP_NETWORK `[SANITARY]` | — | `GTE(SYS_DRAINAGE_SLOPE, "0.025" 1)` |
| B09 `b09-cost-cap` | COST | BUILDING | — | `LTE(COST_TOTAL, "1000000" MONEY)` |
| B10 `b10-beam-depth-min` | STRUCT | STRUCTURAL_MEMBER `[BEAM]` | — | `GTE(STRUCT_SECTION_DEPTH, "550" mm)` |
| B11 `b11-utilisation-max` | STRUCT | STRUCTURAL_MEMBER | — | `LTE(STRUCT_UTILISATION, "1" 1)` |
| B12 `b12-penetration-review` | MEP (`reviewDiscipline` LIFE_SAFETY) | BUILDING | `GTE(SYS_PENETRATION_COUNT, "1" count)` | `MANUAL_REVIEW("Fire-stopping of service penetrations")` |
| B13 `b13-envelope-closed` | ENV | BUILDING | — | `EQUALS(ENV_ENVELOPE_STATUS, "CLOSED")` |
| B14 `b14-gfa-max` | QUANTITY | BUILDING | — | `LTE(QUANTITY_TOTAL{GEOMETRIC_GROSS_FLOOR_AREA}, "418.3" m2)` |
| B15 `b15-bathroom-count-min` | ARCH | BUILDING | — | `GTE(COUNT(SPACE, [bathroom]), "2" count)` |

## 22. Golden acceptance table (hand-computed; normative)

**Fixture G1.** Every value below was hand-derived from the fixture geometry and inputs, then cross-checked by running the released Phase 23–26 engines read-only. All packs are selected, all 8 disciplines are in scope, and all three upstream sources are bound.

- **R:** accepted revision generated from `wetRequirements()`, the Phase 26 two-storey building (`test-support/systems-fixtures.ts`). It has 2 storeys at 0 and 3000 mm with floor-to-floor 3000, 9 spaces, 8 doors (900 × 2100), 5 windows (1200 × 1200, sill 900), and one stair (width 1000, tread 280, risers 8 × 188 + 8 × 187, **no headroom**). It has no occupancy and site entry `door-wall-level-0-1100-1100-18900-1100-8450-900`.
- **S (Phase 24):** `wetFrameInput()`. Columns c1 and c2 are 300 × 300; beam b1 is 300 × 600, 6350 mm long.
- **E (Phase 25):** `environmentalInput()`. Envelope `CLOSED`; case `design-winter` total **6644.340000000001 W**; living WFR **0.04961240310077519**.
- **Y (Phase 26):** `systemsInput()` with sources null. Egress distances, dead end corridor-1 22050 mm, elevator lift-1 PROPOSED with door 900, 25 penetrations, 0 clashes, connected 1750 W, demand NOT_EVALUATED, duct velocities max **25/6** m/s for both `HVAC_SUPPLY:sa` and `HVAC_RETURN:ra`, sanitary slope 1/40.

| # | Rule | Subject(s) | Observed (precision) | Threshold → canonical | Evaluation | Status | Covers |
|---|---|---|---|---|---|---|---|
| 1 | A01 | 8 doors | 900 mm (INT) | 900 mm | 900 ≥ 900 | **MEETS_RULE** ×8 | exact equality |
| 2 | A02 | stair-0 | 1000 mm (INT) | 1001 mm | 1000 ≥ 1001 false | **DOES_NOT_MEET_RULE** | one unit below |
| 3 | A03 | stair-0 | 188 mm (INT, MAX) | 187 mm | 188 ≤ 187 false | **DOES_NOT_MEET_RULE** | one unit above |
| 4 | A04 | stair-0 | 280 mm (INT) | 0.279 m → 279 mm | 280 ≥ 279 | **MEETS_RULE** | unit conversion, one above min |
| 5 | A05 | stair-0 | headroom ABSENT | 2000 mm | — | **INPUT_INCOMPLETE** | missing input |
| 6 | A06 | space-bedroom-1 | 84532500 mm² (DEC) | 9 m2 → 9000000 | true | **MEETS_RULE** | area, m2 conversion |
| 7 | A07 | — (no `garage`) | — | — | empty scope | **NOT_APPLICABLE** | NOT_APPLICABLE (scope) |
| 8 | A08 | 5 windows | 900 mm (INT) | 900 mm | isolated T | **CONFLICTING_RULES** ×5 (isolated MEETS_RULE) | conflict |
| 9 | A09 | bathroom-1 24250, corridor-0 25550, corridor-1 38300, kitchen-1 16700, living-1 12200, stairwell-0 26700, stairwell-1 24700 (FLOAT) | | 40 m → 40000 mm | ≤ 40000 | **MEETS_RULE** ×7 | float provenance |
| 10 | A09 | bathroom-2 42400, bedroom-1 43900 (FLOAT) | | 40000 mm | > 40000 | **DOES_NOT_MEET_RULE** ×2 | |
| 11 | A10 | building | storeys 2 (INT) | applicability `NOT(2 ≤ 2)` = F | — | **NOT_APPLICABLE** | applicability false |
| 13 | A12 | lift-1 | 900 mm (INT) | 800 mm | true | **MEETS_RULE** | vertical transport |
| 14 | A13 | space-corridor-1 | 22050 mm (FLOAT) | 20 m → 20000 | 22050 ≤ 20000 false | **DOES_NOT_MEET_RULE** | applicability true |
| 15 | A13 | the 8 other spaces | no dead-end fact | applicability `EXISTS` = F | — | **NOT_APPLICABLE** ×8 | |
| 16 | A14 | stair-0 | T (280 ≥ 250), T (188 ≤ 190), I (headroom) | | ALL(T,T,I) | **INPUT_INCOMPLETE** | ALL truth table |
| 17 | A15 | stair-0 | I (headroom), T (1000 ≥ 900) | | ANY(I,T) | **MEETS_RULE** | ANY truth table |
| 18 | A16 | stair-0 | I | | NOT(I) | **INPUT_INCOMPLETE** | NOT over unknown |
| 19 | B01 | 5 windows | 900 mm | 850 mm | isolated F | **CONFLICTING_RULES** ×5 (isolated DOES_NOT_MEET_RULE) | conflict |
| 20 | B02 | space-living-1 | 0.04961240310077519 (FLOAT) | 0.05 | false | **DOES_NOT_MEET_RULE** | float indicator |
| 21 | B03 | space-living-1 | 1440000 / 29025000 = **32/645** (RATIONAL) | 0.0496 | 320000 ≥ 319920 | **MEETS_RULE** | exact ratio |
| 22 | B04 | design-winter | 6644.340000000001 W (FLOAT) | 6.64434 kW → 6644.34 W | diff 10⁻¹² ≤ 16·2⁻⁴⁰ (§10.1) | **REVIEW_REQUIRED** (`FLOAT_BOUNDARY_AMBIGUITY`) | float boundary policy |
| 23 | B05 | HVAC_RETURN:ra, HVAC_SUPPLY:sa | max 25/6 m/s (RATIONAL) | 4.1666 | 25/6 > 4.1666 | **DOES_NOT_MEET_RULE** ×2 | non-terminating rational vs decimal |
| 24 | B06 | building | demand ABSENT (upstream NOT_EVALUATED) | 5 kW | — | **INPUT_INCOMPLETE** | missing upstream value |
| 25 | B07 | building | 1750 W (RATIONAL) | 1.75 kW → 1750 W | 1750 ≤ 1750 | **MEETS_RULE** | kW conversion, equality |
| 26 | B08 | SANITARY | 1/40 (RATIONAL) | 0.025 | 1/40 ≥ 1/40 | **MEETS_RULE** | rational equality |
| 27 | B09 | — | COST_TOTAL `supported:false` | — | static | **UNSUPPORTED** | COST unsupported |
| 28 | B10 | b1 | 600 mm (FLOAT) | 550 mm | 600 ≥ 550, diff 50 ≫ band | **MEETS_RULE** | structural source, float clearly separated |
| 29 | B11 | — | STRUCT_UTILISATION `supported:false` | — | static | **UNSUPPORTED** | no invented capacity |
| 30 | B12 | building | applicability 25 ≥ 1 = T | — | MANUAL_REVIEW | **REVIEW_REQUIRED** (reviewDisciplines `[LIFE_SAFETY]`) | manual review |
| 31 | B13 | building | `CLOSED` (CAT) | `CLOSED` | equal | **MEETS_RULE** | categorical |
| 32 | B14 | building | 418300000 mm² (DEC) | 418.3 m2 → 418300000 | equal | **MEETS_RULE** | quantity source |
| 33 | B15 | building | COUNT(SPACE,[bathroom]) = 2 | 2 | 2 ≥ 2 | **MEETS_RULE** | COUNT operand |

**G1 totals: 62 results.**

| Status | Count |
|---|---|
| MEETS_RULE | **26** |
| DOES_NOT_MEET_RULE | **8** |
| NOT_APPLICABLE | 10 |
| INPUT_INCOMPLETE | 4 |
| REVIEW_REQUIRED | 2 |
| UNSUPPORTED | 2 |
| CONFLICTING_RULES | 10 |
| NOT_EVALUATED | 0 |

**Conflicts: exactly 1**, `{A08, B01}` on `ARCH_OPENING_SILL`, OPENING `[window]`, `[900, ∞) ∩ (−∞, 850] = ∅`.

`conflictAnalysis`:

- `NOT_EVALUATED` for A02, A03, A04, A05, A14, A15 and A16 (stair facts shared with the compound A14/A15);
- `CONFLICT` for A08 and B01;
- `EVALUATED` for every other rule. A06, A07 and B03 share `ARCH_SPACE_AREA`, but their exact label sets are disjoint, so the result is `NO_OVERLAP`.

**Usefulness criterion (approved item 10).** G1 must produce ≥ 20 MEETS_RULE and ≥ 5 DOES_NOT_MEET_RULE from real Phase 23–26 facts, spanning ARCHITECTURE, LIFE_SAFETY, VERTICAL_TRANSPORT, ENVIRONMENTAL, MEP, STRUCTURAL and QUANTITY. The table above has 26 and 8. Near-match coverage is the test-only pack (§12).

**Further scenarios** (same fixture unless noted):

| # | Scenario | Expected |
|---|---|---|
| G2 | `environmentalAnalysisId: null` | B02, B04 and B13 each give one `NOT_EVALUATED` result. `missingInputs` contains `{SOURCE: ENVIRONMENTAL_ANALYSIS}`. B03 is still **MEETS_RULE** (architecture facts only). Everything else equals G1. |
| G3 | `scope.disciplines: [ARCHITECTURE]` | Selected rules are A01–A08, A14–A16, B01 and B15. The conflict is still detected. A09, A10, A12 and A13 produce no results. |
| G4 | Byte-identical rerun of G1 | Same `inputHash`, `factsHash` and snapshot bytes. A replay returns the same `id`. Concurrent identical calls converge on one row. |
| G5 | Revision advanced after G1 | G1 is `STALE`; `?require=current` returns 409; reading G1 through the new revision's URL returns 404. |
| G6 | `systemsAnalysisId` from another revision or another project | 404 from the revision-scoped read, and SQL rejects a forged write (P2703). |
| G7 | Bound systems analysis references structural S′ while the knowledge input binds S | 422 `TRANSITIVE_UPSTREAM_BINDING_INCONSISTENT`. |
| G8 | Unknown pack version `nekoarch-demo-dimensional@9.9.9` | 422 `KNOWLEDGE_PACK_UNKNOWN`. |

## 23. Mutation plan

Every mutant is planted by `docs/phase27/mutation-test.py`, run against the named gate, and restored. Each must be **killed for the stated reason**, which is checked by asserting the expected failing test name or diagnostic.

| # | File | Mutation | Killed by (reason) |
|---|---|---|---|
| M01 | evaluate.ts | GTE `>=` → `>` | G1 #1 (900 ≥ 900) validator mismatch + known answer |
| M02 | evaluate.ts | LTE `<=` → `<` | G1 #25, #26, #32 equality |
| M03 | evaluate.ts | skip literal unit normalisation | G1 #9 (40 vs 24250 flips), #25 |
| M04 | evaluate.ts | ABSENT fact in comparison → T | G1 #5, #24 |
| M05 | evaluate.ts | NOT_APPLICABLE → MEETS_RULE | G1 #7, #11, #15 |
| M06 | evaluate.ts | skip applicability | G1 #11 (A10 → MEETS via count 1 ≥ 1), #15 |
| M07 | evaluate.ts | drop last selected rule | validator completeness diagnostic |
| M08 | packs.ts | alter one checksum literal | registry refusal + unit gate |
| M09 | evaluate.ts | drop one evidence entry | validator evidence equality |
| M10 | conflicts.ts | return no conflicts | validator conflict recompute; G1 #8, #19 |
| M11 | knowledge-service.ts | read upstream without revision scope | G6 integration (404 expected) |
| M12 | knowledge-service.ts | ignore `require=current` | G5 409 test |
| M13 | validate.ts | result validator returns VALID without checking | forged-draft unit tests (must be INVALID) |
| M14 | evaluate.ts | RATIO via `Number(n)/Number(d)` | G1 #21 trace `32/645` mismatch |
| M15 | evaluate.ts | remove result sort | byte-identical rerun + validator ordering |
| M16 | evaluate.ts | static UNSUPPORTED → MEETS_RULE | G1 #27, #29 |
| M17 | contracts.ts | drop one claim key | schema + validator + SQL CHECK test |
| M18 | contracts.ts / service | skip `subjectResults` limit | resource-limit 422 test |
| M19 | facts.ts | +1 on one egress distance | validator fact re-derivation |
| M20 | validate.ts | validator GTE `>=` → `>` | G1 analysis creation fails (validator rejects a correct result) |
| M21 | evaluate.ts | ALL: F no longer dominant (T if any T) | truth-table property test + G1 #16 |
| M22 | evaluate.ts | NOT(I) → T | truth-table test + G1 #18 |
| M23 | evaluate.ts | near-match → out of scope (NOT_APPLICABLE) | G1 #12 |
| M24 | facts.ts | label UPSTREAM_FLOAT as EXACT_INTEGER | validator provenance equality |
| M25 | validate.ts | skip conflict recompute | forged-draft test without the conflict |
| M26 | units.ts | evaluator decimal parser drops one fractional digit | G1 #25 (`1.75` → 0.175 kW flips) |
| M27 | 0017 SQL (test DB only) | remove pack `cost_hash` recompute | DB test: forged checksum accepted → test fails |
| M28 | validate.ts | validator `%` / `kW` factor wrong | G1 #25 creation fails |
| M29 | facts.ts | pointer drops array index | validator source equality |
| M30 | evaluate.ts | remove float ambiguity check | G1 #22 (B04 becomes DOES_NOT_MEET_RULE) + validator |
| M31 | evaluate.ts | reverse it (ambiguous ⇔ outside band) | G1 #9–10, #14, #20, #28 become REVIEW_REQUIRED + B04 decided |
| M32 | evaluate.ts | widen (K = 32) | known answer: `1.0000000000000038` vs `"1"` (17.1 ulp) must be definite |
| M33 | evaluate.ts | narrow (K = 8) | known answer: `1.0000000000000033` vs `"1"` (14.9 ulp) must be REVIEW_REQUIRED |
| M34 | validate.ts | validator float band removed | G1 creation fails (validator disagrees on B04) |
| M35 | knowledge-service.ts | skip TRANSITIVE_UPSTREAM_BINDING_CONSISTENCY | G7 integration (422 expected) |
| M36 | evaluate.ts | ANY implemented as NOT(ALL(NOT…)) with a broken NOT on R | exhaustive ANY ≡ De Morgan equivalence test |

Result format: `docs/phase27/evidence/mutation-testing.json`, with per-mutant `{killed, gate, reason}`. Every mutated file is verified restored by SHA-256.

## 24. Tests and release gates (summary; detailed in `phase27-verification.md`)

- **Unit** (`apps/api/tests/knowledge.test.ts`):
  - pack schema and limits;
  - malicious packs: JSON numbers, `__proto__`, depth 25, 300 rules, 10 KB strings, unknown op or fact, unit dimension mismatch;
  - parity of the decimal parser and units in **both** implementations;
  - every primitive at equality, −1 and +1, plus negative literals;
  - the exhaustive truth table and De Morgan checks for both implementations;
  - near-match;
  - fact extraction for every catalog row;
  - conflicts: positive, NO_OVERLAP, NOT_EVALUATED and differing applicability;
  - G1 known answers built in-process;
  - byte-identical rerun;
  - forged-draft rejection;
  - claims.
- **JS↔SQL parity:** `digest(pack) === cost_hash(pack)` for every bundled pack and for a nested synthetic pack (embedded PostgreSQL).
- **Integration** (`knowledge.integration.test.ts` + `test-support/knowledge-acceptance.ts`, shared with live Supabase):
  - G1–G8 over HTTP;
  - 401, 404, 400, 409, 422, 503;
  - request-id preservation;
  - GET never computes (spy shows no evaluator call).
- **DB:**
  - 0017 applies after 0001–0016, and 0001–0016 are byte-unchanged;
  - RLS for owner, foreign and anon;
  - direct insert, update and delete blocked;
  - forged binding, upstream, checksum or input hash rejected;
  - immutability, replay, concurrency and pagination;
  - prior tables and policies preserved;
  - pgTAP plan extended.
- **Gates:**
  - build, typecheck and lint;
  - every prior suite (prompt §38);
  - `test:knowledge`;
  - G-indep (the transitive import graph, §16);
  - G-noeval;
  - benchmarks;
  - mutation;
  - Docker with `--network none`, plus compiled Phase 23–27 acceptance;
  - a frozen-source run with a SHA-256 manifest before and after each gate, protected-history hashes, no skips and no waivers.

## 25. Deferred (explicitly not V1; not "unsupported forever")

| Item | Status |
|---|---|
| External, organization or user pack ingestion (upload, inline, registry) | **DEFERRED.** `knowledge-pack-v1` already carries publisher, jurisdiction, license and checksum. A future input version adds a pack body path that reuses the same validation, checksum and SQL recompute. |
| COST facts (0007–0009 chain) | DEFERRED (D2). |
| Fact-vs-fact comparison, arithmetic beyond RATIO | DEFERRED. |
| RATIO over `UPSTREAM_FLOAT` facts (needs propagated ULP bands) | DEFERRED. Rejected at pack validation today. |
| Semantic (not structural) applicability equivalence in conflict detection; compound-predicate conflict analysis | DEFERRED. Reported as `NOT_EVALUATED` today. |
| ULP-aware review band for UPSTREAM_FLOAT boundary results | DEFERRED. V1 reports precision transparently and never rounds. |
| Optional LLM paraphrase layer above deterministic results | DEFERRED (Phase 36 territory). It can never change a status. |
| Occupant load, accessibility, fire rating, measured setbacks, door clear width | Need model data first. Declared `supported: false`. |

**Non-goals** (prompt §29): optimisation, redesign, certification, legal advice, jurisdiction selection, scraping, copyrighted ingestion, RAG, embeddings, vector, graph or Redis stores, microservices, GPU, frontend and ponytail refactors.

## 26. Known limitations

- **Source ceiling.** Phase 27 inherits the Phase 23 BIM profile (≤ 2 storeys, ≤ 28 spaces, 1 stair, no columns). Larger revisions return 422 `KNOWLEDGE_SOURCE_UNSUPPORTED`.
- **Precision ceiling.** Results over `UPSTREAM_FLOAT` facts are exactly as precise as the stored double. Boundary artifacts like G1 #22 are possible and visible.
- **Bounded conflict detection.** It covers the same fact, overlapping scope, identical applicability and scalar normal form only.
- **Label scope.** Matching is literal. There is no synonym ontology.
- **What a result means.** Every result is advisory. No result is compliance, certification or professional approval.

## 27. Files to be created or changed (implementation phase)

New:

- `apps/api/src/knowledge/{contracts,packs,units,facts,evaluate,conflicts,validate}.ts`
- `apps/api/src/lib/knowledge-repository.ts`
- `apps/api/src/services/knowledge-service.ts`
- `apps/api/src/routes/knowledge.ts`
- `supabase/migrations/0017_specialized_knowledge_analyses.sql`
- `test-support/knowledge-fixtures.ts`, `test-support/knowledge-acceptance.ts`
- `apps/api/tests/knowledge.test.ts`, `apps/api/tests/knowledge.integration.test.ts`
- `scripts/benchmark-knowledge.ts`
- `docs/phase27/{phase27-api,phase27-report,phase27-verification}.md`, `docs/phase27/evidence/**`, `docs/phase27/{verify-phase27.py,mutation-test.py,compiled-acceptance.mjs}`

Extended (additive):

- `apps/api/src/lib/repository.ts` (`knowledgeRpc?`)
- `apps/api/src/lib/supabase.ts`
- `test-support/pg-backend.ts`
- `apps/api/src/app.ts` (one route mount)
- `supabase/tests/rls.sql`, `supabase/tests/database.test.ts`
- `apps/api/tests/supabase.live.test.ts`
- `package.json` scripts

Untouched: migrations 0001–0016, `packages/**`, Phase 23–26 source and evidence, and every released tag.

## 28. Implementation audit (normative refinements made during implementation)

These refine, and never weaken, the sections above. They are binding for the code and the tests.

1. **Fact catalog (§9).** 49 declared fact types: 44 supported and 5 `supported: false`. Four of the 44 are subject-label facts (`ARCH_SPACE_CLASSIFICATION`, `ARCH_OPENING_KIND`, `STRUCT_MEMBER_KIND`, `SYS_NETWORK_SYSTEM`).
   - Label facts are `referable: false`, so packs can't reference them. They exist so a label, and therefore a near-match, has provenance (`nearMatch.evidence`).
2. **`ARCH_SPACE_WINDOW_AREA`** is ABSENT when *any wall on the space's level* lacks explicit `spaceIds`. Adjacency is never inferred from geometry.
3. **Static sources (§7 step 2)** include the source of `scope.kind` and of every `COUNT` kind. `COUNT(ELEVATOR)` without a bound systems analysis is `NOT_EVALUATED`, never "0 lifts" (G1-none test).
4. **Evidence per result:** up to 128, because a `RATIO` node observes two facts and rules have at most 64 nodes.
5. **SQL identities (§17).** `knowledge_write` recomputes `inputHash` (`cost_hash` of version, binding and input) and `factsHash` (`cost_hash` of facts) as well as each pack checksum. This works because binding, input and pack contain no non-integer JSON numbers, and facts carry exact strings. `TRANSITIVE_UPSTREAM_BINDING_CONSISTENCY` is also checked in SQL against the 0016 row's own upstream columns.
6. **Claims (§15.1)** are enforced in SQL by exact `jsonb` equality with the 13-key `NOT_CLAIMED` object, so nothing can be added, dropped or changed.
7. **Float basis length.** `trace.basis.{ulp, band, diff}` may be up to 1,200 characters, because 2⁻¹⁰⁷⁴ has 1,074 fractional digits. The benchmark found this on fixtures whose window-to-floor ratio is stored as 0. Exact values are never truncated.
8. **Frozen resource limits (§19).** Set from `evidence/benchmark-pre-freeze.json`. Results cost about 1.35 KB each in the snapshot. Post-freeze `evidence/benchmark.json` shows every over-limit case rejected in under 16 ms.

   | Limit | Frozen | Evidence |
   |---|---|---|
   | `rulesSelected` | **512** (was 1,024) | 1,024 rules gave 12–22 MB snapshots; 414 rules → 3.95 MB |
   | `subjectResults` | **6,000** (was 50,000) | ≈ 8 MiB ÷ 1.35 KB; rejects before evaluation; the eight-pack stress case is 1,865 (3.2×) |
   | `conflicts` | **1,000** (new) | 2 × 128 contradictory rules gave 16,384 conflicts (33 MB); eight-pack stress case 647 |
   | `conflictPairs` | 100,000 | 99,681 pairs cost 102 ms |
   | `facts` | 20,000 | profile maxima (800 members, 320 networks, 200 openings) ≈ 6.5k |
   | `outputBytes` | 8 MiB | G1 0.29 MB |
   | others | unchanged | `inputBytes` 16 KiB, packs 8, rules/pack 256, depth 8, nodes 64, children 16, labels 32, pack 256 KiB, 5 s backstop |

9. **Mutation plan (§23)** gains **M37**: the validator imports evaluator arithmetic. It is killed by the G-indep gate, `docs/phase27/validator-independence.mjs`, which walks the transitive imports.
10. **Golden G1 is reproduced exactly** by the in-process unit suite, the HTTP acceptance (embedded PostgreSQL and local Supabase) and the compiled container acceptance. The container variant reuses the Phase 26 compiled input with demand factors, so B06 there is `MEETS_RULE` (1400 ≤ 5000 W) and environmental rules are `NOT_EVALUATED`.
11. **Observed upstream float noise.** Phase 25 sums surface heat flows in semantic-id order, and those ids depend on the projectId. The stored `design-winter` total is therefore `6644.34`, `6644.340000000001`, `6644.340000000002` or `6644.339999999998` depending on the project: up to two binary64 spacings either side. All of them sit inside the §10.1 band (diff ≤ 2·10⁻¹² ≤ 16·2⁻⁴⁰), so B04 is `REVIEW_REQUIRED` every time. The HTTP acceptance asserts this property (diff ≤ band) rather than one representation. The in-process golden G1 uses a fixed projectId and the `.000000000001` value. Without Amendment 2 this rule would have flipped between MEETS and DOES_NOT_MEET depending on the project.

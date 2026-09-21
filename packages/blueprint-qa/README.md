# Independent Blueprint QA

Pure, deterministic Building Model V2 auditing. Production dependencies are only `@designflow/shared` and Zod. No generator import, AI, I/O, persistence, repair, timestamps or random IDs.

```ts
import { auditBlueprint, BlueprintQaReportSchema,
  PRODUCT_DEFAULTS_RULE_PACK } from '@designflow/blueprint-qa';

const report = auditBlueprint(untrustedModel, {
  entryOpeningIds: ['my-entrance-door'],
  requireReachability: true,
  rulePacks: [PRODUCT_DEFAULTS_RULE_PACK], // optional product preferences, not law
});
BlueprintQaReportSchema.parse(JSON.parse(JSON.stringify(report)));
```

`entrySpaceIds` can instead designate caller-known entry spaces. QA never guesses entrances from IDs, names, generator provenance or wall classification. All declared entries from options and rule packs are combined into the audit's entry set. Use separate audits for separate entrance scenarios. Doors and generic passages can connect spaces; windows and service openings cannot. A raised threshold cannot establish level-floor connectivity without represented step access.

## Public contracts

- `auditBlueprint(input: unknown, options?: unknown): BlueprintQaReport` returns schema, semantic, unsupported-input and resource findings through the same runtime-validated report boundary. Programmer defects are not silently converted into invalid-document findings.
- `BlueprintQaOptionsSchema`, `BlueprintQaReportSchema`, `FindingSchema`, `RuleResultSchema`, `ArchitecturalRuleSchema`, `ArchitecturalRulePackSchema`, `SeveritySchema` and corresponding exported TypeScript types.
- `QA_VERSION = 'blueprint-qa-v1'`; independent pack and rule versions.
- `PRODUCT_DEFAULTS_RULE_PACK`: optional warnings for modeled door width below 900 mm and tread depth below 280 mm, taken from documented Phase 10 product defaults. Neither is a legal compliance rule.

## Status and evidence

`FAIL` means at least one ERROR finding, `PASS_WITH_WARNINGS` means warnings without errors, and `PASS` means neither. INFO findings do not change status. Always inspect `coverage` and `ruleResults`; a status is not a construction certificate. No numeric quality score exists.

`inputStatus` distinguishes `SCHEMA_INVALID`, `SCHEMA_VALID` and `NOT_EVALUATED` (for example preflight resource limits). Shape validity includes positive integer lengths, simple polygons and valid contained/disjoint voids. Independent semantic findings are evaluated after this boundary. Shape errors identify field paths; semantic findings identify entity IDs, stable codes, expected/actual values and evidence. A duplicate ID or legacy planar document stops semantic evaluation to avoid ambiguous references or invented construction geometry.

Dimensions, areas and circulation are recomputed. Areas are exact decimal mm² strings (including `.5`), not floating-point quantities. Lengths expected to reconcile are compared exactly. Noninteger diagonal wall length is rounded to the nearest mm and explicitly labeled; no rounded diagonal length is used for opening host-fit acceptance. Opening fit uses the exact squared wall length.

## Rules

Rule packs are declarative JSON with `id`, `version`, `description`, `rules`, and optional explicit entry IDs. Rule IDs are unique within each pack; pack IDs are unique per audit. Every rule supplies `id`, `version` and `severity`. Supported kinds:

| Kind | Required parameter | Meaning |
| --- | --- | --- |
| `minimum-space-area` | `minimumMm2` | Declared centerline polygon area |
| `minimum-space-span` | `axis`, `minimumMm` | Rectangular centerline span; other shapes NOT_EVALUATED |
| `minimum-door-width` | `minimumMm` | Modeled opening width, not effective clear leaf width |
| `maximum-riser-height` | `maximumMm` | Maximum of every represented riser |
| `minimum-tread-depth` | `minimumMm` | Modeled tread depth |
| `required-window` | none | Valid geometrically adjoining window |
| `exterior-windows` | none | Exterior proven from envelope boundary/face and adjacency; uncertain cases NOT_EVALUATED |
| `reachable-spaces` | none | Rebuilt graph from explicit entrances |
| `column-free-spaces` | none | Caller-selected floor spaces must not intersect represented floor-level columns |

Space policies accept optional `classifications`. Omitting them selects all spaces; an empty selector matches none. Results include pack/rule versions, entity IDs, measured/required values, message and `PASS`, `FAIL`, `NOT_APPLICABLE` (no matching entities) or `NOT_EVALUATED` (missing, unsupported or inconsistent necessary geometry/semantics). Unevaluated policies add warnings, never PASS. A policy FAIL uses its declared severity, separately from core geometry errors. No policies are applied by default.

## Independence and coverage

See [Phase 11 implementation and verification](../../docs/PHASE11.md) for the exact reused primitives, test evidence, full coverage matrix, versioning, limitations and modified baseline files.

Notable boundaries: V2 point anchors are explicit points without semantic attachment to an overall envelope; centerline dimensions are not clear room dimensions; nonorthogonal wall solids, watertight junctions, multi-plate support unions and general 3D booleans are not claimed. Stair interference uses a conservative full-flight envelope, not stepped 3D solids or measured headroom. Site setbacks are evaluated only for rectangular axis-aligned sites. No rule implies structural, municipal, fire, accessibility or professional certification.

## Resource bounds

Preflight accepts plain acyclic JSON (including frozen data), at most 2,000,000 visited nodes, depth 24, string length 10,000, array length 8,192 and ring length 256. V2's tighter field-specific limits still apply. Schema ring/footprint work has a 20,000,000 estimate cap before polygon refinements. Semantic geometry has a deterministic operation budget, default 20,000,000, configurable as `maxGeometryWork` from 1 to 100,000,000. Pairwise checks charge work; polygon operations charge a conservative vertex-product estimate. This is a deterministic resource counter, not a CPU-time estimate.

Core findings and evaluated rule results are capped at 10,000 each. Exceeding a cap emits `QA_RESOURCE_LIMIT`, marks the current stage PARTIAL, stops later stages and records remaining policies as NOT_EVALUATED (up to the bounded 8,192 selected rules). Schema issue truncation explicitly reports the original issue count. No truncated audit can return PASS. Large but structurally valid V2 documents can therefore receive a bounded incomplete audit instead of consuming unbounded resources.

Major work: same-level space pairs; same-level wall intervals/solids; hosted opening pairs; slab pairs; wall/space boundary relationships; stair/plate/wall/column interference. Polygon bounding boxes reject disjoint pairs before exact overlap predicates. Graph traversal uses adjacency lists and is linear in nodes plus edges. There is no general spatial index at the current tested residential scale.

Run `npm run test:blueprint-qa` from the repository root. Production dependency boundaries are enforced by an AST import test; generator fixtures appear only in tests.

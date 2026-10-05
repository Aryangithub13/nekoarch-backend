# NekoArch Backend Audit (Phases 1–23) — Confirmed Defect Ledger (D01–D21)

This document contains the authoritative, adversarial defect ledger for the NekoArch backend across Phases 1 through 23. Every defect recorded below has undergone the required 7-step back-and-forth analysis and is confirmed with source, runtime, or mathematical evidence.

---

## D01 — Conversation State Contradiction Eradication on Unrelated Turns

- **Severity:** P1 (High)
- **Affected phase(s):** Phase 20 (Conversational Architectural Intelligence)
- **Affected subsystem:** Conversation Planner State Machine
- **Files:** [`apps/api/src/ai/conversation-planner.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/ai/conversation-planner.ts#L214)
- **Public impact:** An end user presenting contradictory constraints (e.g., "one floor and two floors") has their safety guardrail silently dismantled on any follow-up turn (e.g. typing "next" or "proceed"), resulting in an arbitrary building proposal being submitted for approval without resolving the architectural contradiction.
- **Security impact:** None.
- **Data-integrity impact:** Generates and proposes unverified, self-contradictory architectural configurations.
- **Initial hypothesis:** Conversation intent contradictions might be wiped when a new turn generates an empty contradiction patch.
- **Evidence supporting defect:** In `apps/api/src/ai/conversation-planner.ts:214`:
  ```typescript
  state.intent = ConversationIntentSchema.parse({
    ...state.intent,
    ...patch,
    unsupported: [],
    contradictions: patch.contradictions,
  });
  ```
  In Turn 1, contradictory requirements populate `state.intent.contradictions = ['floors']`, putting conversation into `NEEDS_CLARIFICATION`. On Turn 2, the user submits `"seed next"`. `patch.contradictions` is evaluated as `[]`. Because line 214 assigns `contradictions: patch.contradictions`, the existing unresolved contradiction is overwritten with `[]`.
- **Evidence against defect:** It was hypothesized that `normalizeConversationState` or `applyNative` would re-detect the contradiction on the second turn. However, Turn 2's parser does not re-parse the previous message text; it only processes the new turn text, meaning the earlier contradiction is lost forever.
- **Reproduction:**
  1. Start conversation with: `"10m by 12m plot, one floor and two floors, 2 bedrooms"`. Output: `status: "NEEDS_CLARIFICATION"`, `contradictions: ["floors"]`.
  2. Send follow-up: `"seed next"`.
  3. Output: `status: "AWAITING_APPROVAL"`, `contradictions: []`, `floors: 2`. Deterministically reproduced.
- **Counter-check:** Tested providing a direct resolution: `"i meant two floors"`. In this case, `patch.contradictions` is empty and the user's intent is clarified, which is valid. But sending an unrelated prompt should preserve the clarification request.
- **Expected behavior:** Unresolved contradictions must persist in `state.intent.contradictions` until the user provides a message that explicitly resolves them.
- **Actual behavior:** Any unrelated follow-up message erases all contradictions and transitions the conversation directly to `AWAITING_APPROVAL`.
- **Root cause:** Direct assignment of `patch.contradictions` instead of a persistent union/set that only removes resolved contradiction fields.
- **Why existing tests missed it:** Existing tests in `conversation-planner.test.ts` only tested single-turn contradiction detection or immediate contradiction resolution; no test evaluated an unrelated follow-up turn following a contradiction.
- **Recommended repair direction:** Retain unresolved contradiction keys in `state.intent.contradictions` unless `patch` contains an explicit resolution for that field.
- **Regression tests required:** Multi-turn conversation test verifying that unrelated messages (e.g., `"seed next"`, `"add kitchen"`) do not clear existing contradictions in `state.intent.contradictions`.
- **Cross-phase risks:** Contradictory requirements can leak into Phase 6/19/22 generator pipelines.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D02 — Conversation Unit Correction Retains Stale Site Depth Unit

- **Severity:** P1 (High)
- **Affected phase(s):** Phase 20 (Conversational Architectural Intelligence)
- **Affected subsystem:** Conversation Planner Unit Resolution
- **Files:** [`apps/api/src/ai/conversation-planner.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/ai/conversation-planner.ts#L200-L203)
- **Public impact:** Users correcting plot dimensions (e.g. changing from feet to metres) end up with buildings generated on distorted sites because depth remains locked to feet, shrinking plot depth by ~70%.
- **Security impact:** None.
- **Data-integrity impact:** Corrupts spatial site boundary coordinates in generated proposals.
- **Initial hypothesis:** The conversation planner fails to clear `depthUnit` when a general unit correction is supplied.
- **Evidence supporting defect:** In Phase 18 (`apps/api/src/ai/architectural-interpreter.ts:66`), correcting site units explicitly deletes `c.site.depthUnit`:
  ```typescript
  if (a.field === 'site.unit') { patch.site.unit = a.value; delete patch.site.depthUnit; }
  ```
  However, in Phase 20 `apps/api/src/ai/conversation-planner.ts:200-203`:
  ```typescript
  if (a.field === 'site.unit') patch.site = { ...state.intent.site, width: state.intent.site?.width ?? '', depth: state.intent.site?.depth ?? '', unit: a.value };
  ```
  `depthUnit` is never cleared. When `applyNative` executes at line 89:
  ```typescript
  const d = toMillimetres(c.site.depth, c.site.depthUnit ?? c.site.unit);
  ```
  `c.site.depthUnit` is still `'ft'`, so depth is converted using feet instead of metres.
- **Evidence against defect:** If the user explicitly typed `"metres for depth"`, it would overwrite `depthUnit`. But a general correction `"i meant metres"` is intended to normalize the entire plot.
- **Reproduction:**
  1. Input: `"10 m by 20 ft, 2 bedrooms"`. Initial site: `10000 x 6096 mm`.
  2. Input: `"i meant metres"`.
  3. Result: Site width is `10000 mm`, but site depth remains `6096 mm` instead of `20000 mm`.
- **Counter-check:** If both width and depth originally shared the same unit, `depthUnit` was undefined and the correction worked. The defect triggers only on mixed-unit inputs.
- **Expected behavior:** A unit correction must reset `depthUnit` to undefined so the new primary unit governs both dimensions.
- **Actual behavior:** `depthUnit` persists indefinitely, keeping depth converted from feet.
- **Root cause:** Incomplete port of Phase 18 unit clearing logic into Phase 20 `applyIntentPatch`.
- **Why existing tests missed it:** Unit correction tests only tested cases where both dimensions originally shared the same unit.
- **Recommended repair direction:** Add `delete patch.site.depthUnit;` in `apps/api/src/ai/conversation-planner.ts:202`.
- **Regression tests required:** Mixed-unit conversation follow-up test asserting depth expands to metric dimensions upon unit correction.
- **Cross-phase risks:** Causes site dimension errors in Phase 6/19 generators and Phase 10 Blueprint QA site setback checks.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D03 — Case-Sensitive Plural Room Name Matching Rejects Valid Updates

- **Severity:** P2 (Medium)
- **Affected phase(s):** Phase 20 (Conversational Architectural Intelligence)
- **Affected subsystem:** Natural Language Intent Parser
- **Files:** [`apps/api/src/ai/conversation-planner.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/ai/conversation-planner.ts#L48)
- **Public impact:** Users typing uppercase or capitalized plural commands (e.g., `"BEDROOMS 3m by 4m"`) receive a false error saying the room reference is ambiguous.
- **Security impact:** None.
- **Data-integrity impact:** Unwarranted rejection of valid user modifications.
- **Initial hypothesis:** Plural room detection in `parseMessage` uses case-sensitive matching on the captured group.
- **Evidence supporting defect:** In `apps/api/src/ai/conversation-planner.ts:48`:
  ```typescript
  allOfType: name.endsWith('s')
  ```
  The regular expression at line 45 has the `/i` flag, matching `"BEDROOMS"`. However, the capture variable `name` is the verbatim string `"BEDROOMS"`. `"BEDROOMS".endsWith('s')` evaluates to `false` because `'S' !== 's'`. As a result, `allOfType` is set to `false`. In `applyNative` (line 64), because there are multiple bedrooms, it triggers: `"The bedroom reference is ambiguous or absent. Specify all rooms of that type or an explicit native group update."`
- **Evidence against defect:** If the user types in lowercase `"bedrooms"`, it succeeds.
- **Reproduction:**
  1. Have a 2-bedroom plan.
  2. Send: `"make the BEDROOMS 3m by 4m"`.
  3. Result: Rejected with ambiguity error. Send: `"make the bedrooms 3m by 4m"`. Result: Accepted.
- **Counter-check:** Tested singular uppercase (`"BEDROOM"`): works because `allOfType` is expected to be false for a single bedroom. The issue is strictly plural uppercase.
- **Expected behavior:** Case-insensitive check `name.toLowerCase().endsWith('s')`.
- **Actual behavior:** Evaluates to false for uppercase plural, rejecting valid requests.
- **Root cause:** Missing `.toLowerCase()` before checking `.endsWith('s')`.
- **Why existing tests missed it:** Test cases exclusively used lowercase strings (`"bedrooms"`).
- **Recommended repair direction:** Change line 48 to `allOfType: name.toLowerCase().endsWith('s')`.
- **Regression tests required:** Test `"BEDROOMS 3m by 4m"` and verify `allOfType: true` and successful room update.
- **Cross-phase risks:** None (confined to conversation planner).
- **Final verdict:** **CONFIRMED DEFECT**

---

## D04 — Floor Count Reduction in Conversation Rejected Due to Stale Stair Requirement

- **Severity:** P2 (Medium)
- **Affected phase(s):** Phase 20 (Conversational Architectural Intelligence)
- **Affected subsystem:** Conversation Planner / Blueprint Integration
- **Files:** [`apps/api/src/ai/conversation-planner.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/ai/conversation-planner.ts#L82), [`packages/generator/src/blueprint/input.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/packages/generator/src/blueprint/input.ts#L57)
- **Public impact:** Users cannot change a 2-floor conversation proposal to 1 floor via natural language (`"make it one floor"`), because the conversation planner crashes against the generator requirements schema.
- **Security impact:** None.
- **Data-integrity impact:** Prevents valid design exploration and floor reductions.
- **Initial hypothesis:** Lowering floor count from 2 to 1 leaves the 2-floor stair configuration in `r.stair`, violating BlueprintRequirementsSchema.
- **Evidence supporting defect:** In `packages/generator/src/blueprint/input.ts:57`:
  ```typescript
  if (r.floors === 1 && r.stair) issue(['stair'], 'Stair configuration requires two floors');
  ```
  In `apps/api/src/ai/conversation-planner.ts:82`:
  ```typescript
  if (c.floors !== undefined) {
    if (c.floors === 1 || c.floors === 2) r.floors = c.floors;
    else questions.push('Only one or two floors are supported.');
  }
  ```
  Notice that when `c.floors === 1`, `r.stair` is not deleted. At line 258, `normalizeBlueprintForVersion(r, ...)` throws `INVALID_REQUIREMENTS` because `r.floors === 1` and `r.stair` is present. Line 259 catches this and emits: `"The proposed changes conflict with the native room, site, floor or relationship constraints"`.
- **Evidence against defect:** It was argued that the user must explicitly say `"remove stairs and make it one floor"`. But stairs are an automatic consequence of two floors in NekoArch defaults.
- **Reproduction:**
  1. Propose standard 2-floor building (has `stair` generated).
  2. Send: `"make it one floor"`.
  3. Result: Planner returns clarification question complaining of conflicting constraints; floor count is not changed.
- **Counter-check:** Changing from 1 floor to 2 floors works because line 79 of `input.ts` automatically synthesizes a stair if missing.
- **Expected behavior:** Reducing floors to 1 should automatically remove `r.stair` (or set `delete r.stair`).
- **Actual behavior:** Throws schema validation error and rejects user intent.
- **Root cause:** Failure to clean up stairs when transitioning `r.floors` from 2 to 1 in `applyNative`.
- **Why existing tests missed it:** Existing tests tested floor count selection on fresh requirements, not conversational reduction on pre-existing 2-floor requirements.
- **Recommended repair direction:** In `apps/api/src/ai/conversation-planner.ts:82`, add `if (c.floors === 1) delete r.stair;`.
- **Regression tests required:** Turn-by-turn test reducing 2-floor plan to 1 floor without explicit stair removal.
- **Cross-phase risks:** None.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D05 — Package Script test:ifc Fails Due to Unbound Python Runtime

- **Severity:** P2 (Medium)
- **Affected phase(s):** Phase 23 (BIM / IFC)
- **Affected subsystem:** Tooling, Testing & CI/CD Verification
- **Files:** [`package.json`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/package.json#L49)
- **Public impact:** Developers and automated CI pipelines running the documented `npm run test:ifc` command fail immediately with a Python `ModuleNotFoundError`.
- **Security impact:** None.
- **Data-integrity impact:** Inability to run automated IFC geometry validation tests.
- **Initial hypothesis:** `package.json` invokes system `python3` instead of the virtualenv where `ifcopenshell` was installed.
- **Evidence supporting defect:** Line 49 of `package.json`:
  ```json
  "test:ifc": "python3 scripts/verify-ifc.py"
  ```
  Running `npm run test:ifc` on the audit host fails with:
  ```
  ModuleNotFoundError: No module named 'ifcopenshell'
  ```
  The functional Python environment containing `ifcopenshell` is located at `/tmp/designflow-phase23-ifc/bin/python`.
- **Evidence against defect:** If `ifcopenshell` were installed in the global system Python site-packages, the script would succeed. However, this repository does not specify or ensure this virtualenv in its npm scripts or setup instructions.
- **Reproduction:**
  1. Run `npm run test:ifc`. Deterministic exit code 1.
  2. Run `/tmp/designflow-phase23-ifc/bin/python scripts/verify-ifc.py`. All 7 tests pass.
- **Counter-check:** Tested all other test scripts (`npm run test:unit`, `npm run test:bim`, `npm run test:parametric`); all succeed.
- **Expected behavior:** `package.json` should use an environment variable or relative venv path (`${VIRTUAL_ENV:-...}/bin/python3`) with clear fallback and setup documentation.
- **Actual behavior:** Hardcoded to `python3`, failing by default on systems with isolated virtualenvs.
- **Root cause:** Hardcoded invocation of unprovisioned global `python3`.
- **Why existing tests missed it:** Test was likely only run manually in the author's local shell where the virtualenv was activated.
- **Recommended repair direction:** Update script to detect virtualenv or document venv activation in `README.md`.
- **Regression tests required:** Verification in clean CI runner.
- **Cross-phase risks:** None.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D06 — Canonical Building Identity Ignores Stair Landing Ordering

- **Severity:** P2 (Medium)
- **Affected phase(s):** Phase 17 (Generation Identity) & Phase 23 (BIM)
- **Affected subsystem:** Generation Identity & Canonicalization
- **Files:** [`apps/api/src/lib/generation-identity.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/lib/generation-identity.ts#L21), [`supabase/migrations/0011_generation_freshness.sql`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/supabase/migrations/0011_generation_freshness.sql#L7-L13)
- **Public impact:** Two geometrically identical buildings whose stairs have landings listed in different array orders produce different `modelHash` values, breaking deduplication, caching, and causing `BIM_SOURCE_MISMATCH` errors when reading BIM models.
- **Security impact:** None.
- **Data-integrity impact:** Canonical model hashing fails to be truly canonical.
- **Initial hypothesis:** `canonicalBuilding` sorts top-level arrays by ID, but forgets nested child arrays like `stair.landings`.
- **Evidence supporting defect:** In `apps/api/src/lib/generation-identity.ts:21`:
  ```typescript
  stairs: byId(model.stairs)
  ```
  `byId` sorts the `stairs` array by `stair.id`. However, inside each `stair` object, `stair.landings` is an array of landing objects with `id` properties (`LandingSchema = z.object({ id: z.string(), ... })`). The nested `landings` array is never sorted by ID. If two workers or exporters serialize landings in reverse order, `modelHash(a) !== modelHash(b)`.
- **Evidence against defect:** It was argued that stairs are generated with deterministic landing orders. However, `canonicalBuilding` is explicitly contracted to produce identical hashes regardless of object key order or array input order.
- **Reproduction:**
  1. Take a valid model with a stair containing two landings: `[L1, L2]`.
  2. Clone the model and reverse landings: `[L2, L1]`.
  3. Run `canonicalBuilding(m1)` and `canonicalBuilding(m2)`.
  4. Compare `modelHash(m1)` vs `modelHash(m2)`. Diagnostic result: `equal: false`.
- **Counter-check:** Tested reversing spaces, walls, and slabs: all produce identical hashes because top-level arrays are sorted. Only nested arrays fail.
- **Expected behavior:** `modelHash` must be invariant to the order of nested landing elements.
- **Actual behavior:** Inverted landing order alters the SHA-256 hash.
- **Root cause:** Omission of `stair.landings: byId(stair.landings)` in `canonicalBuilding` and PostgreSQL `canonical_building_model`.
- **Why existing tests missed it:** Standard test fixtures only created stairs with a single landing or fixed generator output.
- **Recommended repair direction:** In `generation-identity.ts` and `0011_generation_freshness.sql`, map `stair.landings: byId(stair.landings)`.
- **Regression tests required:** Test comparing hashes of models with scrambled landing orders.
- **Cross-phase risks:** Affects Phase 17 freshness checks, Phase 12 revision deduplication, and Phase 23 BIM source verification.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D07 — Omitted Optional spaceIds Disconnects BIM and IFC Space Boundaries

- **Severity:** P2 (Medium)
- **Affected phase(s):** Phase 23 (BIM / IFC)
- **Affected subsystem:** BIM Semantic Projection & IFC Export
- **Files:** [`apps/api/src/bim/project.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/bim/project.ts#L33, #L41), [`apps/api/src/bim/ifc.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/bim/ifc.ts#L114)
- **Public impact:** Valid architectural models exported to IFC or BIM graph format have their rooms geometrically detached from surrounding walls; structural simulation and space boundary analysis in tools like Revit or Solibri report 0 bounded spaces.
- **Security impact:** None.
- **Data-integrity impact:** Generates incomplete and topologically disconnected BIM and IFC models.
- **Initial hypothesis:** Because `wall.spaceIds` is optional in `BuildingModelV2`, omitting it causes `projectBim` to drop all boundary and access edges without geometric reconstruction.
- **Evidence supporting defect:** In `packages/shared/src/building-v2/contracts.ts`, `WallSchema` defines:
  ```typescript
  spaceIds: z.array(z.string().min(1).max(64)).max(2).optional()
  ```
  In `apps/api/src/bim/project.ts:33`:
  ```typescript
  for (const space of wall.spaceIds ?? []) edge('bounds', wallId, id('space', space));
  ```
  And in `apps/api/src/bim/ifc.ts:114`:
  `IfcRelSpaceBoundary` is generated strictly from the BIM graph `'bounds'` edges.
  When `wall.spaceIds` is omitted, `bounds` count is 0, `accesses` count is 0, and `IfcRelSpaceBoundary` count is 0.
- **Evidence against defect:** It was argued that the generator always provides `spaceIds`. However, `apps/api/src/bim/core.ts:sourceModel` explicitly validates arbitrary `BuildingModelV2` inputs from revisions and supplied sources. The contract allows optional `spaceIds`, but BIM projection silently degrades to an incomplete graph.
- **Reproduction:**
  1. Pass valid `BuildingModelV2` where walls omit `spaceIds`.
  2. Model passes QA with `PASS`.
  3. BIM projection reports `bounds: 0`, `spaceBoundaries: 0` in `diagnostics.json`.
- **Counter-check:** When `spaceIds` is present, 8 space boundaries and 3 accesses are generated.
- **Expected behavior:** BIM projection should either geometrically infer wall-space adjacency from 2D boundary polygons when `spaceIds` is absent, or QA/source validation should require `spaceIds` before accepting for BIM projection.
- **Actual behavior:** Silently emits a detached IFC model with no space boundaries.
- **Root cause:** Direct reliance on an optional metadata field without geometric fallback or strict validation.
- **Why existing tests missed it:** Existing tests only tested models produced directly by `generateBlueprintV2`, which always populates `spaceIds`.
- **Recommended repair direction:** Implement polygonal contact fallback between walls and space perimeters in `projectBim` when `wall.spaceIds` is omitted or empty.
- **Regression tests required:** IFC export test on a model without `spaceIds` asserting non-zero `IfcRelSpaceBoundary` entities.
- **Cross-phase risks:** Affects downstream BIM consumers and IFC viewers.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D08 — Coincident Columns Bypass Invariants and QA to Contaminate Downstream Subsystems

- **Severity:** P1 (High)
- **Affected phase(s):** Phase 9, Phase 11, Phase 13, Phase 15, Phase 23
- **Affected subsystem:** Building Model Invariants, Blueprint QA & BIM Projection
- **Files:** [`packages/shared/src/building-v2/invariants.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/packages/shared/src/building-v2/invariants.ts#L110-L116), [`packages/blueprint-qa/src/core.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/packages/blueprint-qa/src/core.ts#L161-L169)
- **Public impact:** Duplicate structural columns pass all validation and commit to permanent project revisions, causing double-counted structural concrete and rebar costs in estimates, and then causing unexpected 422 `BIM_UNSUPPORTED_MODEL` failures when opening the 3D BIM view.
- **Security impact:** None.
- **Data-integrity impact:** Corrupted project revisions, inaccurate quantities, and unviewable BIM models.
- **Initial hypothesis:** Column collision is never checked against other columns in either invariants or Blueprint QA.
- **Evidence supporting defect:**
  In `packages/shared/src/building-v2/invariants.ts`:
  - Walls have pairwise collision checks (lines 75-85).
  - Openings have pairwise collision checks (lines 90-95).
  - Slabs have pairwise collision checks (lines 100-109).
  - Spaces have pairwise collision checks (lines 120-125).
  - Columns (lines 110-116) only check whether the column lies inside the site and inside a slab. **There is NO loop checking column-column overlap!**
  Similarly, in `packages/blueprint-qa/src/core.ts:161-169`, columns are only checked for containment within slabs.
- **Evidence against defect:** It was asked whether columns can legitimately overlap. In structural architecture, coincident duplicate columns are impossible physical defects that violate geometry integrity.
- **Reproduction:**
  1. Create a model with two identical columns at the exact same coordinates `(x: 2000, z: 2000)` on Level 0.
  2. Run `validateBuildingInvariants`: returns 0 errors.
  3. Run `auditBlueprint`: returns status `PASS`, 0 errors, 0 warnings.
  4. Commit to database: successfully creates project revision (status 201).
  5. Attempt to project BIM via `readBim`: throws `BIM_UNSUPPORTED_MODEL` (status 422).
- **Counter-check:** Overlapping walls or overlapping spaces fail invariants and QA immediately. Only columns have this blind spot.
- **Expected behavior:** Invariants and Blueprint QA must detect and reject overlapping or duplicate columns.
- **Actual behavior:** Passes QA with flying colors, corrupts quantity calculations, and crashes BIM projection.
- **Root cause:** Missing column-column collision detection loop in both `invariants.ts` and `blueprint-qa/src/core.ts`.
- **Why existing tests missed it:** No test suite added duplicate columns to a test fixture.
- **Recommended repair direction:** Add pairwise column AABB/polygonal intersection check in `invariants.ts` and `core.ts`.
- **Regression tests required:** Unit test asserting `QA_COLUMN_OVERLAP` or invariant rejection on coincident columns.
- **Cross-phase risks:** Contaminates Phase 13 (Takeoffs), Phase 14 (Concrete volume), Phase 15 (BOQ cost), and Phase 23 (BIM).
- **Final verdict:** **CONFIRMED DEFECT**

---

## D09 — Core Blueprint QA Overlooks Slab Voids Under Occupied Spaces

- **Severity:** P1 (High)
- **Affected phase(s):** Phase 11 (Independent Blueprint QA)
- **Affected subsystem:** Blueprint QA Core (`slabsColumnsAudit`)
- **Files:** [`packages/blueprint-qa/src/core.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/packages/blueprint-qa/src/core.ts#L170-L181)
- **Public impact:** Structurally invalid buildings with giant floor holes directly under bedrooms or living rooms are certified as valid by independent QA and committed to user projects.
- **Security impact:** None.
- **Data-integrity impact:** Physically uninhabitable buildings are marked as QA-compliant.
- **Initial hypothesis:** Blueprint QA checks slab outer boundary but ignores slab voids when auditing space containment.
- **Evidence supporting defect:** In `packages/blueprint-qa/src/core.ts:170-181`:
  ```typescript
  for (const space of spacesOnLevel) {
    const supported = slabsOnLevel.some(s => s.kind === 'floor' && polygonContains(s.footprint.outer, space.boundary));
    if (!supported) record('QA_UNSUPPORTED_SPACE', ...);
  }
  ```
  The check ONLY tests `polygonContains(s.footprint.outer, space.boundary)`. It completely ignores `s.footprint.voids`!
  (Note: Phase 22 introduced an opt-in parametric check `OCCUPIED_VOID`, but that is only executed if `model.parametricArchitecture` is present!). Standard BuildingModelV2 models are audited exclusively by core QA, allowing a floor slab with a void spanning the entire bedroom to receive a clean `PASS`.
- **Evidence against defect:** It was argued that voids might be stair shafts. But stair shafts are circulation/stairwells, not occupied bedrooms/living spaces, and stair shafts are checked separately.
- **Reproduction:**
  1. Create a model with a 15m² floor void inside the floor slab directly beneath a studio/bedroom.
  2. Run `auditBlueprint(model)`.
  3. Result in `diagnostics.json`: `status: "PASS"`, `errors: []`, `warnings: []`.
  4. Commit to database: accepted and persisted as revision.
- **Counter-check:** In Phase 22 parametric models, `OCCUPIED_VOID` is caught because `parametricAudit` checks voids. The bug is that core QA does not have this check.
- **Expected behavior:** Core Blueprint QA must reject models where occupied spaces (bedrooms, living rooms, kitchens, bathrooms) intersect floor slab voids.
- **Actual behavior:** Silently passes QA with 0 errors.
- **Root cause:** `slabsColumnsAudit` in `core.ts` omitted void polygon intersection testing against space boundaries.
- **Why existing tests missed it:** Standard generator tests only produced slab voids for stair openings.
- **Recommended repair direction:** Port the `OCCUPIED_VOID` polygonal intersection logic into `slabsColumnsAudit` in `packages/blueprint-qa/src/core.ts`.
- **Regression tests required:** Test asserting `QA_OCCUPIED_SLAB_VOID` when an occupied space overlaps a slab void in a non-parametric model.
- **Cross-phase risks:** Affects Phase 11, Phase 12, and Phase 23.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D10 — BIM Core Rejects Valid Architectural Models Containing Columns

- **Severity:** P2 (Medium)
- **Affected phase(s):** Phase 23 (BIM / IFC)
- **Affected subsystem:** BIM Core Source Validation
- **Files:** [`apps/api/src/bim/core.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/bim/core.ts#L33)
- **Public impact:** Projects featuring structural columns (which are fully valid in BuildingModelV2, Takeoffs, and BOQ Cost) cannot be viewed in 3D BIM or exported to IFC; any call to `/api/projects/:projectId/bim` fails with 422 `BIM_UNSUPPORTED_MODEL`.
- **Security impact:** None.
- **Data-integrity impact:** Prevents valid architectural projects from exporting to industry-standard BIM/IFC formats.
- **Initial hypothesis:** BIM source validator contains an intentional or accidental blanket ban on models with columns.
- **Evidence supporting defect:** In `apps/api/src/bim/core.ts:33`:
  ```typescript
  if (m.levels.length > 2 || ... || m.columns.length || ...)
    throw new BimError('BIM_UNSUPPORTED_MODEL', 'Model exceeds the bounded architectural profile');
  ```
  Notice `m.columns.length`. If `m.columns` has any elements (i.e. length > 0), it unconditionally throws `BIM_UNSUPPORTED_MODEL`!
  Yet `ColumnSchema` is a core element of `BuildingModelV2`, supported in Phase 9, validated in Phase 11, measured in Phase 13, and priced in Phase 15.
- **Evidence against defect:** It was argued that Phase 23 only intended to support column-free residential buildings. However, columns are already supported in the schema, and rejecting all columns prevents real-world architectural models from utilizing the BIM viewer.
- **Reproduction:**
  1. Add a single valid column to a valid `BuildingModelV2`.
  2. Call `sourceModel(model)` in `apps/api/src/bim/core.ts`.
  3. Throws `BIM_UNSUPPORTED_MODEL`.
- **Counter-check:** Removing the column allows the model to immediately project to BIM and export to IFC cleanly.
- **Expected behavior:** Structural columns should either be projected into BIM as `IfcColumn` or at minimum permitted within bounded limits (e.g. `m.columns.length > 32`).
- **Actual behavior:** Any column presence causes hard failure.
- **Root cause:** Premature restriction `m.columns.length` in `bim/core.ts`.
- **Why existing tests missed it:** Test fixtures in `test:bim` had empty columns arrays.
- **Recommended repair direction:** Remove `m.columns.length` check or project columns into BIM elements.
- **Regression tests required:** Test calling `projectBim` on a model with columns.
- **Cross-phase risks:** Incompatibility between Phase 9/13/15 and Phase 23.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D11 — Abandoned Message Lease Blocks Subsequent Conversation Interactions

- **Severity:** P1 (High)
- **Affected phase(s):** Phase 20 (Conversational Architectural Intelligence)
- **Affected subsystem:** Conversation Message Concurrency & Lease Fencing
- **Files:** [`apps/api/src/routes/conversations.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/routes/conversations.ts#L58-L67)
- **Public impact:** If a user submits a prompt that fails validation (e.g., requesting 5 floors) or if an AI provider times out, the conversation locks up. For the next 60 seconds, every subsequent message sent by the user is rejected with HTTP 409 `MESSAGE_IN_PROGRESS`.
- **Security impact:** Low DoS risk (conversation self-lockout).
- **Data-integrity impact:** Stale concurrency lock blocks conversation workflow.
- **Initial hypothesis:** The message route handler acquires a lease in PostgreSQL but does not release it if an error occurs.
- **Evidence supporting defect:** In `apps/api/src/routes/conversations.ts:56-67`:
  ```typescript
  const conversations = new ConversationRepository(repository, userId!, env.PROJECT_COMMIT_SECRET), token = randomUUID();
  const acquired = await conversations.write('acquire', { ...params, leaseToken: token });
  const planned = await planConversation(...);
  return ConversationSchema.parse(await conversations.write('message', ...));
  ```
  Contrast this with proposal approval in `conversations.ts:88`:
  ```typescript
  try { ... } catch (error) {
    await conversations.write('release', { ...params, leaseToken: token }).catch(() => {});
    throw error;
  }
  ```
  The message endpoint has **NO `try...finally` block**! When `planConversation` throws or an upstream call aborts, `conversations.write('release')` is NEVER called. In PostgreSQL `public.conversations`, `pending_token` remains non-null with `lease_expires_at = clock_timestamp() + interval '1 minute'`.
- **Evidence against defect:** It was argued that the 60-second lease will eventually expire. However, in interactive chat UX, making a user wait 60 seconds after a typo or 422 error is an unacceptable failure state.
- **Reproduction:**
  1. Call POST `/api/projects/:id/conversations/:id/messages` with input that triggers an error.
  2. Handler returns HTTP 422.
  3. Immediately send a valid message.
  4. Response: HTTP 409 Conflict, code `MESSAGE_IN_PROGRESS`. (Verified in `database-diagnostics.json`).
- **Counter-check:** Proposal approval handles errors and releases the lease cleanly.
- **Expected behavior:** Message route must release the lease in a `try...finally` or `catch` block on failure.
- **Actual behavior:** Leaves lease active in PostgreSQL, locking the conversation for 60 seconds.
- **Root cause:** Missing `try...catch` / `release` in message route handler.
- **Why existing tests missed it:** Existing tests only tested successful messages or waited until leases expired.
- **Recommended repair direction:** Wrap message planning in `try...catch` and invoke `conversations.write('release')` on error.
- **Regression tests required:** Test sending a failing message followed immediately by a valid message; valid message must succeed immediately.
- **Cross-phase risks:** Blocks conversation flow in Phase 20.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D12 — TOCTOU Race Condition in conversation_write('finish')

- **Severity:** P1 (High)
- **Affected phase(s):** Phase 20 (Conversational Architectural Intelligence)
- **Affected subsystem:** Database Concurrency & Project Revisions
- **Files:** [`supabase/migrations/0012_conversations.sql`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/supabase/migrations/0012_conversations.sql#L63, #L77, #L95)
- **Public impact:** When two users or workflows work concurrently, a proposal in a conversation can be approved against an obsolete project revision, overwriting or branching off the wrong historical revision without detection.
- **Security impact:** None.
- **Data-integrity impact:** Corrupts revision ancestry and project history.
- **Initial hypothesis:** `conversation_write` reads `public.projects` before acquiring the row lock on `public.conversations`, creating a Time-Of-Check to Time-Of-Use race condition in `READ COMMITTED` transactions.
- **Evidence supporting defect:** In `supabase/migrations/0012_conversations.sql`:
  - Line 63: `select * into p from public.projects where id=project_id;` (No `FOR UPDATE` or `FOR SHARE` lock).
  - Line 77: `select * into c from public.conversations where id=... for update;` (Row lock is acquired HERE).
  - Line 95: `if (prop->>'baseRevisionId' is not null and prop->>'baseRevisionId'<>p.current_revision_id::text) then raise exception ...`
  If another transaction commits a new revision to `public.projects` while transaction 1 is waiting at line 77 for the conversation lock, `p` remains bound to the stale initial snapshot! Line 95 compares against `p.current_revision_id` from the stale snapshot, bypassing the check and allowing the proposal to finish.
- **Evidence against defect:** It was argued that `SERIALIZABLE` isolation would catch it. However, Supabase/PostgreSQL connections default to `READ COMMITTED`.
- **Reproduction:**
  1. Start `conversation_write('finish')` with `baseRevisionId: R1`.
  2. Concurrently commit revision `R2` to the project.
  3. Result: Transaction accepts proposal as valid against `R1` despite project already advancing to `R2`. (Verified in `database-diagnostics.json`).
- **Counter-check:** If `select * into p from public.projects ... for update` is executed after acquiring the conversation lock, the check immediately catches the mismatch.
- **Expected behavior:** Project state must be read and locked under the same transaction boundary after acquiring conversation locks.
- **Actual behavior:** Reads project snapshot early, allowing stale revision commits.
- **Root cause:** Premature unlocked `SELECT` into `p` before locking the conversation row.
- **Why existing tests missed it:** Existing tests were sequential single-user tests.
- **Recommended repair direction:** Re-select `p` with `FOR SHARE` or `FOR UPDATE` after locking `c` at line 77.
- **Regression tests required:** Concurrent test interleaving revision commit and proposal approval.
- **Cross-phase risks:** Affects Phase 12 (Revisions) and Phase 20 (Conversations).
- **Final verdict:** **CONFIRMED DEFECT**

---

## D13 — Sentry Telemetry Drops All Phase 6–23 Routes and Engine Stack Frames

- **Severity:** P2 (Medium)
- **Affected phase(s):** Phase 8, Phase 20, Phase 21, Phase 22, Phase 23
- **Affected subsystem:** Telemetry & Production Observability
- **Files:** [`apps/api/src/lib/sentry.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/lib/sentry.ts#L28, #L34)
- **Public impact:** Critical backend crashes in production occurring within Blueprint QA, Quantity Takeoffs, Construction Calculations, BOQ Costing, Parametric Solvers, or BIM/IFC export produce blank stack traces in Sentry and have their route tags scrubbed, blinding operations.
- **Security impact:** Degrades security incident response and auditability.
- **Data-integrity impact:** None directly, but severely impedes defect diagnosis.
- **Initial hypothesis:** Sentry event sanitization has hardcoded whitelists from Phase 5 that were never updated for subsequent phases.
- **Evidence supporting defect:** In `apps/api/src/lib/sentry.ts:28`:
  ```typescript
  const allowedRoutes = new Set(['/api/plans', '/api/plans/generate', '/api/estimates', '/api/projects', '/api/projects/:projectId']);
  ```
  Every route introduced in Phase 6 through 23 (such as `/api/projects/:projectId/revisions`, `/api/projects/:projectId/conversations`, `/api/projects/:projectId/workflows`, `/api/projects/:projectId/bim/ifc`) is absent from this set!
  At line 30: `if (!allowedRoutes.has(route)) event.tags.route = undefined;`.
  Furthermore, line 34 filters stack frames:
  ```typescript
  frame.filename?.includes('apps/api') || frame.filename?.includes('packages/shared') || frame.filename?.includes('packages/generator')
  ```
  Every stack frame originating from `packages/blueprint-qa`, `packages/quantity-takeoff`, `packages/construction-calculations`, or `packages/boq-cost` is stripped out!
- **Evidence against defect:** It was argued that the whitelist was intended to prevent route parameter PII leakage. However, fastify route patterns (e.g. `/api/projects/:projectId/revisions`) contain no PII.
- **Reproduction:**
  1. Trigger an error inside `/api/projects/:projectId/workflows` inside `packages/boq-cost`.
  2. Pass event through `sanitizeEvent(event)`.
  3. Result: `event.tags.route === undefined`, and all frames from `packages/boq-cost` are deleted. (Verified in `edge-diagnostics.json`).
- **Counter-check:** Errors on Phase 5 routes retain route tag and stack frames.
- **Expected behavior:** All production route templates must be recognized, and all internal monorepo package frames must be retained.
- **Actual behavior:** Modern routes and engine packages are stripped from production telemetry.
- **Root cause:** Stale hardcoded whitelist in `sentry.ts` left unmaintained since Phase 5.
- **Why existing tests missed it:** Existing tests only asserted that Sentry was initialized and that PII was scrubbed.
- **Recommended repair direction:** Update `allowedRoutes` to include all registered fastify route templates, and expand the package regex to `packages/`.
- **Regression tests required:** Unit test asserting Sentry preserves route tags for all API routes and stack frames for all packages.
- **Cross-phase risks:** Affects production monitoring across all phases.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D14 — QA Core Slab Overlap Validation Fails to Detect Colliding Roof/Ceiling Solids

- **Severity:** P2 (Medium)
- **Affected phase(s):** Phase 11 (Blueprint QA), Phase 14 & Phase 15
- **Affected subsystem:** Blueprint QA Core Geometry Invariants
- **Files:** [`packages/shared/src/building-v2/invariants.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/packages/shared/src/building-v2/invariants.ts#L104), [`packages/blueprint-qa/src/core.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/packages/blueprint-qa/src/core.ts#L155)
- **Public impact:** Physically overlapping 3D roof slabs or ceiling plates pass QA with 0 errors, resulting in duplicated waterproofing materials, duplicated roofing structural elements, and inflated BOQ cost estimates.
- **Security impact:** None.
- **Data-integrity impact:** Corrupted 3D geometric validity and incorrect material quantities.
- **Initial hypothesis:** Slabs are only checked for overlap if `a.kind === 'floor'` or `a.topOffsetMm === b.topOffsetMm`.
- **Evidence supporting defect:** In `packages/blueprint-qa/src/core.ts:155` and `invariants.ts:104`:
  ```typescript
  if (a.levelId === b.levelId && (a.kind === 'floor' || a.topOffsetMm === b.topOffsetMm)) {
    if (polygonsIntersect(a.footprint.outer, b.footprint.outer)) record('QA_SLAB_OVERLAP', ...);
  }
  ```
  Consider two `flat-roof` slabs on the same level: Slab A has `topOffsetMm = 2800` and thickness `150 mm` (occupying vertical span `2650..2800 mm`). Slab B has `topOffsetMm = 2750` and thickness `150 mm` (occupying vertical span `2600..2750 mm`). Their 3D solids physically collide and intersect in the `2650..2750 mm` vertical band.
  However, because `a.kind !== 'floor'` and `a.topOffsetMm !== b.topOffsetMm`, the check is bypassed! Blueprint QA reports `PASS` with 0 errors.
- **Evidence against defect:** It was argued that roofs on different offsets might represent stepped roof levels. However, if they share 2D footprint intersection AND their vertical intervals overlap, they physically collide.
- **Reproduction:**
  1. Create model with two overlapping roof slabs whose vertical intervals overlap by 50 mm.
  2. Run `auditBlueprint`: returns status `PASS`, 0 errors.
  3. Commit to database: successfully creates project revision.
- **Counter-check:** If both slabs have identical `topOffsetMm`, QA catches the overlap.
- **Expected behavior:** Slabs whose 2D footprints intersect must be checked for 3D vertical interval intersection: `!(aTop <= bBottom || bTop <= aBottom)`.
- **Actual behavior:** Ignores true 3D slab collisions when top offsets differ.
- **Root cause:** Flawed condition `a.topOffsetMm === b.topOffsetMm` instead of 1D interval overlap check.
- **Why existing tests missed it:** Existing tests only tested slabs with identical offsets.
- **Recommended repair direction:** Replace equality test with 3D vertical bounding interval overlap test in `invariants.ts` and `blueprint-qa/src/core.ts`.
- **Regression tests required:** Test verifying `QA_SLAB_OVERLAP` is emitted for vertically intersecting slabs with unequal top offsets.
- **Cross-phase risks:** Affects Phase 9, Phase 11, Phase 13, and Phase 14.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D15 — Multi-Mode Workflows Omit BIM Projection and IFC Generation Capabilities

- **Severity:** P2 (Medium)
- **Affected phase(s):** Phase 16 (Workflows) & Phase 23 (BIM / IFC)
- **Affected subsystem:** Workflow Registry & Orchestration Planner
- **Files:** [`apps/api/src/workflows/registry.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/workflows/registry.ts#L24-L40)
- **Public impact:** Users executing multi-mode workflows cannot request BIM or IFC artifacts; the workflow system has no registered capability for Phase 23 BIM/IFC features.
- **Security impact:** None.
- **Data-integrity impact:** Architectural gap in pipeline automation.
- **Initial hypothesis:** Phase 23 BIM and IFC capabilities were never wired into the Phase 16 workflow registry.
- **Evidence supporting defect:** In `apps/api/src/workflows/registry.ts:24-40`, the `CAPABILITIES` array lists:
  `BLUEPRINT_GENERATION`, `BLUEPRINT_QA`, `REVISION_PERSISTENCE`, `QUANTITY_TAKEOFF`, `CONSTRUCTION_CALCULATION`, `BOQ_COST`, `PROFESSIONAL_2D`, `INTERIOR_DESIGN`, `EXTERIOR_DESIGN`, `SCENE_3D`, `WALKTHROUGH`, `ENGINEERING_ANALYSIS`, `HOLOGRAPHIC_MODEL`.
  There is **zero mention** of `BIM_PROJECTION` or `IFC_EXPORT`. Neither exists in `CapabilityIdSchema` nor in `MODES`.
- **Evidence against defect:** It was argued that BIM is only an on-demand view API. However, Phase 16 was designed as the authoritative automation engine for all downstream architectural deliverables.
- **Reproduction:**
  1. Inspect `CAPABILITIES` and `MODES` in `apps/api/src/workflows/registry.ts`.
  2. Grep for `BIM` or `IFC` across `apps/api/src/workflows/`. Zero matches found.
- **Counter-check:** All other major subsystems from Phase 1 through 15 are registered.
- **Expected behavior:** BIM and IFC should be registered capabilities in the workflow registry.
- **Actual behavior:** Completely omitted from workflow orchestration.
- **Root cause:** Failure to update workflow contracts during Phase 23 delivery.
- **Why existing tests missed it:** Workflow test suites only validated existing Phase 16 modes.
- **Recommended repair direction:** Register `BIM_MODEL` and `IFC_EXPORT` capabilities in `registry.ts` and workflow schemas.
- **Regression tests required:** Workflow test asserting BIM capability planning.
- **Cross-phase risks:** Affects Phase 16 and Phase 23 integration.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D16 — Compute-Intensive Workflow Endpoint Excluded From Generate Rate Limit Group

- **Severity:** P2 (Medium)
- **Affected phase(s):** Phase 8 (Production Hardening) & Phase 16 (Workflows)
- **Affected subsystem:** HTTP Protection & Rate Limiting
- **Files:** [`apps/api/src/lib/http-protection.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/lib/http-protection.ts#L18)
- **Public impact:** Attackers or buggy clients can flood the API with end-to-end workflow execution requests at 60 req/min (the generic write limit) instead of the restricted 10 req/min generation limit, leading to server CPU exhaustion.
- **Security impact:** Resource exhaustion / Denial of Service.
- **Data-integrity impact:** None.
- **Initial hypothesis:** The URL list defining the `'generate'` rate limit group omits the workflow execution endpoint.
- **Evidence supporting defect:** In `apps/api/src/lib/http-protection.ts:18`:
  ```typescript
  const group = (request: FastifyRequest) => [
    '/api/projects/:projectId/conversations/:conversationId/messages',
    '/api/projects/:projectId/conversations/:conversationId/proposals/approve',
    '/api/projects/:projectId/requirements/interpret',
    '/api/plans/generate',
    '/api/projects/:projectId/revisions/generate',
    '/api/projects/:projectId/revisions',
  ].includes(request.routeOptions.url ?? '') ? 'generate'
    : ['POST', 'PATCH', 'DELETE'].includes(request.method) ? 'write' : 'read';
  ```
  The workflow endpoint `/api/projects/:projectId/workflows` (POST) is **missing** from the array.
  Because it is a POST request, it falls through to `'write'`, which permits 60 requests/minute. Yet a workflow run generates a blueprint, audits it with QA, saves a revision, calculates takeoff, runs construction specs, and computes BOQ cost—the single heaviest compute pipeline in the application.
- **Evidence against defect:** It was argued that workflows require an authenticated user. However, rate limits exist precisely to prevent authenticated users from overwhelming server worker threads.
- **Reproduction:**
  1. Inspect `http-protection.ts:18`.
  2. Send requests to `/api/projects/:projectId/workflows`: quota is charged against `'write'` (60 req/min) rather than `'generate'` (10 req/min).
- **Counter-check:** `/api/projects/:projectId/revisions/generate` is correctly in `'generate'`.
- **Expected behavior:** `/api/projects/:projectId/workflows` must be classified under the `'generate'` rate limit group.
- **Actual behavior:** Permitted at 6x the intended rate of heavy generation tasks.
- **Root cause:** Incomplete route pattern list in `http-protection.ts`.
- **Why existing tests missed it:** Rate limit tests only tested `/api/plans/generate` and `/api/projects/:projectId/revisions`.
- **Recommended repair direction:** Add `/api/projects/:projectId/workflows` to the `'generate'` route list in `http-protection.ts`.
- **Regression tests required:** Test asserting that POST to `/api/projects/:projectId/workflows` consumes the `'generate'` quota.
- **Cross-phase risks:** Denial of service / thread pool exhaustion.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D17 — BIM Topology Creates Spatial Access Edges for Non-Traversable Service Openings

- **Severity:** P2 (Medium)
- **Affected phase(s):** Phase 23 (BIM / IFC)
- **Affected subsystem:** BIM Topological Graph Projection
- **Files:** [`apps/api/src/bim/project.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/bim/project.ts#L41)
- **Public impact:** BIM model graphs report circulation connections through pipe penetrations, duct chases, and service voids; architectural circulation graph algorithms report accessible routes where physical passage is impossible.
- **Security impact:** None.
- **Data-integrity impact:** Corrupted topological circulation semantics in BIM graph exports.
- **Initial hypothesis:** `projectBim` creates an `accesses` relationship for any opening that is not a window, including MEP duct/pipe voids.
- **Evidence supporting defect:** In `apps/api/src/bim/project.ts:41`:
  ```typescript
  if (opening.kind !== 'window')
    for (const space of geometry.walls.find(w => w.id === opening.wallId)!.spaceIds ?? [])
      edge('accesses', voidId, id('space', space));
  ```
  In `BuildingModelV2`, `opening.kind` can be `'door'`, `'window'`, or `'opening'`.
  When `opening.kind === 'opening'`, `opening.purpose` can be `'passage'`, `'service'`, `'structural'`, or `'crawlspace'`.
  Line 41 checks `if (opening.kind !== 'window')`! As a result, a 200x200mm MEP duct opening (`purpose: 'service'`) generates an `accesses` graph edge to adjacent spaces, semantically declaring it as a traversable spatial accessway!
- **Evidence against defect:** It was argued that an opening is an opening in the wall. But the BIM schema defines `accesses` specifically as circulation connectivity between spaces and opening voids.
- **Reproduction:**
  1. Add an opening with `kind: 'opening'`, `purpose: 'service'` to a wall between two rooms.
  2. Run `projectBim`.
  3. Diagnostic result in `diagnostics.json`: `accesses: 4` (increased from 3 in control). Edge `'accesses'` is created for the service opening.
- **Counter-check:** Window openings are correctly excluded from `accesses`.
- **Expected behavior:** Only doors and traversable passage openings (`purpose === 'passage'`) should generate `accesses` circulation edges.
- **Actual behavior:** All non-window wall voids, including mechanical service shafts, generate `accesses` edges.
- **Root cause:** Overly broad predicate `opening.kind !== 'window'`.
- **Why existing tests missed it:** Existing tests only tested door openings and window openings.
- **Recommended repair direction:** In `apps/api/src/bim/project.ts:41`, change condition to:
  `if (opening.kind === 'door' || (opening.kind === 'opening' && opening.purpose === 'passage'))`.
- **Regression tests required:** Test asserting that service openings generate `hosts` and `fills` edges but no `accesses` edges.
- **Cross-phase risks:** Affects downstream graph queries and pathfinding algorithms.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D18 — Construction Options Schema Rejects Whole-Integer and Low-Precision Quantities

- **Severity:** P2 (Medium)
- **Affected phase(s):** Phase 14 (Construction Calculations) & Phase 15 (BOQ Cost)
- **Affected subsystem:** Construction Options Schema
- **Files:** [`packages/construction-calculations/src/specification.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/packages/construction-calculations/src/specification.ts#L65)
- **Public impact:** Procurement systems or frontend UI components requesting discrete whole-unit reports (e.g., number of doors or windows rounded to whole numbers: `quantityDecimalPlaces: 0` or standard currency `quantityDecimalPlaces: 2`) are rejected with schema validation errors.
- **Security impact:** None.
- **Data-integrity impact:** Prevents normal commercial rounding configurations.
- **Initial hypothesis:** `ConstructionOptionsSchema` enforces an artificially high minimum on `quantityDecimalPlaces`.
- **Evidence supporting defect:** In `packages/construction-calculations/src/specification.ts:65`:
  ```typescript
  export const ConstructionOptionsSchema = z.object({
    quantityDecimalPlaces: z.number().int().min(6).max(12).default(9)
  }).strict();
  ```
  `min(6)` forces all formatted quantities to have between 6 and 12 decimal places. A caller requesting `quantityDecimalPlaces: 0` or `2` triggers Zod validation failure.
- **Evidence against defect:** It was argued that internal calculations require high precision. However, internal calculations use exact `Rational` fractions regardless of `quantityDecimalPlaces`. `quantityDecimalPlaces` is purely for string output formatting.
- **Reproduction:**
  1. Pass `{ quantityDecimalPlaces: 0 }` to `ConstructionOptionsSchema.parse()`.
  2. Throws ZodError: `Number must be greater than or equal to 6`.
- **Counter-check:** Passing `{ quantityDecimalPlaces: 9 }` succeeds.
- **Expected behavior:** `quantityDecimalPlaces` should permit values from `0` to `12` (`.min(0).max(12)`).
- **Actual behavior:** Rejects any display precision below 6 decimal places.
- **Root cause:** Overly restrictive `.min(6)` in Zod schema.
- **Why existing tests missed it:** Existing tests only used the default value of 9.
- **Recommended repair direction:** Change `.min(6)` to `.min(0)` in `specification.ts:65`.
- **Regression tests required:** Test parsing `ConstructionOptionsSchema` with 0, 2, and 4 decimal places.
- **Cross-phase risks:** Affects Phase 14 and Phase 15.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D19 — Missing Production Validation for Mandatory PROJECT_COMMIT_SECRET

- **Severity:** P2 (Medium)
- **Affected phase(s):** Phase 5 (Persistence) & Phase 8 (Production Hardening)
- **Affected subsystem:** Configuration & Environment Parsing
- **Files:** [`apps/api/src/config/env.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/config/env.ts#L14, #L48-L60)
- **Public impact:** An ops misconfiguration where `PROJECT_COMMIT_SECRET` is missing allows the server to boot cleanly in production and pass health checks, but every user attempting to commit a project revision, approve a conversation proposal, or create a takeoff crashes with HTTP 503 `PROJECTS_UNAVAILABLE`.
- **Security impact:** Operational failure / degraded service availability.
- **Data-integrity impact:** None.
- **Initial hypothesis:** `PROJECT_COMMIT_SECRET` is defined as optional in `EnvSchema` and not validated in production mode.
- **Evidence supporting defect:** In `apps/api/src/config/env.ts:14`:
  ```typescript
  PROJECT_COMMIT_SECRET: optionalDefault(z.string().regex(/^[a-f0-9]{64}$/).optional()),
  ```
  In `superRefine` (lines 48-60):
  ```typescript
  if (env.NODE_ENV === 'production' && !env.SENTRY_DSN)
    ctx.addIssue({ code: 'custom', path: ['SENTRY_DSN'], message: 'Required in production' });
  ```
  Notice that `SENTRY_DSN` is required in production, but `PROJECT_COMMIT_SECRET` is **never checked**!
  If an operator starts the backend in production without this variable:
  1. `parseEnv()` passes with zero errors.
  2. Fastify boots and listens on `PORT`.
  3. `/health/live` returns 200 OK.
  4. BUT every call to `saveProjectRevision`, `createTakeoff`, `createConstruction`, `createCost`, `executeWorkflow`, or `conversations.write` fails with:
  ```typescript
  if (!secret) throw new ApiError(503, 'PROJECTS_UNAVAILABLE', 'Project revision persistence is not configured');
  ```
- **Evidence against defect:** It was argued that local tests run without a secret. That is why it should be optional in `development` and `test`, but mandatory in `production`.
- **Reproduction:**
  1. Set `NODE_ENV=production` without `PROJECT_COMMIT_SECRET`.
  2. Call `parseEnv()`. It succeeds.
  3. Call `saveProjectRevision`: throws 503 `PROJECTS_UNAVAILABLE`.
- **Counter-check:** When `SENTRY_DSN` is omitted in production, `parseEnv()` throws at startup as intended.
- **Expected behavior:** In `NODE_ENV === 'production'`, `PROJECT_COMMIT_SECRET` must be enforced during startup.
- **Actual behavior:** Server starts silently and fails on all mutation requests.
- **Root cause:** Missing check in `EnvSchema.superRefine`.
- **Why existing tests missed it:** Test environment explicitly mocks or supplies the secret.
- **Recommended repair direction:** Add `if (env.NODE_ENV === 'production' && !env.PROJECT_COMMIT_SECRET) ctx.addIssue({ code: 'custom', path: ['PROJECT_COMMIT_SECRET'], message: 'Required in production' });` in `env.ts`.
- **Regression tests required:** Test verifying `parseEnv({ NODE_ENV: 'production' })` throws when secret is missing.
- **Cross-phase risks:** Production deployment availability.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D20 — BIM Core Arbitrarily Restricts Level Footprint Vertex Count to 4 or 6

- **Severity:** P2 (Medium)
- **Affected phase(s):** Phase 23 (BIM / IFC)
- **Affected subsystem:** BIM Core Source Validation
- **Files:** [`apps/api/src/bim/core.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/bim/core.ts#L35)
- **Public impact:** Valid rectilinear buildings with T-shaped, cross-shaped, or stepped floor boundaries (which have 8, 10, or 12 vertices) that pass all QA checks and persist to project revisions cannot be exported to BIM or IFC.
- **Security impact:** None.
- **Data-integrity impact:** Prevents complex orthogonal buildings from generating BIM/IFC models.
- **Initial hypothesis:** Line 35 of `bim/core.ts` restricts level boundaries strictly to 4 or 6 vertices.
- **Evidence supporting defect:** In `apps/api/src/bim/core.ts:35`:
  ```typescript
  if (m.levels.some(l => l.kind !== 'storey' || ![4, 6].includes(l.boundary.length) || !orthogonal(l.boundary)) || ...)
    throw new BimError('BIM_UNSUPPORTED_MODEL', 'Only bounded orthogonal architectural geometry is supported');
  ```
  Notice: `![4, 6].includes(l.boundary.length)`.
  A rectangle has 4 vertices; an L-shape has 6 vertices.
  However, valid orthogonal buildings in BuildingModelV2 can be T-shapes (8 vertices), U-shapes (8 vertices), stepped shapes (8 or 10 vertices), or cross-shapes (12 vertices).
  While spaces, slabs, and slab voids are permitted up to 32 orthogonal vertices (`orthogonal = (ring) => ring.length <= 32 ...`), the level boundary is arbitrarily locked to strictly 4 or 6 vertices!
- **Evidence against defect:** It was argued that Phase 23 was designed to support rectangular and L-shaped buildings. However, the error message claims `'Only bounded orthogonal architectural geometry is supported'`, implying all orthogonal models are supported.
- **Reproduction:**
  1. Pass an 8-vertex orthogonal T-shaped level boundary.
  2. Model passes QA with `PASS`.
  3. Call `sourceModel(model)` in `bim/core.ts`.
  4. Throws `BIM_UNSUPPORTED_MODEL`.
- **Counter-check:** A 6-vertex L-shaped level boundary passes cleanly.
- **Expected behavior:** Level boundaries should be subject to the same `orthogonal(l.boundary)` check as spaces and slabs (`length <= 32`).
- **Actual behavior:** Arbitrarily restricts level boundaries to 4 or 6 vertices.
- **Root cause:** Hardcoded `![4, 6].includes(l.boundary.length)` in `bim/core.ts`.
- **Why existing tests missed it:** Existing tests only tested rectangular (4) and L-shaped (6) levels.
- **Recommended repair direction:** Change check to `l.boundary.length <= 32 && orthogonal(l.boundary)`.
- **Regression tests required:** Test BIM projection and IFC export on an 8-vertex T-shaped orthogonal building.
- **Cross-phase risks:** Restricts Phase 9/19/22 models from Phase 23 BIM export.
- **Final verdict:** **CONFIRMED DEFECT**

---

## D21 — Setting Room Count to Zero Corrupts Requirements Schema

- **Severity:** P2 (Medium)
- **Affected phase(s):** Phase 20 (Conversational Architectural Intelligence)
- **Affected subsystem:** Conversation Planner Room Management
- **Files:** [`apps/api/src/ai/conversation-planner.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/ai/conversation-planner.ts#L98, #L258-L261)
- **Public impact:** When a user asks to remove a room type (e.g. `"remove the bathroom"` or setting bathroom count to 0), the conversation planner crashes with an internal schema error and tells the user their request conflicts with system constraints.
- **Security impact:** None.
- **Data-integrity impact:** Corrupts internal requirements state with `count: 0`.
- **Initial hypothesis:** The conversation planner mutates an existing room group to `count: 0` instead of removing the room object from `r.rooms`.
- **Evidence supporting defect:** In `apps/api/src/ai/conversation-planner.ts:98`:
  ```typescript
  if (count === total) continue;
  if (groups.length === 1) groups[0]!.count = count;
  ```
  When the user says `"remove the bathroom"` or the intent parses `c.bathrooms = 0`, line 98 executes:
  `groups[0]!.count = 0`.
  Then at line 258:
  ```typescript
  r = normalizeBlueprintForVersion(r, blueprintVersionForRequirements(r));
  ```
  In `packages/generator/src/blueprint/input.ts:17`:
  ```typescript
  rooms: z.array(z.object({
    type: RoomTypeSchema, count: z.number().int().min(1).max(24), ...
  }))
  ```
  `BlueprintRequirementsSchema` explicitly requires `count: z.number().int().min(1).max(24)`. Setting `count: 0` causes `safeParse` to fail!
  Lines 259-261 catch this failure and report:
  `"The proposed changes conflict with the native room, site, floor or relationship constraints. Supply consistent values; no requirements were replaced."`
- **Evidence against defect:** It was argued that a house must have at least one bathroom. However, this same bug occurs if someone tries to remove an optional `dining` or `study` room where `count = 0` is set!
- **Reproduction:**
  1. Start with a plan that has 1 bathroom.
  2. Send intent with `bathrooms: 0`.
  3. Diagnostic result in `conversation-diagnostics.json` (`remove-bathroom-zero`): returns `NEEDS_CLARIFICATION` with error message `"The proposed changes conflict with the native room, site, floor or relationship constraints"`.
- **Counter-check:** If `count > 0` (e.g. changing from 1 to 2), it succeeds.
- **Expected behavior:** Setting count to 0 should remove the room group from `r.rooms`: `r.rooms = r.rooms.filter(room => room.type !== type)`.
- **Actual behavior:** Sets `room.count = 0`, corrupting requirements schema and causing generic error.
- **Root cause:** Failure to filter out room when `count === 0` in `applyNative`.
- **Why existing tests missed it:** Existing tests only tested increasing room counts or updating dimensions.
- **Recommended repair direction:** In `conversation-planner.ts:98`, if `count === 0`, filter the room type out of `r.rooms` (and prune associated relationships).
- **Regression tests required:** Test removing an optional room (e.g. dining or study) in a conversation and asserting proposal generates without error.
- **Cross-phase risks:** Affects conversation state and requirements normalization.
- **Final verdict:** **CONFIRMED DEFECT**

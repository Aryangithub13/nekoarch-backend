# Phase 38: Construction Documentation and Engineering Evidence — Scope and Acceptance

**Status:** scope of record for implementation. Written 2026-10-13, before any Phase 38 code.

**Base:** `phase31/development` at `2ef4796` (Phase 37 merged as PR #14). Citations refer to that commit.

**Labels used throughout:**
- **CONFIRMED:** stated in the repository, with a citation.
- **PROPOSED:** this document's design.
- **UNKNOWN:** not recoverable.

---

## 1. What the repository says Phase 38 is

### 1.1 Confirmed

| Source | Text |
|---|---|
| `docs/phase35-1/phase-1-46-reconciliation.md:63` | "38 \| Documentation exports, evidence packages, drawing sheets (AS) \| PDF/DXF/SVG, persisted signed assessments \| — \| Not started" |
| `docs/phase35-1/phase-1-46-reconciliation.md:104` | "Evidence packages, persisted assessments, exports, drawing sheets \| **C. B38**" |
| `docs/modernization/modernization-report.md:162` | "F32–F35 site/blueprints/measurements … live (drawing sheets B38)" |
| `docs/modernization/modernization-report.md:164` | "F39–F40 reports/navigation … Engine reports via JSON; IFC … partial (B38)" |
| `docs/modernization/modernization-report.md:227` | "Drawing sheets, PDF/DXF/SVG \| B38" |
| `docs/phase30/phase30-report.md:166` | "Documentation exports \| 38" |
| `docs/phase34/phase34-design.md:85` | "Persisting reports as evidence packages \| B38" |
| `docs/phase35/phase35-design.md:38` | `professionally_reviewed`: "Never assigned by software. It needs a recorded review (a B38 evidence package) and a reviewer identity." |
| `docs/phase35/phase35-design.md:144` | "Persisting assessments as evidence packages is Phase 38 work" |
| `docs/phase35/phase35-design.md:166` | "Persisting assessments as signed evidence packages; exports \| B38" |
| `docs/phase37/phase37-scope.md` (A6) | Phase 37 excluded "Phase 38 exports or evidence packages" |

The working title "Construction Documentation & Engineering Evidence" agrees with all of these sources.

### 1.2 Conflicts and unknowns

- **Conflicting label (UNKNOWN which is right).** The owner's 2026-10-12 brief named Phase 38 "provider routing" (`docs/roadmap/*` on the unmerged `docs/roadmap-research-baseline`; decisions register Q4). The repository assigns provider routing to B39/B43. This phase follows the repository's assignment and the 2026-10-13 owner instruction. Q4 remains open.
- **Original acceptance criteria (UNKNOWN).** The canonical 46-phase roadmap was never recovered. The criteria below are PROPOSED.
- **Phase 35 V2 research (UNKNOWN, unverified).** It is a reconstructed framework with no sources; RCH-001 to RCH-012 are `NOT_RESEARCHED`. Phase 38 uses none of it. No standard, clause, factor, rate or citation is introduced.

---

## 2. What exists to build on (confirmed)

- **Revision model.** `packages/shared/src/building-v2/*`: levels (boundary ring, elevation), spaces (boundary ring, `boundaryBasis`), walls (centreline path; nullable thickness and height), hosted openings (door, window or opening; offset, width, height and sill along the host wall), stairs, slabs and columns. All lengths are integer millimetres.
- **Identity.** `modelHash` (`lib/generation-identity.ts`). The acceptance QA is linked by FK; revisions are immutable.
- **Phase 37.**
  - `revisionRecords` and `buildDependencyGraph` give the `REVISION` and `ACCEPTANCE_QA` freshness states.
  - `dependencyGraph()` gives the whole verified graph, with `graphHash` and a two-round read-consistency check.
- **Phase 35.** `assessRevision` produces `engineering-assessment-v1`: domains with `assuranceLevel`, `status` (`REQUIRES_SOLVER` …), `evidenceClass` and blockers (`NO_VALIDATED_SOLVER` …). It is deterministic apart from `generatedAt`, and `resultHash = costHash(body without resultHash and generatedAt)`.
- **Existing export.** IFC: `GET …/bim/export.ifc` (Phase 23), within the bounded BIM profile.
- **Persistence pattern.**
  - Immutable, owner-read RLS tables with `SECURITY DEFINER` write and read RPCs.
  - `project_private.verify_envelope` (0023) and `project_private.revision_model_hash` (0020).
  - The `immutable_revision` trigger, and convergence on `unique (revision, input_hash)`.
  - Latest migration: `0026_conversation_turns.sql`.
- **Dependencies.** No PDF, DXF or SVG library is present (`package.json`).

---

## 3. Design (proposed)

### A. Construction documents (derived on read, nothing stored)

1. **Plan sheets (SVG).** One sheet per storey level, from the revision model only:
   - level boundary; spaces with name and computed area; walls; door, window and opening positions along their host walls.
   - Integer-millimetre coordinates, elements sorted by id, and no timestamps, so the bytes are deterministic.
   - A provenance block (revision, model hash, QA, generator version) and a fixed "No professional review recorded" note.
   - **Nothing is invented.**
     - A wall with no stored thickness is drawn as a dashed centreline, and the sheet is `INCOMPLETE` (`WALL_THICKNESS_UNSPECIFIED`).
     - A space with `boundaryBasis: 'unspecified'` gets no area label (`SPACE_AREA_BASIS_UNSPECIFIED`).
     - Stairs, slabs, columns and dimensions are counted as "not drawn", not approximated.
   - Inconsistent hosting returns `422 DOCUMENT_GEOMETRY_INCONSISTENT`; no sheet is returned. This covers an opening whose wall is missing, on another level, or shorter than the opening.
2. **Schedules (JSON and CSV).** Levels, rooms (spaces), doors, windows and openings.
   - Each row carries its source entity id, and every value is a stored field or an exact derived value.
   - Room area is exact: shoelace twice-area as an integer, divided by 2,000,000, then formatted as an exact decimal in m².
   - Unknown stored values stay `null` or empty, never defaulted.
   - The CSV follows RFC 4180 (CRLF, quoting). Text cells starting with `= + - @` or a tab or CR are prefixed with `'` (formula-injection neutralisation).
3. **Manifest.** `GET …/documents` returns `construction-documents-v1`. It lists:
   - every document with its media type, href, byte length, `contentHash` (sha256 of the exact bytes served) and completeness;
   - format support (see §4);
   - limitations and claims, plus `manifestHash`.
4. **Revision integrity and freshness.** These reuse Phase 37 rather than adding a second freshness system.
   - The `REVISION` and `ACCEPTANCE_QA` records are evaluated by `buildDependencyGraph`.
   - `UNVERIFIED` (identity mismatch, QA not accepted, no current revision) gives `422 DOCUMENT_SOURCE_UNVERIFIED`, and no document is produced.
   - A superseded revision is served as `HISTORICAL_SNAPSHOT`, explicitly labelled. With `?require=current` it is `409 DOCUMENT_SOURCE_STALE` instead.
   - Every document derives from one revision read. Revisions are immutable, so a sheet can never mix two revisions. Currency is "as of" the current-revision read.

### B. Engineering evidence packages (persisted, signed, immutable)

1. **Create.** `POST …/evidence-packages` with `{ mode?: 'CURRENT_REVISION' | 'HISTORICAL_SNAPSHOT', assessment?: <Phase 35 request> }`. It assembles `engineering-evidence-package-v1`:
   - **binding:** project, revision, revision number, recomputed model hash, acceptance QA.
   - **dependencyGraph:** the complete Phase 37 graph, `graphHash` included.
   - **assessment:** the Phase 35 report, without its read-time `generatedAt`. Domain statuses, assurance levels, evidence classes and blockers are copied verbatim; nothing upgrades them.
   - **documents:** the A.3 manifest.
   - **evidenceIndex:**
     - source inputs (revision model; user-declared assessment request and evidence, labelled `USER_DECLARED_NOT_VERIFIED`);
     - model-derived documents;
     - computed artifacts grouped by kind (`DETERMINISTIC_ENGINE` / `SOLVER_OR_CALCULATOR` / `RULE_EVALUATION`);
     - assessment domains with their flags.
   - **professionalReview:** `{ status: 'NOT_RECORDED' }`. Software never records one.
   - **claims:** all `NOT_CLAIMED`.
   - **inputHash** and **contentHash**.
2. **Fail closed.**
   - Any `UNVERIFIED` graph node gives `422 EVIDENCE_SOURCE_UNVERIFIED`, naming the nodes.
   - Mode `CURRENT_REVISION` requires every node to be `CURRENT`; otherwise `409 EVIDENCE_SOURCE_STALE`.
   - Mode `HISTORICAL_SNAPSHOT` requires a superseded revision; otherwise `422 EVIDENCE_MODE_INVALID`.
3. **Persistence (migration `0027_evidence_packages.sql`).** This migration is necessary because a persisted, signed package needs storage, and no existing table fits.
   - **Table.** Immutable, owner-read RLS table `project_revision_evidence_packages`.
   - **`evidence_write` (`SECURITY DEFINER`).** It:
     - verifies the HMAC envelope (`verify_envelope`), ownership, the revision and accepted QA;
     - recomputes the model hash from the stored model, and the content, graph and assessment hashes with `cost_hash`;
     - for `CURRENT_REVISION`, rechecks **inside the write transaction** that the revision is still the project's current revision. A commit landing mid-generation makes the write fail with 409; it is never stored as current.
     - Identical inputs converge on one row (`unique (project_revision_id, input_hash)`, advisory lock).
   - **`evidence_read`.** `get` and `list`, owner-scoped.
   - **Atomicity.** A failed write leaves no row, because the insert is one statement in one transaction. No hosted database is touched.
4. **Read.**
   - `GET …/evidence-packages` lists summaries.
   - `GET …/evidence-packages/:packageId` returns the full package with read-time `currency` (`CURRENT` / `HISTORICAL`). `?require=current` gives 409 when it is historical.

### C. Wiring

- Discovery gains `CONSTRUCTION_DOCUMENTS` (`DERIVED_ON_READ`) and `EVIDENCE_PACKAGES` (`IMMUTABLE_ARTIFACT`). This is additive; the overview's outputs are unchanged.
- The `POST` route joins the `generate` rate-limit group.
- The route catalog, OpenAPI and the Sentry route allowlist are updated through the established workflow.

---

## 4. Formats

| Format | Status | Reason |
|---|---|---|
| SVG plan sheets | **Implemented** | Plain text with no dependency. Tests check well-formed XML structure, escaping and binding. |
| CSV schedules | **Implemented** | RFC 4180, with formula-injection neutralisation |
| JSON schedules, manifest and evidence packages | **Implemented** | Zod-validated contracts |
| IFC | **Existing, not changed** (`…/bim/export.ifc`, Phase 23) | Listed in the manifest as available at that route, within the bounded BIM profile |
| PDF | **Unsupported** (`NO_PDF_WRITER`) | No PDF library is in the stack. A hand-written writer would have no independent validator. Adding a dependency is an owner decision. |
| DXF | **Unsupported** (`NO_VALIDATED_DXF_WRITER`) | Same reason. A file with a `.dxf` extension is not conformance. |

---

## 5. Acceptance criteria (proposed; each has automated tests)

| # | Criterion |
|---|---|
| D1 | The manifest lists one plan sheet per storey level and five schedules, each with an href, media type, byte length and `contentHash`. The `contentHash` equals sha256 of the bytes served by that href. |
| D2 | Sheets and schedules are byte-identical across reads of an unchanged revision. Ordering does not depend on the order of input arrays. |
| D3 | Sheet geometry matches the model: wall endpoints, opening positions along the host wall, and space polygons in integer mm. Every element carries `data-source-id`. |
| D4 (−) | Unspecified wall thickness or space-area basis is shown as such and marks the sheet `INCOMPLETE`. No thickness or area is invented. |
| D5 (−) | Inconsistent opening hosting gives `422 DOCUMENT_GEOMETRY_INCONSISTENT`. |
| D6 (−) | User text (names, types) is XML-escaped in the SVG and formula-neutralised in the CSV. No `<script>` or event attribute can be injected. |
| D7 (−) | Each identity failure is `DOCUMENT_SOURCE_UNVERIFIED`: a revision identity mismatch, QA not accepted, or no current revision. |
| D8 | A superseded revision is `HISTORICAL_SNAPSHOT`. `?require=current` gives 409 `DOCUMENT_SOURCE_STALE`. |
| D9 | Room area is the exact shoelace value. Doors, windows and openings carry their stored dimensions and type unchanged. |
| E1 | On a current revision with verified artifacts, a package is created, persisted and readable. Its binding, `graphHash`, assessment `resultHash` and documents `manifestHash` all match independent recomputation. |
| E2 (−) | An `UNVERIFIED` graph node refuses creation with 422, naming the node, and no row is written. |
| E3 (−) | Mode `CURRENT_REVISION` on a superseded revision gives 409 `EVIDENCE_SOURCE_STALE`. `HISTORICAL_SNAPSHOT` succeeds there and is labelled. `HISTORICAL_SNAPSHOT` on the current revision gives 422. |
| E4 (−) | A revision committed between assembly and write is refused by the SQL write (409), and no row is written. |
| E5 (−) | Tampered or unsigned payloads are refused by SQL, and no row is written. This covers a forged model hash, an altered assessment, an altered graph, a wrong revision, another user's envelope, and no envelope at all. |
| E6 | Identical requests converge on one package (same id). Packages are immutable (UPDATE and DELETE are rejected by trigger). |
| E7 | Assessment flags (`REQUIRES_SOLVER`, `NO_VALIDATED_SOLVER`, evidence classes, assurance levels) are byte-identical to the Phase 35 report. `professionalReview` is `NOT_RECORDED`, and all claims are `NOT_CLAIMED`. |
| E8 (−) | Owner-only: anonymous gives 401; another user and a cross-project revision give 404, on every new route. |
| E9 | Legacy compatibility: the existing suites pass unchanged. Overview, freshness, the Phase 37 graph and the engineering assessment responses are unaffected. |
| G1 | The route catalog, OpenAPI, Sentry allowlist and discovery prefix tests pass. The migration replay test pins the new table and its foreign keys. |
| G2 | Build, typecheck, lint, full suite on Node 22.22.0 and 22.23.3, container smoke and `npm audit --omit=dev --audit-level=high` all pass. |

---

## 6. Out of scope (with reasons)

- **PDF and DXF:** see §4.
- **Elevations, sections, and 3D-derived drawings:** no verified 2D projection exists. Phase 29 scene geometry is for viewing, not documentation.
- **Material and quantity schedules:** Phase 13 takeoff already serves them as revision-bound artifacts, and the evidence package references them through the graph.
- **Recording a professional review:** this needs a reviewer identity model, which is an owner decision. The package states `NOT_RECORDED`.
- **Standards, clauses, rates and compliance:** nothing is introduced or claimed.
- **Regenerating analyses, background compute, Phase 39 and later.**

## 7. Open questions for the owner

1. Q4: Phase 38 label conflict ("provider routing" vs documentation and evidence).
2. Whether to add a PDF or DXF dependency, and which one (licence, size, validator).
3. Whether a professional-review record (with reviewer identity and credential reference) belongs in a later phase.

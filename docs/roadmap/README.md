# NekoArch project knowledge base — index and source register

**Baseline as of 2026-10-13 (r3).** This file maps which document owns which kind of information, and where every source came from. Read it first.

Product name: **NekoArch**. Repository and package identifiers (`designflow`, `@designflow/*`) are kept for compatibility. Renaming them needs explicit owner authorization.

## 1. Evidence classes (used in every document here)

| Class | Meaning |
|---|---|
| **CONFIRMED** | Directly supported by current source code, a passing test whose output was observed, a verified repository artifact (commit, tag, migration, CI check run), or an explicit owner instruction |
| **REPORTED** | Stated in an earlier report or phase document, not re-verified for this baseline |
| **PROPOSED** | A recommendation awaiting owner approval or implementation |
| **UNKNOWN** | Unavailable, contradictory or insufficiently supported |

These classes describe *documents*. They are not the persisted engineering enums: assurance levels, domain statuses, `REQUIRES_SOLVER`, `NO_VALIDATED_SOLVER`, source `verificationStatus`, and the cost `evidenceClass`. Those keep their exact names; [capability-register.md](capability-register.md) §1 lists them. A build proves compilation only. A passing test proves only what it exercises. A provider or job returning a result proves nothing about engineering validity.

## 2. Document ownership (one owner per kind of information)

| # | Document | Owns | Changes when |
|---|---|---|---|
| 1 | [NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md](NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md) | Canonical **working** roadmap: phase index (46 slots), scope provenance, label conflicts, Phase 36 requirements G1–G13, release gates | Scope or provenance changes (owner review) |
| 2 | [archive/…owner-draft-r1-2026-10-13.md](archive/NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.owner-draft-r1-2026-10-13.md) | The owner's draft, **verbatim** (sha256 `ae069e8d…d730`) | Never |
| 3 | [../research/NekoArch_Phase35_Engineering_Research_Enhanced_v2_2026-10.md](../research/NekoArch_Phase35_Engineering_Research_Enhanced_v2_2026-10.md) | Research protocol and **source-integrity register** (the reconstructed framework, verbatim, plus repository addenda) | A source is actually retrieved and registered |
| 4 | [architecture-map.md](architecture-map.md) | Components, dependencies, data and job flow, configuration surface | The architecture changes |
| 5 | [status-register.md](status-register.md) | Live state: branches, PRs, CI, migrations, per-phase acceptance evidence, Phase 36 acceptance | Every merge, PR or verification run |
| 6 | [decisions-register.md](decisions-register.md) | Owner decisions (dated, sourced), open questions, deferred scope | Owner instruction |
| 7 | [capability-register.md](capability-register.md) | Engineering capabilities and their validation level, technical limitations, security and operational risks | Capability or validation evidence changes |
| 8 | This file | Source index and document map | A source is added or its status changes |

Phase-specific design, API and report documents stay in `docs/phaseNN/` on the code branches. The registers link to them; they do not copy them.

## 3. Source index

### 3.1 Shared conversations (owner-supplied links)

| Source | Retrieved? | Exact limitation (2026-10-13) | Content used |
|---|---|---|---|
| Gemini conversation `https://share.gemini.google/qo10R2v6sLJy` | **No** | WebFetch: `getaddrinfo ENOTFOUND share.gemini.google`. Through the environment's HTTPS proxy: `CONNECT tunnel failed, response 403` (host not on the environment's network allowlist) | **None.** Nothing is inferred from the link or its title |
| ChatGPT conversation "Phase 34 Master Prompt" `https://chatgpt.com/share/6acdaa49-08e8-83e8-9c18-c3aa35f54f58` | **No** | Same: `ENOTFOUND chatgpt.com`; proxy `403` | **None.** The title in the owner's message is the only information; no requirement is derived from it |
| ChatGPT/Codex conversation `https://chatgpt.com/s/cx_6acdbf7bc560819184fc86f04dd6853d` | **No** | Same: `ENOTFOUND chatgpt.com`; proxy `403` | **None** |

**To use them:**
- Allow `share.gemini.google` and `chatgpt.com` in the environment's network settings. These share pages may also need JavaScript rendering, so retrieval is not guaranteed even then.
- Or, more reliably, commit an exported Markdown or text copy under `docs/sources/`, with its date and checksum.

**Related repository evidence (not a substitute for reading these):**
- Phase 34's own design quotes the roadmap at `docs/phase34/phase34-design.md:7` (REPORTED quotation).
- `origin/codex/phases-1-23-audit-repair` exists, which suggests earlier Codex work (UNKNOWN relation to the Codex link).

### 3.2 Roadmap and research files

| Source | Location | Status |
|---|---|---|
| Owner-supplied roadmap draft (r1), upload of 2026-10-13, sha256 `ae069e8d…d730` | Archived verbatim (row 2 above); checksum re-verified 2026-10-13 r3 | Reconstruction, **not** the original |
| Reconciled roadmap r2/r3 | Row 1 | Provisional working authority (owner direction 2026-10-13) |
| Owner-supplied research framework, upload of 2026-10-13, sha256 `10aa185d…1447` | Row 3, verbatim above its addenda | Reconstructed framework; research queue **unfilled** |
| Original `NekoArch_Backend_Roadmap_46_Phases_Frontend_Optimized.md` (8 Oct 2026, owner's local copy) | **Not recovered** | UNKNOWN |
| Original Phase 35 V2 research set | **Not recovered** | UNKNOWN |
| 56-phase frontend roadmap | **Not recovered**; partial references in `docs/phase35-1/phase-1-46-reconciliation.md` §7 @ `3717a80` | REPORTED excerpts only |

### 3.3 Repository evidence inspected for this baseline

Repository `Aryangithub13/nekoarch-backend`, fetched 2026-10-13.

| Ref | Commit | Notes |
|---|---|---|
| `phase31/development` (default) | `5476f41` | Merge of PR #10 (Phase 36 gateway), 2026-10-13 05:15:57Z |
| `phase36/compute-gateway` | `9420961` | PR #10 head (merged) |
| `phase35-1/release-remediation` | `3717a80` | PR #7, open draft, now conflicting |
| `phase36/conversational-ai` | `3016ec8` | Unmerged, no PR |
| `docs/roadmap-research-baseline` | `a644225` → this revision | Unmerged, no PR |
| `main` | `cbe5c1e` | Not the default; holds `docs/audit/B36-implementation-handoff-2026-10-12.md` |

**Tags (29):** `backend-v1-phase5-complete` … `backend-v1-phase30-complete`, plus `backend-v1-phase19-verified-20261003`, `backend-v1-modernization-phases-1-29` and `…-followups`. No tag exists for Phases 31–36.

**Files read:**
- `package.json`;
- `.github/workflows/backend-ci.yml` (on `5476f41` and `3717a80`);
- `apps/api/src/config/env.ts`;
- `apps/api/src/{compute,engineering,structural}/`;
- `supabase/migrations/0022`, `0025` (both branches);
- `docs/phase24/phase24-design.md`;
- `docs/phase36/*`;
- PR #7 and PR #10 metadata and check runs (GitHub API).

## 4. Rules for updating this knowledge base

1. Never edit the archived owner draft. Correct the working roadmap with a citation, and log the change in its §9.
2. Every row added to a register carries an evidence class and a locator: path and line, commit, test name, migration, PR, or CI run.
3. A REPORTED item becomes CONFIRMED only when it is re-verified, and the register records when and how.
4. Do not copy text between documents. Link to the owning document.
5. Do not add research values (standards, clauses, coefficients, rates, tolerances) without a registered source (research §5). A framework is not research.

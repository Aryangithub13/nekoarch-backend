# NekoArch Backend Baseline — Phases 1 to 23 Audit

**Auditor:** Principal Backend Auditor & Security/Reliability Reviewer  
**Audit Scope:** `designflow` Backend Repository (Phases 1–23)  
**Timestamp:** `2026-10-05T06:24:00Z`  
**Working Directory:** `/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow`

---

## 1. Repository & Git State

- **Repository Top-Level:** `/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow`
- **Active Branch:** `main`
- **Current HEAD Commit:** `7086209efd9e337a2c175b9bed1e562fde54ca68` (`Backend V1 Phase 22 complete`)
- **Current Tag at HEAD:** `backend-v1-phase22-complete`
- **Phase 23 Release Status:**
  - `backend-v1-phase23-complete` tag: **DOES NOT EXIST** in git repository.
  - Phase 23 code status: **Uncommitted in working tree**.
  - Tracked modified files (3):
    - `apps/api/src/app.ts` (added BIM route registration `bimRoutes(scope, backend)`)
    - `apps/api/tests/supabase.live.test.ts` (added `bimAcceptance` test hooks)
    - `package.json` (added test & benchmark scripts for BIM and IFC verification)
  - Untracked Phase 23 files (13):
    - `apps/api/src/bim/` (BIM domain logic, elements, IFC exporter, validator, relationships, diff)
    - `apps/api/src/routes/bim.ts` (BIM REST routes)
    - `apps/api/src/services/bim-service.ts` (BIM persistence and projection service)
    - `apps/api/tests/bim.integration.test.ts`
    - `apps/api/tests/bim.test.ts`
    - `docs/phase23-*` (design, API, report, evidence documents)
    - `scripts/verify-ifc.py`
    - `scripts/benchmark-bim.ts`
    - `test-support/bim-acceptance.ts`
    - `test-support/bim-repository.ts`

---

## 2. Runtime & Dependencies

- **Node.js:** `v26.10.0`
- **NPM:** `12.2.0`
- **Python:** `Python 3.14.7`
- **Package Manifest Hash (`package.json`):** `82c6e56fafaa0cbc23002d988f922077092a18d20cd75fe40c18e84350f6a795`
- **Lockfile Hash (`package-lock.json`):** `9eba827eaa424c2e5e0deee5bb00ff8d648ad2807c7b6c91514160374050b435`

---

## 3. Database & Migrations Baseline

There are 12 production SQL migration files under `supabase/migrations/`:
1. `0001_core_tables.sql` (SHA-256: `f3873f5d...`)
2. `0002_rate_tables.sql` (SHA-256: `b0569ce5...`)
3. `0003_estimates_and_logs.sql` (SHA-256: `e8e993ba...`)
4. `0004_rls_policies.sql` (SHA-256: `a2838fdc...`)
5. `0005_idempotency.sql` (SHA-256: `d3ceb573...`)
6. `0006_projects.sql` (SHA-256: `2d79f0c2...`)
7. `0007_quantity_takeoffs.sql` (SHA-256: `8262e653...`)
8. `0008_construction_calculations.sql` (SHA-256: `de774502...`)
9. `0009_boq_costs.sql` (SHA-256: `13d030eb...`)
10. `0010_workflows.sql` (SHA-256: `25bc89fa...`)
11. `0011_generation_freshness.sql` (SHA-256: `11cccdd6...`)
12. `0012_conversations.sql` (SHA-256: `46078cfc...`)

---

## 4. Source Preservation & Recovery Archive

To ensure zero risk of accidental loss during intensive testing, an external immutable backup tarball was created outside the repository:
- **Archive Path:** `/home/aryan/.gemini/antigravity-ide/brain/5d21d47a-a9bc-4022-96c6-3469d5411c77/backup-source-baseline.tar.gz`
- **Archive SHA-256:** `ac294036f2bca7b25b5fcbe0340e5b94d04e39935c80b4973d9f9b546f07a3b4`
- **Complete Manifest:** 1,084 source and migration files recorded in `docs/backend-audit-1-23/source-manifest.json`.

---

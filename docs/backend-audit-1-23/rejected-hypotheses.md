# NekoArch Backend Audit (Phases 1–23) — Rejected Hypotheses

During this comprehensive adversarial audit of the authoritative backend (`designflow`), multiple code paths, security mechanisms, and computational routines were flagged as suspicious and subjected to rigorous back-and-forth investigation.

In accordance with Section 6 of the Audit Specification, every candidate defect was actively challenged with counter-arguments, runtime reproduction attempts, source inspection, and mathematical checks. The hypotheses below were disproven and confirmed **NOT TO BE DEFECTS**. They are documented here to prevent redundant investigations and record system behavior.

---

## RH-01: IFC GlobalId Encoding Violates IFC 2x3 Specification Character Set

- **Subsystem:** Phase 23 — BIM Digital Building Model & IFC Exporter
- **Files Inspected:** [`apps/api/src/bim/ifc.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/bim/ifc.ts)
- **Initial Suspicion:** The IFC 2x3 specification requires a 22-character base64-like representation of UUIDs using the exact 64-character alphabet: `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$`. A custom UUID compressor in `apps/api/src/bim/ifc.ts` was suspected of using standard RFC 4648 Base64 (`+` and `/`), which would cause compliant IFC readers (like IfcOpenShell or Revit) to crash or reject the IFC file.
- **Adversarial Argument:** If standard base64 or padding (`=`) were used, IFC syntax compliance would fail immediately upon import.
- **Counter-Argument & Code Inspection:** Source inspection of `apps/api/src/bim/ifc.ts` reveals:
  ```typescript
  const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  ```
  The algorithm implements the exact bit-shifting logic mandated by buildingSMART IFC 2x3 for 128-bit UUID encoding into 22 characters, with no trailing padding.
- **Reproduction & Verification:** All 7 representative IFC models were exported and parsed with `ifcopenshell` via `/tmp/designflow-phase23-ifc/bin/python scripts/verify-ifc.py`. All 2,000+ generated GlobalIds passed schema validation with zero errors.
- **Final Verdict:** **NOT A DEFECT** (Complies strictly with buildingSMART standards).

---

## RH-02: Server-Side Request Forgery (SSRF) and DNS Rebinding in AI Provider Transport

- **Subsystem:** Phase 21 — AI Provider Orchestration Transport
- **Files Inspected:** [`apps/api/src/ai/orchestration/transport.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/apps/api/src/ai/orchestration/transport.ts)
- **Initial Suspicion:** When orchestrating remote AI completions to arbitrary or configurable endpoints, an attacker might supply internal hostnames, AWS/GCP metadata endpoints (`169.254.169.254`), localhost, or private IP addresses (`10.0.0.0/8`, `192.168.0.0/16`) to exfiltrate secrets or probe internal services. Additionally, DNS rebinding could return a public IP on initial check and a private IP on connect.
- **Adversarial Argument:** Many Node.js HTTP clients check IPs during validation but use standard `https.request()` without IP pinning, leaving them vulnerable to Time-Of-Check to Time-Of-Use (TOCTOU) DNS rebinding.
- **Counter-Argument & Code Inspection:** Inspection of `remoteCompletion` in `transport.ts` reveals defensive engineering:
  1. DNS resolution is performed explicitly using `dns.promises.Resolver`.
  2. Every returned IPv4 address is validated against `prohibited = new BlockList()`, which covers `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `224.0.0.0/4`, and `240.0.0.0/4`.
  3. The vetted IP address (`addresses[0]`) is passed directly to the `lookup` option of `httpsRequest`, pinning the TCP socket to that exact IP.
  4. SNI hostname verification remains active against `endpoint.hostname`.
  5. HTTP redirects are strictly forbidden: `status >= 300 && status < 400` immediately destroys the socket and rejects with `PROVIDER_POLICY_REJECTED`.
- **Reproduction & Verification:** Passing localhost, private subnets, redirecting endpoints, or invalid credentials all deterministically reject with `PROVIDER_POLICY_REJECTED`.
- **Final Verdict:** **NOT A DEFECT** (State-of-the-art SSRF and DNS rebinding protection).

---

## RH-03: Direct Unsigned Project Revision Injection via Supabase JWT

- **Subsystem:** Phase 5 & Phase 12 — Database RLS & Immutable Project Revisions
- **Files Inspected:** [`supabase/migrations/0007_projects_and_revisions.sql`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/supabase/migrations/0007_projects_and_revisions.sql)
- **Initial Suspicion:** An authenticated user possessing a valid Supabase JWT might be able to execute direct `INSERT` operations into `public.project_revisions` or call `project_write` with forged payloads to commit arbitrary or unvetted geometry without running Blueprint QA or HMAC validation.
- **Adversarial Argument:** In typical Supabase setups, `INSERT` policies on project tables often grant write access to `auth.uid() = created_by`.
- **Counter-Argument & Code Inspection:** Inspection of database permissions and RLS policies demonstrates strict row-level security:
  1. Direct `INSERT`, `UPDATE`, and `DELETE` on `public.project_revisions` are explicitly `REVOKE`d from `authenticated` and `anon`.
  2. The only mutation pathway is via `public.project_write('revision', ...)`.
  3. `public.project_write` enforces `SECURITY DEFINER` and requires an HMAC-SHA256 signature (`p_signature`) computed with `PROJECT_COMMIT_SECRET` over `p_envelope`.
  4. The secret resides in `project_private.project_secrets`, which is completely inaccessible to `authenticated` and `anon` roles. Direct queries fail with PostgreSQL error code `42501 (insufficient_privilege)`.
- **Reproduction & Verification:** Executing direct inserts into `public.project_revisions` or calling `project_write` with invalid or missing HMAC signatures returns SQL error `42501` and `P1204 (invalid operation signature)`.
- **Final Verdict:** **NOT A DEFECT** (Tamper-proof signed mutation boundary).

---

## RH-04: Slab Void Geometric Disconnect / Voids Outside Outer Footprint

- **Subsystem:** Phase 9 & Phase 22 — Building Model V2 & Parametric Architecture
- **Files Inspected:** [`packages/shared/src/building-v2/invariants.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/packages/shared/src/building-v2/invariants.ts)
- **Initial Suspicion:** In complex multi-level models, slab voids (such as stair openings) might be defined with coordinates extending outside the outer boundary of the slab polygon, resulting in negative or corrupt area and volume calculations.
- **Adversarial Argument:** If void validation only checks bounding boxes or basic vertex counts, degenerate outer-extending voids could slip into persisted models.
- **Counter-Argument & Code Inspection:** Inspection of `packages/shared/src/building-v2/invariants.ts` reveals:
  ```typescript
  for (const voidPolygon of slab.footprint.voids) {
    if (!polygonContainsPolygon(slab.footprint.outer, voidPolygon)) {
      errors.push('SLAB_VOID_OUTSIDE_OUTER');
    }
  }
  ```
  The invariant validator executes exact polygonal inclusion tests, verifying that every vertex of every void lies strictly inside the outer boundary without intersecting outer perimeter segments.
- **Reproduction & Verification:** Crafting a slab with a void vertex shifted outside the slab outer polygon triggers immediate rejection by `validateBuildingInvariants` with `SLAB_VOID_OUTSIDE_OUTER`.
- **Final Verdict:** **NOT A DEFECT** (Rigorous geometric containment).

---

## RH-05: Integer / Floating-Point Overflow in Bill of Quantities (BOQ) Costing

- **Subsystem:** Phase 15 — BOQ / Cost V2 Engine
- **Files Inspected:** [`packages/boq-cost/src/calculate.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/packages/boq-cost/src/calculate.ts), [`packages/construction-calculations/src/rational.ts`](file:///home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow/packages/construction-calculations/src/rational.ts)
- **Initial Suspicion:** Large commercial buildings with millions of square millimetres of floor area and millions of currency units could overflow standard JavaScript numbers (`Number.MAX_SAFE_INTEGER = 9,007,199,254,740,991`), leading to rounding drift, negative totals, or `Infinity`.
- **Adversarial Argument:** Currency calculations in web backends frequently accumulate IEEE 754 floating-point errors (e.g. `0.1 + 0.2 = 0.30000000000000004`).
- **Counter-Argument & Code Inspection:** The BOQ Cost V2 engine performs all monetary and geometric arithmetic using the `Rational` class, backed by arbitrary-precision native JavaScript `BigInt` numerators and denominators (`n` and `d`). All subtotals, line extensions, and tax/fee adjustments are evaluated as exact fractions before being formatted with banker's rounding to two decimal places.
- **Reproduction & Verification:** Tested models with huge theoretical quantities and costs exceeding $100,000,000.00; results matched hand-calculated rational fractions to exact integer cents without drift.
- **Final Verdict:** **NOT A DEFECT** (Exact BigInt rational arithmetic prevents IEEE 754 precision issues).

# B43 slice S1: vendor-neutral capability registry and inspectable routing

**Status:** implemented and locally verified as a **vertical slice**. **B43 is not complete** (§4).

**Branch:** `phases-40-46`. Plan of record: [b40-b46-implementation-plan.md](../roadmap/b40-b46-implementation-plan.md). Groundwork: Phase 21 orchestration, the PR #16 capability routing and the Phase 36 compute gateway.

## 1. Roadmap traceability (ROADMAP L355–372)

| Requirement | S1 delivers |
|---|---|
| Vendor-neutral registry (`llm.intent`, `image.reference`, `image.exterior`, `interior.design`, `geometry.3d`, `cad.ifc`, `structural.solve`, `environmental.simulate`, `cost.rate_source`, `report.compose`) tied to actual validated contracts (L364) | `GET /api/routing/capabilities`. It lists all ten capabilities plus `quantity.takeoff` and `geometry.verify`. Each entry carries:<br>• its real implementation (service id, route, AI capability), pinned by a test to discovery and the route catalog;<br>• its honest status (`AVAILABLE`, `PARTIAL`, `ADVISORY`, `UNSUPPORTED`);<br>• data egress, region, cost basis, independent output check, fallback and limitations. |
| Per-operation provenance, privacy/region policies, schema checks, safe fallback (L360) | Provider eligibility per capability mirrors the orchestrator's gates (enabled, capability, privacy, metering). It is static: live health and request size are decided per request. A remote provider is never eligible under `LOCAL_ONLY`. |
| Avoid sending protected plans or project data to unnecessary third parties (L361) | Only capabilities a target needs are invoked. Every deterministic service has `dataEgress: NONE`. |
| User-supplied credentials only where implemented, encrypted, never returned (L365) | **Not implemented:** `userSuppliedCredentials: UNSUPPORTED` with the reason. Responses never contain an endpoint, host or credential variable name (tested). |
| Do not promise a free provider or zero overhead (L367) | The quote is `externalCostUsd: 0` only when no metered provider is eligible. Otherwise it is `null` (unknown until token counts exist) and is never estimated. |
| **Gate:** a façade-only request never triggers every image/3D/solver provider; routing is bounded and inspectable (L369) | **Met for the dry run:** `FACADE_APPEARANCE` invokes only `geometry.3d` (local, deterministic), and the other 11 capabilities are listed `NOT_TARGETED`. An unsupported target (`EXTERIOR_RENDER`) is refused, never served by a substitute. |

## 2. Policy narrowing

A request may lower privacy (`REMOTE_ALLOWED` → `LOCAL_ONLY`) and refuse metering. It can never widen the server policy:
- the effective privacy is the stricter of the two;
- the effective metering is the logical AND of the two.

## 3. API and verification

| Route | Access | Result |
|---|---|---|
| `GET /api/routing/capabilities` | Any signed-in user (401 anonymous) | `CapabilityRegistry` |
| `POST /api/projects/:projectId/routing/decisions` `{ targetScopes[], privacyClass?, allowMetered? }` | Owner only (404 for others) | `RoutingDecision`: `invoke`, `notInvoked` (with reasons), `refused`, `staleIfChanged`, quote, `decisionHash`, `executed: false` |

Discovery lists `CAPABILITY_ROUTING` (`DERIVED_ON_READ`).

**Tests:**
- `routing.test.ts`, 6/6: registry completeness and secrecy, service and route pinning, the façade gate, refusal without substitution, narrowing in both directions, the metered quote `null`, deterministic fallback and hash;
- `routing.integration.test.ts`, 1/1 over HTTP.

## 4. Outstanding B43 work

- Executing routes through this decision. Execution still runs through each service's own orchestrator call.
- Provider evaluation before accepting provider output (beyond the existing guards).
- Declared provider regions.
- A spend ledger and failure compensation.
- Encrypted user credentials with rotation and per-user billing.
- Component-level cache reuse across providers.
- Image, texture, render and 3D-asset providers (none exist).
- Live Supabase, CI and staging.

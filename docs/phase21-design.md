# Phase 21 — controlled AI provider orchestration

External AI providers are advisory. NekoArch deterministic systems remain authoritative.

## Starting audit and release checkpoint

Authoritative repository: designflow, main, clean checkpoint `18d6f8cf9e880a2fd06995206febc8d765bc0bb1`. The append-only stabilization commit contains exactly the approved 118 files, with 253 source hashes matching the passing-run manifest. Annotated tags `backend-v1-phase19-verified-20261003` and `backend-v1-phase20-complete` resolve to that commit. Historical `backend-v1-phase19-complete` remains at `f17a33703b226117ad3cbfa4f25a1889dccce71b`.

The manifest records the successful 10:56:05 UTC diff check; the standalone record records the later successful 11:04:46 UTC rerun. The gate runner replaces standalone records, while the manifest preserves its earlier result. The second run follows the final source preservation check. Historical evidence was preserved verbatim, including the approved raw-log whitespace findings in 23 files. Neither historical timestamps nor logs were rewritten. No push or deployment occurred.

| Existing reusable component | Extension / missing feature | Security concern | Coverage to preserve/add |
| --- | --- | --- | --- |
| ConversationProvider, local HTTP adapter, interpreter errors | Normalized advisory request, model/provider registries | No raw payload or URL from client | Local protocol failure harness, strict output |
| Deterministic parser and planner | Capability routing, fallback, provenance | Preserve native updates and ambiguous moves | Three stabilization regressions and acceptance |
| Phase 16 workflow registry | Separate AI metadata with explicit planned states | Geometry/QA/engineering remain deterministic workflow authority | Existing workflow and solver gates |
| Zod environment configuration | Validated provider policy, server credential references | Remote default denied; no arbitrary endpoint | URL, DNS, header and configuration tests |
| Cancellation and durable leases | Total budget, retries, circuit and concurrency limits | Late workers cannot commit | Concurrent message replay and expired lease tests |
| Structured logger and provider identity | Safe attempt events, usage, health | No prompts, credentials, full project data | Redaction and owner/project isolation |

## Architecture and reuse

The existing authenticated conversation route reserves the durable message lease before invoking the existing planner. The planner delegates only advisory interpretation to an orchestrated ConversationProvider; it retains cumulative state, semantic validation, native normalization, proposal identity/expiry, explicit approval and deterministic generation. The existing parser supplies the final fallback. Recognized deterministic constraints take precedence over advisory model text. Only unrecognized language needs accepted model intent to augment the bounded parser.

Provider-specific translation and I/O live in adapters. The strict ConversationIntentSchema rejects geometry, QA, nativeUpdate, approval and unknown fields. Provider envelopes reject tool/function calls and non-stop completion. Existing workflow capabilities remain authoritative; AI capabilities are a separate typed registry. Only ARCHITECTURAL_INTENT_EXTRACTION is operational; all other AI capability names are planned. There is no tool loop or autonomous execution.

## Registries, routing and limits

Providers have server IDs, local/remote type, enabled state, capabilities, timeout, priority, request quota and concurrency bound. Models are separate entries associated with a provider, with capability, priority, context/output budget, structured-output support, privacy, cost and optional per-million-token prices. Registry sizes are bounded to eight providers and sixteen models.

Routes sort by provider priority, model priority and stable IDs. Disabled providers/models, incompatible capabilities, context, structured output, cost, privacy and open circuits are excluded before I/O. Available routes run in that order within one total deadline and attempt budget, followed by the deterministic parser when permitted. Every attempt/skip has safe provenance. intentSource explicitly distinguishes applied provider intent from deterministic interpretation when the parser already understood the message. A provider outage cannot cause unlimited retries or a queue.

The total deadline is at most 15 seconds; individual providers are at most 10 seconds. This stays below the existing 60-second durable lease. Only transient unavailability, timeouts and rate limits retry (zero to two retries with bounded exponential backoff, at most six total attempts). Auth, schema, policy and unsupported errors do not retry. Circuits open after a bounded failure threshold; auth failures open immediately. After cooldown, only one process-local recovery probe may run. Health derives from actual requests, with no paid probes. Concurrency, quotas, circuits and health are process-local; no cluster-wide protection is claimed.

## Configuration and privacy

AI_ROUTING_CONFIG is server-owned JSON validated at startup. Empty config preserves existing AI_CONVERSATION_MODE fallback/local/disabled and local endpoint/model/key variables. Disabled provider entries do not require valid endpoints or credentials. AI_CONVERSATION_MODE=disabled disables inference. No paid provider or inference service is mandatory.

Example (no credentials in JSON):

```json
{
  "privacyClass": "LOCAL_ONLY",
  "deterministicFallback": true,
  "providers": [{
    "providerId": "local-main",
    "type": "LOCAL_OPENAI_COMPATIBLE",
    "enabled": true,
    "endpoint": "http://127.0.0.1:11434/v1/chat/completions",
    "capabilities": ["ARCHITECTURAL_INTENT_EXTRACTION"],
    "models": [{"modelId": "configured-local-model", "capabilities": ["ARCHITECTURAL_INTENT_EXTRACTION"]}]
  }]
}
```

Remote entries use REMOTE_OPENAI_COMPATIBLE, an exact HTTPS /v1/chat/completions endpoint, an allowedRemoteHosts entry and an optional apiKeyEnv matching AI_PROVIDER_*_API_KEY. Both the system/request and model privacy must permit remote access. PUBLIC_NON_SENSITIVE models only accept requests explicitly classified public. Conversations default LOCAL_ONLY; changing system privacy is an explicit operator decision authorizing the minimal project intent context. Metered models additionally require allowMetered=true. No client can set these fields.

Local endpoints retain numeric loopback HTTP restrictions. Remote endpoints require HTTPS port 443, exact allowlisted hostname/path, no credentials/query/fragment and no redirects. All DNS A records are checked against private/reserved networks; the vetted IP is pinned in HTTPS lookup with TLS hostname verification. IPv6-only remote providers are intentionally unsupported. DNS cancellation and socket/body cancellation follow the attempt signal. Authorization stays in the server transport header. Bodies and response headers are capped. Network errors are reduced to typed codes.

## Context, provenance and usage

Adapters receive only current message text, validated cumulative intent, bounded clarification questions and server task budgets. The 12,000-byte context and 16,384-byte response limits are preserved. No project records, revisions, JWT, HMAC key, database credentials or other-owner data enter the prompt. Native update objects are handled only by the planner. The optional state.orchestration field stores bounded safe provenance; old stored states remain readable. Requirements/model/generation hashes do not include provider provenance.

Usage contains nullable input/output/total tokens and estimatedCostUsd. Unknown usage remains null. Cost is computed only when token counts and both configured rates exist, and is an estimate, not a billing authority. Observer logging cannot influence results. The existing redactor also masks routing configuration, credential maps, provider key environment names, endpoint and context. No provider status endpoint or new migration is necessary.

## Extension and limitations

Add a typed capability contract and independent semantic validation before marking another capability AVAILABLE. Register an adapter behind the normalized advisory interface; never import repositories, SQL, shell or workflow execution into AI code. The import-boundary test limits network APIs to the dedicated transport. Test providers are injected only by server/test code, never request bodies.

This phase does not implement image generation, 3D generation, engineering computation/certification or multilingual accuracy evaluation. Protocol fixtures verify safety and routing, not real-model language quality. Supported transports cancel I/O; arbitrary third-party in-process adapters must honor AbortSignal to terminate their own work. No distributed quota or persistent billing ledger is provided. Source and evidence verification results are recorded separately in the Phase 21 review report.

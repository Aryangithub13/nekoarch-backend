# Phase 19/20 limitation register

| Area | Supported boundary or remaining limitation |
| --- | --- |
| Repository | Official backend and experimental frontend are separate. No frontend or walkthrough compatibility certification is included. |
| Geometry | Integer-mm simple orthogonal sites, at most 32 vertices, 60,000 mm span; one inscribed rectangular building envelope; one/two floors and at most 24 rooms. No multi-wing building footprint, curves or arbitrary rotation. |
| Search | Bounded deterministic candidate/operation search. Exhaustion is not proof of infeasibility; the selected result is not claimed globally optimal. |
| Execution | Synchronous solver with cooperative deadline checks (10 seconds in revision generation); no worker-enforced hard preemption. Maximum limits are not production load guarantees. |
| Environment heuristics | Privacy, service clustering, daylight opportunity and ventilation opportunity are scoring heuristics, not simulation, engineering certification or code approval. |
| Parking/cost | Conceptual allocation only; paving, turning paths, gradients and construction cost remain explicitly NOT_EVALUATED and totals may be incomplete. |
| Stairs | Supported straight stairs, landings and slab voids; no structural/headroom certification. |
| Language | Finite English/Hinglish grammar plus optional strictly validated loopback inference. Ambiguous/heterogeneous groups require clarification or a complete explicit native collection update. No unrestricted pronoun resolution or automatic alternate design search. |
| Native updates | Replace only the supplied top-level native collections/objects; omitted top-level fields remain. They are not recursive JSON patches. Native replacements supersede pending language for those same fields. |
| Conversation history | Latest proposal only; 20 retained display messages trimmed to 120,000 bytes, 100 transitions, 20 conversations/project, 100/owner. Exact structured requirements survive display trimming. No age-based deletion job or historical proposal archive. |
| Compatibility | `pendingBedroomMove` is a defaulted additive response/state field. Older stored states remain readable; consumers using strict copied response schemas must accept the field. No official frontend is coupled to this repository. |
| Approval | 24-hour proposals, 60-second leases, explicit latest-proposal approval. Submitted conversations are terminal. Restore requires same-project/same-solver revision identity and produces a new revision after approval. |
| Replay | Latest accepted message replay and durable approval receipt; no globally exactly-once inference across process failure. Deleting a conversation removes its replay receipt while preserving accepted revisions. |
| Provider | Numeric loopback HTTP only. No remote providers, paid dependencies, installed model requirement, measured general language accuracy or token-usage accounting. |
| Operations | Per-process HTTP quotas plus durable conversation quotas. Large-scale distributed load, a hard solver worker timeout and full infrastructure crash testing remain outside the verified scope. |
| Releases | Historical Phase 19 tag includes Phase 20. Preserve it and document the combined baseline; no clean phase-only intermediate commit exists. |

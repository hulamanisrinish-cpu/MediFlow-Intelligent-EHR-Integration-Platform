# Roadmap

## Implemented

- Deterministic hospital-flow scheduling engine (projected-completion routing).
- One-minute simulation clock with atomic batches and audit events.
- Emergency override + plan stability (hysteresis ≥ 5 min).
- FIFO baseline comparison and per-patient impact metrics.
- Session auth, RBAC, audit logging, rate limits, security headers, readiness.
- LLM language layer with deterministic fallback, retries, validation, caching.
- FHIR R4 outbound transaction sync adapter (mock-tested).
- CI with type-check, tests, build, secret scan, dependency audit.

## Planned

- Frontend component/unit tests (Vitest + Testing Library).
- Playwright end-to-end workflows.
- k6 performance baselines.
- Live FHIR sandbox verification and inbound adapters.
- Multi-tenant patient data isolation.
- Production rate limiting at edge/WAF layer.
- Data retention / deletion policies.
- Real-data integration and authentication rollout.

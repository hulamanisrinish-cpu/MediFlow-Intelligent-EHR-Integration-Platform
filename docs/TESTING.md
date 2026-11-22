# Testing

## Commands

```bash
npm run check        # strict TypeScript across all workspaces
npm test             # backend test suite (node:test)
npm run build        # production builds (frontend + Worker dry run)
npm run check:secrets  # secret scan
```

## Coverage

- Deterministic engine: routing, priorities, FIFO tie-breaks, emergency override,
  baseline, stability replans, complete simulated day.
- Simulation clock: atomic ticks, event ordering, conflict handling, full-day flow.
- Emergency override: eligibility, queue placement, replan, audit.
- Auth/security: login/logout/session expiry, RBAC, CORS allowlist, rate limits,
  body limits, security headers, readiness, error contracts.
- LLM adapter: retries, fallbacks, validation, caching, credential precedence.
- FHIR: mapper shape, client retry behavior, error handling.
- Seed/migrations: deterministic fixture, migration application.

## Out of scope for this repository

- Frontend unit/component tests (Vitest + Testing Library) — planned.
- End-to-end Playwright workflows — planned.
- Performance benchmarks (k6) — planned.
- Live FHIR sandbox verification — planned (mocked adapter tests only today).

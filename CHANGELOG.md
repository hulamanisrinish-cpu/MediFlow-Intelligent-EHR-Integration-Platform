# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html) for released
versions. Until `1.0.0`, the API may change between minor versions.

## [Unreleased]

### Added

- Repository audit with prioritized findings (`docs/REPOSITORY_AUDIT.md`).
- MIT license, security policy, code of conduct, changelog, editor config, and environment
  template.
- Session authentication with organizations, users, sessions, and RBAC
  (`backend/src/auth/`).
- Audit logging for login, reset, emergency override, and FHIR sync actions.
- Explicit CORS allowlist, security headers, request IDs, structured logs, body limits,
  and an in-isolate rate limiter (`backend/src/middleware/security.ts`).
- `/api/v1` API surface, `/health/live`, `/health/ready`, and OpenAPI 3.1 document.
- FHIR R4 mapping and outbound transaction-bundle sync adapter with persisted status
  (`backend/src/fhir/`).
- LLM retry/backoff, output validation, and prompt versioning.
- FHIR adapter tests (mapper, client retry/error behavior).
- CI dependency audit, secret scan, security workflow, and Dependabot configuration.
- Architecture, security, API, FHIR, deployment, testing, and operations documentation.

### Changed

- Moved the project from `MediFlow-master/` to the repository root.
- Replaced the "God of Code" README with an engineering README.
- Replaced the fabricated patient-facing "approximately 25 minutes faster" claim with a
  measured baseline comparison.
- Migrated the frontend API client to the canonical `/api/v1` namespace.

### Security

- Removed the committed demo reset token from documentation. **The owner must still
  rotate the token in Cloudflare.**
- Made session authentication the default; demo mode is explicit and refused in
  production.
- Limited CORS to configured origins; removed wildcard access.
- Added bounded request bodies, parameter validation, and per-route rate limits.
- Added production dependency audit and secret scanning to CI.

### Removed

- Unused Cloudflare MCP server development dependency.
- Joke framing and ASCII-art deity portrait from the README.

## [0.1.0] — 2026-07-25

- Emergency override, plan-stability hysteresis, impact panel, and deterministic baseline.
- 30-patient simulated day with Gemini language explanations and doctor briefs.

## Notes on historical claims

Some entries above were corrected during the 2026-11-22 engineering audit. The
following were previously documented but not present in the codebase at audit time
and should not be re-reported as implemented without follow-up work:

- Wait-time aging / starvation prevention in the scheduler (not present).
- Frontend error boundary and component tests (not present).
- Frontend login flow for the session backend (not present).
- Expanded patient gender domain values beyond `male` / `female`.

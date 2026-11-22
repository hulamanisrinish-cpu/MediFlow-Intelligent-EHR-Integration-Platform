# Security Model

**Status:** implemented (2026-11 audit remediation) — simulated-data MVP

## Principles

1. **Simulated data only.** No real patient data ever enters the system, so
   clinical-data exposure risk is minimal. Security controls still apply because
   the API is public-facing and shared.
2. **Deny by default cross-origin.** Browser access requires an explicitly
   configured origin.
3. **Identity is explicit.** Session credentials are required for every
   authenticated endpoint unless the deployment explicitly opts into demo mode.
4. **Fail safe.** Unknown clients, oversized payloads, and abusive traffic are
   rejected with structured errors.

## Authentication

- **Session mode (default):** bearer tokens. Tokens are stored only as SHA-256
  hashes. Sessions expire (12 h TTL) and can be revoked.
- **Demo mode (`AUTH_MODE=demo`):** synthetic identity; refused when
  `ENVIRONMENT=production`. A warning is logged on first use.
- Passwords: PBKDF2-SHA256 with per-user salt, 210k iterations, constant-time
  comparison. Policy: 12–128 characters, not common.

## Authorization

Roles: `admin`, `staff`, `doctor`.

| Endpoint group | Minimum role |
| --- | --- |
| `GET /api/v1/health/*`, `GET /api/v1/openapi.json` | none |
| `POST /api/v1/auth/login` | none |
| `GET /api/v1/auth/me`, `POST /api/v1/auth/logout` | authenticated |
| `GET /api/v1/simulation`, `GET /api/v1/operations` | authenticated |
| `POST /api/v1/simulation/tick` | `admin`, `staff` |
| `POST /api/v1/simulation/reset` | `admin` + demo reset token |
| `GET /api/v1/patients/:id/brief` | `admin`, `doctor` |
| `POST /api/v1/patients/:id/emergency-override` | `admin`, `doctor` |
| `POST /api/v1/llm/verify-key` | `admin` |
| `POST /api/v1/patients/:id/fhir-sync` | `admin` |

Resource-level authorization (patient data isolation between organizations) is
not implemented; the organization model scopes identity and audit records only.

## API controls

- **CORS:** exact-origin allowlist from `CORS_ORIGINS` (comma-separated). No
  wildcard. Preflight limited to `GET, POST, OPTIONS` with an explicit allow-list
  of headers. Empty allowlist denies cross-origin browser access.
- **Body size:** JSON body limit 32 KiB (`PAYLOAD_TOO_LARGE`).
- **Rate limiting:** in-memory token bucket per client IP. Login: 10 / 15 min.
  Reset: 5 / 60 s. Mutating API: 60 / min. Reads: 120 / min. Tunable via
  `RATE_LIMIT_*` vars; disabled with `RATE_LIMIT_DISABLED=true`. Documented as
  per-isolate; production should use edge/WAF controls.
- **Security headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options:
  DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (no camera/mic/
  geolocation/payment), `Cross-Origin-Resource-Policy: same-origin`,
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri
  'none'`, `Cache-Control: no-store`, `Strict-Transport-Security` on HTTPS.
- **Request handling:** request IDs (`X-Request-Id`, validated, else generated),
  structured JSON request logs with duration/status, never logging of bodies,
  tokens, or keys.

## Sensitive operations

The following actions write audit records (`audit_logs`): successful/failed
login, logout, simulation reset, emergency override, FHIR sync success/failure.

Audit rows store hashed IP (SHA-256), request ID, actor user ID, action,
resource type/id, and metadata. No raw tokens, passwords, or patient names.

## Secrets

- Worker secrets: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GEMINI_API_KEY`,
  `DEMO_RESET_TOKEN`.
- Session-fallback Gemini key: user-supplied, bounded (256 chars), validated via
  the read-only model endpoint, held in React memory only, sent via
  `X-Gemini-Api-Key`, never persisted or logged.
- Secret scanning (`scripts/check-secrets.mjs`) and CI enforcement.

# MediFlow API Reference

**Version:** 0.2.0  
**Contract:** OpenAPI 3.1 — published at `GET /api/v1/openapi.json`  
**Base URL:** `/api/v1` (canonical) with a deprecated `/api/*` alias

All responses use the envelope:

```json
{ "data": { } }   // success
{ "error": { "code": "...", "message": "...", "requestId": "..." } }   // failure
```

Errors never include stack traces, internal messages, or secrets.

---

## Health

### `GET /api/v1/health/live`

Liveness probe. Returns `200` when the process is running.

**Auth:** none

**Response `200`:**

```json
{
  "data": {
    "service": "mediflow-api",
    "status": "ok",
    "version": "0.2.0",
    "timestamp": "2026-11-22T09:00:00.000Z"
  }
}
```

---

### `GET /api/v1/health/ready`

Readiness probe. Verifies database connectivity. Returns `503` with
`status: "not_ready"` when the check fails.

**Auth:** none

**Response `200`:**

```json
{ "data": { "service": "mediflow-api", "status": "ready", "checks": { "database": "ok" }, "timestamp": "..." } }
```

**Response `503`:**

```json
{ "data": { "service": "mediflow-api", "status": "not_ready", "checks": { "database": "unavailable" }, "timestamp": "..." } }
```

---

## Auth

### `POST /api/v1/auth/login`

Creates a session. Rate limited (10 attempts / 15 minutes per client IP).

**Auth:** none

**Request body:**

```json
{ "email": "admin@mediflow.demo", "password": "correct-horse-battery-staple" }
```

Password policy: 12–128 characters, not a commonly used password.

**Response `200`:**

```json
 {
  "data": {
    "token": "<opaque session token>",
    "expiresAt": "2026-11-22T21:00:00.000Z",
    "user": { "id": "user-demo-admin", "email": "admin@mediflow.demo", "name": "Demo Administrator", "role": "admin", "organizationId": "org-demo", "organizationName": "Demo General Hospital" }
  }
}
```

**Errors:** `400 INVALID_REQUEST`, `401 INVALID_CREDENTIALS`, `429 RATE_LIMITED`, `413 PAYLOAD_TOO_LARGE`.

---

### `GET /api/v1/auth/me`

Returns the current session principal.

**Auth:** Bearer session token

**Response `200`:**

```json
{
  "data": { "user": { "...": "..." }, "expiresAt": "...", "mode": "session" }
}
```

---

### `POST /api/v1/auth/logout`

Revokes the current session.

**Auth:** Bearer session token

**Response:** `204 No Content`

---

## Simulation

### `GET /api/v1/simulation`

Reads the persisted simulation clock and counts.

**Auth:** Bearer session token

**Response `200`:**

```json
{
  "data": {
    "minute": 0,
    "playbackStatus": "paused",
    "speed": 1,
    "seed": 20260714,
    "totalPatients": 30,
    "arrivedPatients": 0,
    "completedPatients": 0
  }
}
```

---

### `POST /api/v1/simulation/tick`

Advances the persistent simulated clock by exactly one minute.

**Auth:** Bearer session token with role `admin` or `staff`

**Behavior:** atomically applies the due completions, registers due arrivals,
and runs the deterministic scheduler within a single transaction batch.

**Response `200`:**

```json
{
  "data": { "state": { "...": "..." }, "events": [ { "id": "clock-0001", "simulationMinute": 1, "orderInMinute": 0, "type": "clock_advanced", "patientId": null, "resourceId": null } ] }
}
```

**Errors:** `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `409 SIMULATION_CONFLICT`, `503 SIMULATION_NOT_INITIALIZED`.

---

### `POST /api/v1/simulation/reset`

Restores the canonical minute-zero synthetic fixture.

**Auth:** Bearer session token with role `admin` **and** the `DEMO_RESET_TOKEN` bearer credential.

**Response `200`:**

```json
{ "data": { "state": { "...": "..." } } }
```

**Errors:** `401 DEMO_RESET_UNAUTHORIZED`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `503 DEMO_RESET_DISABLED`, `503 SIMULATION_NOT_INITIALIZED`.

---

## Operations

### `GET /api/v1/operations`

Returns the shared operations snapshot used by all frontend views: simulation
status, patients, resources, recommendations, alerts, and metrics.

**Auth:** Bearer session token

**Response `200`:** `OperationsSnapshot`

---

## Clinical text

### `GET /api/v1/patients/:patientId/brief`

Returns the cached or freshly generated pre-consultation brief for a patient.

**Auth:** Bearer session token with role `admin` or `doctor`

**Path parameter:** `patientId` — `^[A-Za-z0-9_-]{1,64}$`

**Response `200`:**

```json
{
  "data": { "patientId": "pat-1", "content": "Allergies: ...", "generatedBy": "gemini" }
}
```

**Errors:** `400 INVALID_PATIENT_ID`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 PATIENT_NOT_FOUND`.

---

## Operations (safety)

### `POST /api/v1/patients/:patientId/emergency-override`

Declares an emergency override for a patient and rebuilds plans at the current
minute without advancing the clock.

**Auth:** Bearer session token with role `admin` or `doctor`

**Path parameter:** `patientId` — `^[A-Za-z0-9_-]{1,64}$`

**Response `200`:**

```json
{
  "data": { "patientId": "pat-1", "token": "...", "minute": 30, "queueResourceId": "doc-1", "queuePosition": 1, "replannedPatientIds": ["pat-2"] }
}
```

**Errors:** `400 INVALID_PATIENT_ID`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 PATIENT_NOT_FOUND`, `409 EMERGENCY_NOT_ELIGIBLE` / `EMERGENCY_ALREADY_DECLARED`, `409 SIMULATION_CONFLICT`.

---

## LLM

### `POST /api/v1/llm/verify-key`

Verifies a session-supplied Gemini API key against the configured model. The
key is never stored or logged.

**Auth:** Bearer session token with role `admin`

**Headers:** `X-Gemini-Api-Key: <256 chars max>`

**Response `200`:**

```json
{ "data": { "verified": true } }
```

**Errors:** `400 INVALID_GEMINI_API_KEY`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `503 GEMINI_API_KEY_VERIFICATION_UNAVAILABLE`.

---

## Integrations

### `POST /api/v1/patients/:patientId/fhir-sync`

Builds an idempotent FHIR R4 transaction Bundle for a patient and sends it to
the configured external endpoint.

**Auth:** Bearer session token with role `admin`

**Path parameter:** `patientId` — `^[A-Za-z0-9_-]{1,64}$`

**Errors:** `400 INVALID_PATIENT_ID`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 PATIENT_NOT_FOUND`, `502 FHIR_SYNC_FAILED`, `503 FHIR_NOT_CONFIGURED`.

---

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | Missing/invalid session |
| `SESSION_EXPIRED` | 401 | Session token expired or revoked |
| `FORBIDDEN` | 403 | Authenticated principal lacks role |
| `INVALID_CREDENTIALS` | 401 | Login failed (generic) |
| `INVALID_REQUEST` | 400 | Malformed request |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 32 KiB |
| `RATE_LIMITED` | 429 | Rate limit exceeded (`Retry-After`) |
| `NOT_FOUND` | 404 | Unknown route |
| `PATIENT_NOT_FOUND` | 404 | Unknown patient |
| `SIMULATION_NOT_INITIALIZED` | 503 | No simulation state |
| `SIMULATION_CONFLICT` | 409 | Concurrent tick conflict |
| `SIMULATION_INVARIANT` | 500 | Invariant violation |
| `INTERNAL_ERROR` | 500 | Unexpected failure |
| `DEMO_RESET_DISABLED` | 503 | Reset not configured |
| `DEMO_RESET_UNAUTHORIZED` | 401 | Reset token invalid |
| `INVALID_GEMINI_API_KEY` | 400 | Session key rejected |
| `GEMINI_API_KEY_VERIFICATION_UNAVAILABLE` | 503 | Key verification unavailable |
| `FHIR_NOT_CONFIGURED` | 503 | FHIR endpoint not configured |
| `FHIR_SYNC_FAILED` | 502 | FHIR sync failed |

---

## Versioning

- Canonical namespace: `/api/v1/*`
- Legacy alias: `/api/*` — still served, marked `Deprecation: true` with a
  `Link: </api/v1>; rel="successor-version"` header.

Clients should migrate to `/api/v1`.

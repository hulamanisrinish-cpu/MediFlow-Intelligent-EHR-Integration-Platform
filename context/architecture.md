# Architecture Context

## Stack

| Layer        | Technology                                                    | Role                                                       |
| ------------ | ------------------------------------------------------------- | ---------------------------------------------------------- |
| Frontend     | React + TypeScript (Vite)                                     | Staff dashboard, patient guidance view, doctor brief view  |
| Charts       | Chart.js                                                      | Queue, wait-time, and utilization visualizations           |
| Backend      | Hono (TypeScript) on Cloudflare Workers                       | REST API, scheduling engine, simulation, LLM adapter       |
| Database     | Turso (edge-hosted SQLite / libSQL) + Drizzle ORM             | Resources, patients, queue state, events, metric snapshots |
| LLM          | Gemini API (configured key with session fallback, behind a provider-agnostic adapter) | Natural-language explanations + pre-consultation summaries |
| Live updates | REST polling (every few seconds)                              | Keeps dashboard and patient views current — no WebSockets  |
| Hosting & CI | Cloudflare Pages (frontend), Cloudflare Workers (API), GitHub | Deployment, version control, CI                            |

Vite is the confirmed frontend build tool.

## System Boundaries

- `frontend/` — React app. Renders what the API returns via a shared polling data layer; never computes scheduling decisions client-side
- `backend/src/routes/` — Hono route handlers: validate input, call engine/services, shape responses. Thin.
- `backend/src/engine/` — deterministic rule-based scheduler, queue prediction, bottleneck detection. Pure functions: no DB, network, or LLM calls inside
- `backend/src/llm/` — provider-agnostic LLM adapter + prompts for explanations and pre-consultation summaries. The only module that talks to the LLM API
- `backend/src/db/` — Turso schema, queries, seed/simulation data
- `shared/` — domain types and API contracts imported by both frontend and backend

The npm-workspace monorepo layout was implemented on 2026-07-15.

## Storage Model

- **Turso (SQLite)**: everything persistent — resource definitions (3 doctors, 1 lab, 1 X-ray, 1 ECG) and live status, simulated patients with medical histories, queue/visit state, scheduling events, cached LLM outputs, metric snapshots
- **Normalized operational schema**: static resource definitions are separated from mutable resource state and queue positions; patient identity/visit state is separated from required services, timeline entries, and the five medical-history record types. Simulation events, metric snapshots, and cached LLM text use append-oriented tables so scheduling decisions remain auditable.
- **Development lifecycle**: Drizzle Kit generates committed SQLite migrations from `backend/src/db/schema.ts`; a Node-only seed command applies pending migrations and replaces simulation data with the canonical deterministic fixture. Worker request code never runs migrations. A narrowly scoped demo-reset route may replace simulation data with the already-committed canonical fixture, but only after authenticating a dedicated reset secret and never as part of a normal polling or tick request.
- **No blob/file storage**: the MVP produces no files or media; LLM outputs are short text stored inline
- **Simulated data only**: seed scripts generate all patients and histories — no real patient records anywhere

## Simulation Tick Semantics

- `POST /api/simulation/tick` advances the persistent clock by exactly one simulated minute. Playback speed remains a client concern: 4× playback issues ticks more frequently rather than skipping intermediate minutes.
- Each tick is planned deterministically from the current persisted state and applied as one atomic libSQL batch. A unique `clock_advanced` event for the target minute provides optimistic concurrency protection, so concurrent requests cannot advance the same minute twice.
- Within a minute, the clock event is recorded first, due active services are completed in patient-ID order, and newly due arrivals are registered in patient-ID order. Event rows carry an explicit order within their simulation minute.
- Completing a service clears the patient/resource active-service state, closes the open timeline entry, and marks the matching required service complete. After completions and arrivals are applied in memory, the deterministic scheduler queues next steps and starts idle resources within the same atomic tick batch.
- `GET /api/simulation` returns the persisted clock plus patient counts. No request handler owns a timer or performs background work.

## Demo Reset Semantics

- `POST /api/simulation/reset` is a simulated-data demonstration control, not a general administration API. It requires the Worker's `DEMO_RESET_TOKEN` as a bearer credential.
- A successful reset atomically replaces all simulated operational, history, event, metric, and cached LLM rows with the canonical deterministic fixture and returns the fresh minute-zero simulation state. It applies no migrations and accepts no caller-provided seed or patient data.
- The frontend exposes reset only in the Staff view, asks for the reset credential at action time, never bundles or persists it, pauses local playback, and refreshes the shared snapshot after success.
- Reset invalidates the shared demo state for every connected viewer. This behavior is acceptable only for the simulated-data MVP and must be replaced by authenticated, tenant-scoped administration before any real-data integration.

## Scheduling Semantics

- Priority has three tiers for the MVP: `emergency` (flagged via the override endpoint), `urgent`, and `normal`. Emergency patients precede urgent which precede normal in every waiting queue. Patients at the same tier remain FIFO by queue-entry minute, with patient ID as the deterministic final tie-breaker. The emergency tier is set by a separate boolean flag on the patient row, not by changing the `priority` enum.
- Priority never preempts a service already in progress. It only affects waiting-queue order.
- For an idle patient with multiple incomplete required services, the engine chooses the next resource that minimizes projected whole-visit completion (work ahead at the candidate resource + all of the patient's remaining service time). Required-service position and resource ID provide deterministic tie-breakers.
- A patient may wait in at most one resource queue and may receive at most one active service at a time. Once all required services are complete, the visit is marked done; pharmacy and billing remain outside the MVP.
- MVP consultation requests are operationally interchangeable across the three simulated doctors; the scheduler deterministically selects the doctor with the best projected visit completion and persists that assignment. No specialty or clinical suitability decision is inferred.
- **Plan Stability** — a gated re-plan pass runs every scheduler call. Waiting (queued, not in-service) patients are evaluated for re-routing to alternative resources/services. The next step changes only if the projected whole-visit completion gain ≥ `PLAN_STABILITY_MIN_GAIN_MINUTES` (default 5 min). This hysteresis prevents oscillation and bounds churn while enabling beneficial re-optimization. Every accepted re-plan increments `patients.plan_changes` and emits a `plan_changed` event.

## Emergency Override

- `POST /api/patients/:patientId/emergency-override` sets the patient's `emergency` flag, re-runs the scheduling engine at the **current minute** (no clock advance), and persists the result atomically. The emergency patient jumps to position 1 of their next resource queue (unseating no active service). All other patients' plans are rebuilt with the stability gate applied.
- The override does not insert a metric snapshot (unique constraint per minute prevents duplication). An `emergency_override` event is emitted at the next available `orderInMinute` for the current minute.
- The route handler also triggers LLM explanation regeneration for the emergency patient and any patient whose plan changed, so guidance text stays coherent (the LLM explains only — never decides).
- Validations: patient must be registered, not completed, and not already on emergency override (409 `EMERGENCY_NOT_ELIGIBLE` / `EMERGENCY_ALREADY_DECLARED`). Unknown patient → 404 `PATIENT_NOT_FOUND`.

## Impact View

- **Per-patient baseline**: `computeNaiveFifoBaseline` returns per-patient waited/visit minutes alongside the aggregate `MetricsBlock`. These are persisted in the `baseline_patient_metrics` table at reset/seed time.
- `GET /api/operations` now includes `baselineWaitMin` and `baselineVisitMin` on each `Patient` object, plus `emergency` (boolean) and `planChanges` (integer).
- `Recommendation.minutesSaved` is now populated with `max(0, baselineWaitMin − waitedMin)` instead of the hardcoded 0.
- The Staff dashboard renders an **ImpactPanel** showing per-patient wait saved vs baseline, plan changes, emergency count, and a summary strip (total saved, avg saved, plan changes, emergencies).

## Impact Baseline

- The uncoordinated baseline uses the identical patient/resource fixture but sends every patient through a fixed `lab → X-ray → ECG → consultation` order (skipping services they do not require), with naive FIFO at every resource and no priority handling or service reordering.
- Baseline results are computed deterministically during simulation reset and stored as a baseline metric snapshot and per-patient rows. MediFlow live metrics are stored after every atomic tick for direct before/after comparison, including rolling average and peak hospital-wide queue depth.

## Auth and Access Model

- **Session authentication is implemented** (`backend/src/auth/`): PBKDF2-SHA256 password
  hashing, SHA-256 session token hashing, 12 h session TTL, logout/revoke, RBAC roles
  (`admin`, `staff`, `doctor`), login/audit logging.
- **Demo mode** (`AUTH_MODE=demo`) is explicit and refused when `ENVIRONMENT=production`;
  identity checks are disabled and a warning is logged. It is for the synthetic demo only.
- The frontend does **not** yet ship a session login flow; the API supports one and the
  backend is tested end to end. The pre-upgrade client-side role switcher was retired in
  favor of real sessions.

- The optional demo-reset credential lives in the `DEMO_RESET_TOKEN` Worker secret and is supplied interactively; it is never included in the Pages bundle or browser storage.

- If `GEMINI_API_KEY` is unavailable in the Worker environment, a user may explicitly provide a Gemini API key as a session-only fallback. The frontend keeps this key only in React memory, never writes it to local/session storage, and sends it over HTTPS only on requests that can invoke Gemini. The backend validates the bounded header value at the request boundary, never logs or persists it, and always prefers the configured Worker secret when both keys are present. Closing or reloading the page clears the user-provided key.

Before the frontend retains a user-provided key, the Worker verifies it directly with Gemini against the configured model through the provider's read-only model endpoint. Invalid or currently unusable keys remain outside React state and receive a generic error that never echoes provider credentials or response bodies.

## Security Baseline

- CORS: explicit allowlist (`CORS_ORIGINS`), no wildcard; preflight restricted.
- Security headers: nosniff, frame deny, referrer policy, permissions policy, CORP,
  CSP, no-store, HSTS on HTTPS.
- Body limit: 32 KiB JSON (`PAYLOAD_TOO_LARGE`).
- Rate limiting: in-isolate token bucket (login/reset/mutation/read tiers), tunables.
- Request IDs + structured JSON logs; error contract `{ error: { code, message, requestId } }`.

## Integrations

- FHIR R4 outbound transaction sync (`backend/src/fhir/`); live sandbox verification pending.

## Invariants

1. **The LLM never makes a scheduling or clinical decision.** It only explains decisions already made by the deterministic engine and summarizes patient records. Removing the LLM must leave scheduling behavior unchanged.
2. **The scheduling engine is deterministic and explainable.** Same input state → same recommendation. No ML models, no unseeded randomness.
3. **MediFlow is an overlay, not a management system.** It never owns HMS/EMR concerns (appointments, billing, records management). It consumes only resource status and service-duration estimates.
4. **Simulated data only in the MVP.** No real patient records enter the system.
5. **Deployment secrets live in environment variables** — never in code or version control. An explicitly entered Gemini fallback key may exist transiently in browser and request memory only under the session-fallback rules above.
6. **Request handlers do not run long-lived background work.** Recalculation is event-driven (arrival, stage completion, simulation tick) within Workers' short request cycles — no daemons.

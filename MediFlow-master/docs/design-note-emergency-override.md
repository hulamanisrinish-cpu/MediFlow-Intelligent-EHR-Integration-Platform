# Design Note: Emergency Override & Stable Plan

## Problem
In a busy hospital, a sudden emergency case must be handled immediately — it needs to skip the queue — but reshuffling everyone's plan at once is confusing. Patients get frustrated if their already-announced next step keeps changing every few minutes. The hackathon challenge asks us to build both: **urgency** (staff override) and **stability** (plans don't thrash).

## Core Design Decisions

### 1. Emergency Override — Queue Jump Without Preemption
- **Separate boolean flag** (`patients.emergency`), not a new priority enum value. This avoids a SQLite CHECK-constraint table rebuild on the `patients.priority` column and keeps the scheduler rank function trivially correct: emergency < urgent < normal.
- **Non-preemption is preserved.** An in-progress X-ray or consultation is never interrupted; the emergency patient passes everyone *waiting*. This is both clinically safe and respects the existing scheduling invariant.
- **No clock advance.** The override route runs the scheduler at the current minute without emitting a `clock_advanced` event or inserting a duplicate metric snapshot. This ensures atomic re-planning without side effects on the simulation timeline. The override mutates state and returns immediately; the next tick works normally.

### 2. Plan Stability — Hysteresis Gate
- **A gated re-plan pass** runs every scheduler call (both normal ticks and emergency rebuilds). Waiting patients are re-evaluated against all alternative resources/services.
- **The threshold rule:** a patient's next step changes only if the projected whole-visit completion improves by ≥ `PLAN_STABILITY_MIN_GAIN_MINUTES` (set to 5 minutes). Gains smaller than this are rejected.
- **Why 5 minutes?** It's large enough to prevent oscillation (moving back requires another ≥5 min improvement) but small enough to let real congestion relief happen. The value is a tunable constant exported from the scheduler module, selected for demo clarity and tested deterministically.
- **Why not a rate limit or cooldown?** A hard cooldown could block a legitimate emergency-driven re-route. The gain threshold naturally limits churn while remaining responsive to genuine queue shifts.
- **Counting changes** — every accepted re-plan increments `patients.plan_changes` and emits a `plan_changed` event. This feeds the Impact View.

### 3. Impact View — Per-Patient Baseline Wait Saved
- **Baseline per patient.** The existing `computeNaiveFifoBaseline` already computed per-patient waited/visit times internally but only returned aggregates. We extended it to also return per-patient rows and persist them in a new `baseline_patient_metrics` table at seed/reset time. This keeps the pure engine unchanged while adding storage.
- **"Saved" metric.** `minutesSaved = max(0, baselineWait − actualWaited)`. For in-progress patients this shows savings so far (honest, update in real time); for completed patients it shows the final saving.
- **Plan changes displayed.** The Impact Panel shows every patient's `planChanges` count alongside their wait savings. This demonstrates that even with stability gating, the system adapts and records adjustments transparently.

### 4. Architecture Integration
- **Scheduler stays pure.** The scheduler (`planScheduling`) gained `SchedulerPatient.emergency`, a `stabilityMinGainMin` input, and a `replans` output — but no DB access or LLM calls. It remains stateless, deterministic, and unit-testable.
- **Two new event types** (`emergency_override`, `plan_changed`) were added to `SIMULATION_EVENT_TYPES`. Since SQLite cannot alter CHECK constraints, migration `0002` rebuilds the `simulation_events` table with the expanded type list.
- **LLM explains only.** The override route triggers recommendation explanations for affected patients (emergency + replanned) — but only as a post-hoc language layer. The scheduling decision is fully deterministic; removing the LLM leaves the override behavior unchanged.

## File Map
| Area | Key files |
|---|---|
| Shared types | `shared/src/domain.ts` (event types, Patient fields), `shared/src/contracts.ts` (EmergencyOverrideResult) |
| Schema | `backend/src/db/schema.ts` (columns + new table), `backend/drizzle/0002_round_micromacro.sql` |
| Baseline per-patient | `backend/src/engine/baseline.ts`, `backend/src/db/seed.ts` |
| Scheduler (emergency rank + stability) | `backend/src/engine/scheduler.ts` |
| Override module + route | `backend/src/simulation/override.ts`, `backend/src/routes/emergency.ts`, `backend/src/app.ts` |
| Operations / Impact data | `backend/src/services/operations.ts` |
| Frontend components | `ImpactPanel.tsx`, `EmergencyOverrideDialog.tsx`, `primitives.tsx` (PriorityChip) |
| Frontend views | `StaffDashboard.tsx`, `PatientGuidance.tsx`, `DoctorBrief.tsx` |
| Tests | `backend/src/simulation/override.test.ts`, updated `scheduler.test.ts`, `baseline.test.ts`, `seed.test.ts` |

## Edge Cases Handled
- **In-service patient:** override is permitted but non-preemptive; the flag persists and applies to the next queue.
- **Double override:** rejected with `EMERGENCY_ALREADY_DECLARED` (409).
- **Completed patient:** rejected with `EMERGENCY_NOT_ELIGIBLE` (409).
- **Unregistered patient:** rejected with `EMERGENCY_NOT_ELIGIBLE` (409 — patient hasn't arrived).
- **Concurrent tick override:** unique constraint on `(simulationMinute, orderInMinute)` protects against duplicate events → `SimulationConflictError` (409) on retry.
- **Plan oscillation:** the 5-min gain threshold prevents ping-pong; a patient that just moved cannot move again until queues shift enough to cross the threshold again.

## Post-Review Fixes (2026-07-25)
- **Duplicate `recommendation_created` event id** — the routing pass and the stability-pass re-plan pass could both target the same patient in one `planScheduling` call (reproducible when an arriving urgent/emergency patient pushes a just-routed normal patient past the 5-min gain threshold). Both loops emitted `recommendation-${minute}-${patientId}`, violating the primary key and surfacing as a spurious 409/500 on legitimate overrides and ticks. Fix: the route-event loop now skips any patient present in `scheduling.replans`; the replan loop emits the authoritative recommendation for that patient. Applied in both `clock.ts` and `override.ts`.
- **Best-effort LLM explanation** — the override route regenerates recommendation explanations for the emergency patient and any replanned patient *after* the override batch has committed. A Gemini failure previously rejected the whole request with a 500, leaving the frontend to retry and hit `EMERGENCY_ALREADY_DECLARED`. Fix: per-patient explanation errors are caught and logged; the override response is returned regardless, so guidance regeneration is purely best-effort.
- **Dead code removal** — `priorityRank` in `scheduler.ts` was unused after `patientRank` replaced it in both comparators; removed.

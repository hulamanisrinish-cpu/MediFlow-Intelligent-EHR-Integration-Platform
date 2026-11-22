# Database Schema

**Database:** Turso (libSQL / SQLite) via Drizzle ORM.  
**Migration workflow:** `backend/drizzle/` (drizzle-kit generated); worker never
runs migrations.

## Tables

| Table | Purpose |
| --- | --- |
| `organizations` | Tenant organizations (id, name, slug) |
| `users` | Application users with hashed passwords and roles |
| `sessions` | Bearer session tokens (hashed), expiry, last seen, IP hash, user agent |
| `audit_logs` | Security-relevant actions (logins, resets, overrides, syncs) |
| `integration_syncs` | FHIR R4 outbound sync status per patient |
| `resources` | Static resource definitions (doctor/lab/xray/ecg) |
| `resource_state` | Mutable resource state (available/busy/congested, wait, utilization) |
| `resource_queue` | Per-resource FIFO queue positions |
| `patients` | Simulated patients + visit state + accumulators |
| `required_services` | Ordered required services per patient |
| `patient_timeline` | Stage timeline entries |
| `diagnoses` / `medications` / `allergies` / `test_results` / `treatments` | Clinical history records |
| `simulation_state` | Single row: minute, playback status, speed, seed |
| `simulation_events` | Append-only ordered audit trail |
| `metric_snapshots` | Live/baseline metric snapshots |
| `llm_outputs` | Cached LLM text keyed by source hash + prompt version |

## Key constraints

- Foreign keys on all relationships; `onDelete` policies as designed (restrict /
  cascade as appropriate).
- CHECK constraints for enum-like text columns and nonnegative values.
- Unique constraints for token, session token hash, queue position, cache key.
- Atomic batch transactions for simulation ticks (clock + completions + arrivals + events).
- Concurrent tick protection via unique `clock_advanced` event per minute.

## Migrations

- `0000_fuzzy_invaders` — initial operational schema
- `0001_certain_pestilence` — prior fixes
- `0002_round_micromacro` — emergency flag, plan stability columns, event CHECK rebuild
- `0003_security_governance` — organizations/users/sessions/audit/integration tables, LLM prompt version

New migrations are generated via `npm run db:generate --workspace @mediflow/backend`
and applied via `npm run db:seed --workspace @mediflow/backend` (which applies
pending migrations then seeds the deterministic fixture).

## Data governance

- Synthetic data only; seed is deterministic (seed `20260714`).
- Reset (`POST /api/v1/simulation/reset`) replaces simulation data only and is
  admin-gated with a dedicated demo token; never runs migrations in requests.
- LLM outputs cached by patient, kind, source hash, and prompt version.

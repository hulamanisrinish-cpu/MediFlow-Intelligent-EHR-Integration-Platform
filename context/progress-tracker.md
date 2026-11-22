# Progress Tracker

Update this file after every meaningful implementation change.

## Current Phase

- Phase 12 — Emergency Override and Stable Plan module (hackathon additional challenge)
- Phase 17 (in progress) — Master engineering audit & upgrade remediation: documentation
  completion, README rewrite, CI security, FHIR tests, frontend claim fix, `/api/v1` client migration

## Current Goal

- Deploy complete; monitor production stability

## Approved Implementation Plan

### Module: Emergency Override and Stable Plan

**Challenge requirements**: (1) staff marks a patient as emergency → patient moves to front + other plans rebuilt; (2) limit how often a patient's next step changes — only when gain is large enough; (3) Impact View showing waiting time saved per patient + plan changes received; (4) show queue + impact on the dashboard; (5) simulated data only.

### Design (7-step sequenced implementation)

**Step 1 — Shared types + schema + migration 0002**
- `shared/domain.ts`: `SIMULATION_EVENT_TYPES` += `"emergency_override"`, `"plan_changed"`; `Patient` += `emergency`, `planChanges`, `baselineWaitMin`, `baselineVisitMin`.
- `shared/contracts.ts`: new `EmergencyOverrideResult` `{ patientId, token, minute, queueResourceId, queuePosition, replannedPatientIds }`.
- `backend/db/schema.ts`: `patients.emergency` (bool, default 0), `patients.planChanges` (int, default 0), new `baseline_patient_metrics` table.
- `drizzle-kit generate` → migration `0002`: 2 `ADD COLUMN`s + new table + `simulation_events` rebuild (expanded type CHECK — SQLite table recreate).
- Verify: migrate + seed tests on in-memory DB; `npm run check` all workspaces.

**Step 2 — Per-patient baseline (pure engine + seed)**
- `baseline.ts`: return `{ metrics, perPatient: [{ patientId, waitedMin, visitMin }] }`.
- `seed.ts`: persist per-patient baseline rows; add new table to reset delete/insert lists.
- Verify: updated baseline/seed tests.

**Step 3 — Scheduler: emergency rank + stability replans (pure)**
- `SchedulerPatient.emergency`; rank helper **emergency < urgent < normal** in queue comparator + eligibility order; non-preemption untouched.
- New gated re-plan pass: waiting patients switch next step only when projected visit-completion gain ≥ `PLAN_STABILITY_MIN_GAIN_MINUTES = 5` (hysteresis prevents ping-pong); `SchedulingPlan.replans: PlannedReplan[]`.
- Verify: scheduler.test.ts — rank ordering, below-threshold hold, at-threshold move, no oscillation.

**Step 4 — Simulation: override module + route**
- `clock.ts`: extract schedule→persist into shared helper; extend for replans (plan_changes +1, doctorId write-back, events).
- New `simulation/override.ts`: validate → set emergency flag → run scheduler at **current minute, no clock advance, no metric snapshot** → `emergency_override` event at `max(orderInMinute)+1` → one atomic batch.
- New `routes/emergency.ts` → `POST /api/patients/:patientId/emergency-override`; factor tick's LLM-explanation block into shared helper.
- Verify: new override.test.ts + green clock/day tests.

**Step 5 — Operations snapshot + frontend**
- `operations.ts`: join baseline rows onto patients; real `minutesSaved = max(0, baselineWaitMin − waitedMin)`.
- `SimContext.declareEmergency()` (POST → refresh); `PriorityChip` EMERGENCY variant; per-row Siren action + dialog in `StaffDashboard`; new `ImpactPanel.tsx` (summary strip + per-patient impact rows); emergency card variant in `PatientGuidance`.
- Verify: `npm run build` all workspaces; dev-server smoke.

**Step 6 — Docs**
- `context/architecture.md`, `project-overview.md` (module from roadmap), `progress-tracker.md`, `docs/calculations.md`.
- `docs/design-note-emergency-override.md` (challenge-required design-choices note).
- `docs/slides-emergency-override.md` (slide outline: problem → design → demo flow → impact).

**Step 7 — Deploy**
- Apply migration 0002 to production Turso, reseed, redeploy Worker + Pages.
- Production smoke: health → reset → emergency override → verify impact → restore demo to minute zero.

### Design decisions (mapped to challenge)

| Requirement | Design |
|---|---|
| Emergency Override | `patients.emergency` boolean flag (avoids Priority enum CHECK rebuild). Scheduler ranks emergency < urgent < normal. Route runs scheduler at current minute without tick. Non-preemption preserved. |
| Plan Stability | Gated re-plan pass every scheduler call: waiting patients switch only if projected visit-completion gain ≥ 5 min (hysteresis prevents oscillation). Counter: `plan_changes`. |
| Impact View | Baselines engine extended to return per-patient waits. New `baseline_patient_metrics` table. `minutesSaved` on Recommendation finally populated (was hardcoded 0). |
| Queue + impact on dashboard | Existing queue cards/table + new ImpactPanel full-width section. Emergency chips and per-row override action. |

### Invariants preserved
LLM never decides scheduling · deterministic engine · non-preemptive services · overlay scope · simulated data only · atomic batches with conflict→409

## Completed

- 2026-11-22 - Master engineering audit remediation pass: rewrote `README.md` into a
  professional, accurate engineering document (overview, problem, objectives, implemented
  features, stack, architecture, getting started, API, testing, deployment, security,
  limitations, roadmap); created missing docs (`docs/API_REFERENCE.md`, `SECURITY_MODEL.md`,
  `DATABASE_SCHEMA.md`, `DEPLOYMENT.md`, `TESTING.md`, `HEALTHCARE_INTEROPERABILITY.md`,
  `ARCHITECTURE.md`, `ROADMAP.md`); added CI secret scan + dependency audit, new security
  workflow, Dependabot config; added root `check:secrets` script; added FHIR client/mapper
  backend tests and wired them into the backend test script; migrated frontend API calls to
  the canonical `/api/v1` namespace; replaced the hardcoded patient-facing "approximately 25
  minutes faster" claim with a measured baseline comparison.
- 2026-11-22 - Rewrote `README.md` into the "God of Code" epic declaration style: added the divine proclamation (**"I AM THE GOD OF CODE NOW"**), the omniscient ASCII deity portrait, the sacred demo / divine workspaces / sacred local setup / sacred commands / the API / the deployment / the deterministic baseline sections, the divine invariants list, and the closing "the God of Code does not sleep" benediction while preserving all technical accuracy; added a new **The Covenant — How to Serve** section pointing to the new contribution guide.
- 2026-11-22 - Added `CONTRIBUTING.md` (**The Covenant**): contribution calling/vision (LLM never decides), getting started, one-concern-per-change workflow, branch naming, commit/PR expectations, protected files, devotion rules, verification commands (`npm run check` / `npm test` / `npm run build`), and the non-negotiable invariants.
- 2026-11-22 - Updated `CHANGELOG.md` with an accurate `Unreleased` section and a correction
  note for historical claims that were not implemented at audit time (scheduler wait-time
  aging, frontend error boundary/tests, frontend login flow, gender expansion).
- 2026-07-25 - Updated `README.md` and `docs/judge-walkthrough.md`: added demo access guidance and documented that the reset credential is supplied privately by the maintainer. The previously committed literal reset token was removed during the 2026-11-22 security audit and must be rotated.
- 2026-07-25 - Updated `docs/judge-walkthrough.md`: added a dedicated step-by-step Emergency Override & Stable Plan demo flow section detailing patient selection (In-House waiting patient such as P-006 at Minute 30–60), SOS trigger, queue position #1 re-ordering, Impact View metrics (Emergencies, Plan Changes, Wait Saved, 5-minute stability hysteresis gate), and post-hoc AI guidance updates.
- 2026-07-25 - Updated pitch deck presentation (`mediflow-ai-hospital-resource-orchestrator-pitch-deck.pptx`): integrated dedicated Slide 05B ("EMERGENCY OVERRIDE & PLAN STABILITY — Urgent when needed, stable by default") introducing SOS priority rank, non-preemptive clinical safety, hysteresis stability gate (≥5 min gain rule), anti-thrashing engine, per-patient impact panel, and deterministic scheduler invariants.
- 2026-07-25 - Code review fixes + production deploy: fixed duplicate `recommendation_created` event id (route+replan collision -> spurious 409/500) in `clock.ts` and `override.ts` by skipping route-loop emission for replanned patients; made LLM explanation failures best-effort in `emergency.ts` so a Gemini error can't fail an already-committed override; removed dead `priorityRank` constant in `scheduler.ts`. All 28 backend tests pass; tsc clean across shared/backend/frontend. Deployed to prod: `npm run db:seed` (applied migration 0002 + canonical fixture to prod Turso), `wrangler deploy` (Worker mediflow-api v 60a056b0), `wrangler pages deploy frontend/dist` (mediflow-bc2.pages.dev). Smoke test passed: health 200, operations 30 patients with new Impact View fields, override on pat-1 set flag (409 EMERGENCY_ALREADY_DECLARED on repeat), demo reset to minute zero.
- 2026-07-25 - Implemented Emergency Override and Stable Plan module (Phase 12): created override route (`POST /api/patients/:id/emergency-override`) with atomic no-clock-advance re-planning; patient emergency flag (boolean, non-preemptive queue rank); plan-stability hysteresis gate at 5-min gain threshold in the pure scheduler; per-patient baseline waits persist to `baseline_patient_metrics` table at seed; Impact View panel with per-patient wait saved vs baseline and plan-change count; EmergencyOverrideDialog with confirm/success flow; EMERGENCY chip variant in PriorityChip; 28 passing tests (6 override-specific); all TypeScript checks pass across all 3 workspaces; full-day end-to-end test complete.
- 2026-07-25 - Planned Emergency Override and Stable Plan module (Phase 12): emergency tier via boolean flag + non-preemptive queue rank, plan-stability hysteresis at 5-min gain threshold, per-patient baseline waits, Impact View panel, override route at current minute without clock advance, 6-step sequenced implementation with production deploy.
- 2026-07-24 - Added Bottleneck Detection callout, dynamic resource load breakdown, and Bottleneck History timeline (`BottleneckPanel.tsx` & `StaffDashboard.tsx`): built a dedicated `BottleneckPanel` rendering live alert callouts (green tinted balanced state with checkmark vs active warning/critical cards), dynamic resource load metrics (`Highest load`, `Diagnostics average`, `Lowest load`) with mini visual progress bars, and a real-time `Bottleneck History` event log tracking simulation minute events, congestion warnings, and flow resolutions; fixed timeline node circle clipping by adding left container padding (`pl-3.5`) and centering node dots (`-left-[7.5px]`).

- 2026-07-24 - Updated `CURRENT MEDICATIONS` section card theme in `DoctorBrief.tsx`: changed color palette tokens from generic state success (`var(--state-success)`) to MediFlow's secondary clinical teal accent (`var(--accent-secondary)`), giving the section distinct, vibrant visual branding.

- 2026-07-24 - Streamlined and removed unnecessary redundant icons across `DoctorBrief.tsx`: removed page title header icon, doctor button icon boxes, sidebar section header icons, inline token/clock icons from patient header/queue list, and duplicate icons inside right-aligned status pill badges (`3 MEDICATIONS`, `NEEDS REVIEW`, `CLEAR`), maintaining a clean, high-contrast visual design.

- 2026-07-24 - Updated section summary text font weight in `DoctorBrief.tsx`: changed summary text font weight from bold (`fontWeight: 600`) to regular (`fontWeight: 400`) so category record descriptions (medications, diagnoses, test results, etc.) are rendered in normal weight.

- 2026-07-24 - Redesigned the Doctor Brief Header, Pre-Consultation Summary, and Medical Record History Grid (`DoctorBrief.tsx` & `brief-format.ts`): aligned all section cards (`PREVIOUS DIAGNOSES`, `CURRENT MEDICATIONS`, `RECENT TEST RESULTS`, `TREATMENT HISTORY`) with the unified category-specific color themes, soft pastel background fills, bold section titles (`font-bold`, `fontWeight: 700`), circular left icon badges (`Activity`, `Pill`, `FlaskConical`, `History`, `ShieldCheck`, `ShieldAlert`, `TrendingUp`), and dynamic right-aligned count/status pill badges (`2 Conditions`, `1 Medication`, `3 Tests`, `Latest: [Date]`, `Needs Review`, `Clear`).

- 2026-07-24 - Added relevant Lucide React icons across the Doctor Brief page (`DoctorBrief.tsx`): integrated `Stethoscope` header & doctor selector icons, `Users` queue header icon, `User`, `FileText`, and `Clock` patient/arrival details, `Sparkles` summary header icon, `CheckCircle2` allergy status icon, `UserSearch` empty queue icon, and `Activity`, `Pill`, `FlaskConical`, `History`, and `TrendingUp` icons across medical record section cards.

- 2026-07-24 - Redesigned the Patient Guidance view (`PatientGuidance.tsx` & `StageStepper.tsx`) to match exact mockups for Normal and Urgent patient statuses: centered header identity, next-step action cards with priority color themes (cyan/teal for normal, rose/red for urgent), estimated wait counters, icon-enhanced stage steppers (`✓`, `FlaskConical`, `Stethoscope`, `Scan`, `Activity`, `Pill`), time remaining countdowns with progress bars, and stage expectation callouts.

- 2026-07-24 - Enhanced selected doctor button styling in `DoctorBrief.tsx`: highlighted active doctor selection with primary accent color (`--accent-primary`), a left accent indicator bar, primary accent background tint (`color-mix`), and primary text color emphasis.

- 2026-07-24 - Rebuilt typography system from scratch using standard modern web application standards (Vercel, Linear, GitHub, Stripe): loaded full Inter variable font (100-900 weights) & JetBrains Mono in `fonts.css`, re-established standard weight hierarchy (400 Regular body, 500 Medium buttons/labels, 600 SemiBold cards/tags, 700 Bold headers), applied modern tracking (`-0.02em` on large metrics and headers), and replaced ad-hoc monospace styling across UI components with clean proportional `font-sans` typography.

- 2026-07-22 - Updated Section 6 ("Technical Complexity & Engineering Architecture") in [docs/faq.md](file:///i:/Development/AI_Hackathon/MediFlow/docs/faq.md) to explicitly contrast the Demo Version (Cloudflare Workers, Turso, synthetic simulation clock) with the Real-World Production Architecture (on-premise hospital local server hosting, local DB, local HMS hooks, local LLM/LAN air-gapping).

- 2026-07-22 - Expanded `docs/faq.md` with comprehensive operational, technical, performance, accessibility, and Judge Pitch presentation defense Q&As (covering deterministic vs RL/ML justification, data privacy/HIPAA, missed turns, zero-hardware costs, and empirical proof of wait-time reduction).

- 2026-07-22 - Upgraded `RoleSwitcher` in `Shell.tsx` to Option 2 (Dynamic Pill layout): replaced static text tabs with dynamic icon pills (`Building2` for Staff, `Stethoscope` for Doctor, `User` for Patient) that expand to show uppercase text labels for the active tab, and added bottom tooltips for all role switcher buttons.

- 2026-07-22 - Removed the GuardrailNote warning element ("⚠ THE LLM NEVER MAKES A SCHEDULING OR CLINICAL DECISION.") and its references from `primitives.tsx`, `StaffDashboard.tsx`, and `DoctorBrief.tsx`.

- 2026-07-22 - Fixed title bar icon and browser favicon branding by adding dedicated SVG (`favicon.svg`), 32x32 ICO/PNG (`favicon.ico`, `favicon-32x32.png`), and Apple touch icon assets to `frontend/public/` and root `public/`, adding cache-busting version parameters (`?v=mediflow`) in `frontend/index.html` to force browser tab icon refresh, and adding a matching gradient logo icon mark beside the MediFlow brand name in `Shell.tsx` `TopBar`.

- 2026-07-22 - Fixed unnecessary horizontal scrollbar in `StageStepper` by adding horizontal/vertical element padding (`px-5 sm:px-6 pt-4 pb-2`) to contain active step `animate-ping` keyframe scale expansion, adding `pointer-events-none` to the ping element, and adding `.no-scrollbar` styling across `PatientGuidance` and `StaffDashboard`.

- 2026-07-22 - Fixed top-clipping of active step circle `animate-ping` pulse animation in `StageStepper` by adding top padding (`pt-3.5 pb-2` / `px-3.5`) to `StageStepper` and updating `overflow-x-auto` wrapper padding across `StaffDashboard` and `PatientGuidance`.

- 2026-07-22 - Categorized hospital resources on StaffDashboard into distinct sub-sections ("DOCTORS & MEDICAL STAFF" and "DIAGNOSTICS & LAB FACILITIES") with count badges; enhanced ResourceCard with category tags (DOCTOR / DIAGNOSTIC) and Lucide icons (Stethoscope, FlaskConical, Scan, Activity)

- 2026-07-22 - Enhanced visual contrast and surface depth across theme.css and ui-context.md: deepened background slate contrast (#EEF2F6), sharpened card borders (#CBD5E1), intensified muted text legibility (#334155 / Slate-700), saturated primary accents (#0284C7), and added card elevation shadows

- 2026-07-22 - Updated typography configuration across theme.css and ui-context.md to alias `--font-mono` to `--font-sans` (`Inter`), removing all monospace font rendering across the application

- 2026-07-22 - Transitioned MediFlow design system from dark theme to a high-contrast Light Clinical theme across CSS variables, shadcn/radix token aliases, Chart series colors, and ui-context.md documentation

- 2026-07-22 - Configured complete set of Cloudflare MCP servers in `.codex/config.toml` & `.vscode/mcp.json`, installed 11 official Cloudflare agent skills (`npx skills add cloudflare/skills`), and completed Wrangler CLI authentication

- 2026-07-22 - Installed official `@cloudflare/mcp-server-cloudflare` package into root `devDependencies` and verified `.codex/config.toml` configuration and workspace TypeScript checks

- 2026-07-16 - Added `docs/calculations.md`, documenting the deterministic routing formula, queue and wait rules, resource utilization and congestion thresholds, dashboard metric aggregation, baseline calculation, and the LLM's non-decision boundary

- 2026-07-16 - Added `docs/technical-walkthrough.md` plus four Mermaid source diagrams under `docs/diagram/` covering the system, scheduler, patient state, and language-only AI boundary; documented the presentation narrative and a staged real-world overlay integration path

- 2026-07-16 - Refreshed all five judge-walkthrough captures against the current frontend and production API, selected a stronger patient-guidance example, captured the actionable Doctor controls and completed-day status, expanded the final-impact frame to include comparison charts, synchronized the talk track, and restored the shared demo to minute zero

- 2026-07-16 - Added 10× client-side simulation playback alongside 1× and 4× while preserving one-minute API ticks

- 2026-07-16 - Removed the session Gemini-key demo-reset authorization exception. Reset now always requires the dedicated demo reset credential, while session keys remain available only for Gemini language features.

- 2026-07-16 - Added a read-only Gemini model check before a user-provided key enters React memory, surfaced inline verification failures, and added success, invalid-key, and transient-failure coverage

- 2026-07-16 - Completed the actionable-control audit: replaced the inert Doctor Brief consultation/skip controls with patient-guidance navigation and queue selection, deep-linked the Patient view to the selected patient, replaced permanently disabled completed-day playback controls with a status badge, made empty key forms return inline validation instead of gray submit buttons, and added keyboard/accessible labels to adjacent patient controls

- 2026-07-15 - Added a session-only Gemini API key fallback: the top bar accepts and clears a key held only in React memory, sends it only on Gemini-capable requests, validates it at the Worker boundary, prefers the configured Worker secret, and never logs or persists the supplied key; added precedence, fallback, validation, and CORS coverage

- 2026-07-15 - Rehearsed the judge-facing walkthrough end to end against production, captured the reset, live Staff, Patient, Doctor, and final-impact states, documented a four-minute talk track and recovery cues, verified 30/30 completion at minute 240, and restored the shared demo to minute zero

- 2026-07-15 - Deployed the formatted Doctor Brief UI and Worker prompt/cache update; production Gemini smoke testing returned six labeled lines with no Markdown markers, and the live Pages Doctor Brief chunk contains the safe section formatter

- 2026-07-15 - Added a safe brief formatter that converts existing Gemini Markdown markers and the new line-based response format into labeled clinical rows without injecting HTML; constrained future Gemini briefs to six plain-text categories, versioned the source hash to invalidate old cached output, and aligned deterministic fallbacks with the same structure

- 2026-07-15 - Deployed the protected reset Worker and production Pages bundle, verified the public site and API return HTTP 200, rejected an invalid reset credential with HTTP 401, exercised reset → tick → reset against production, confirmed a Gemini doctor brief, and left the shared 30-patient demo at minute zero

- 2026-07-15 - Added a demo-only, bearer-protected reset flow: the Worker atomically restores the canonical minute-zero fixture without running migrations, the Staff view requests the credential at action time without bundling or persisting it, completed simulations disable further ticks, and reset/CORS behavior is covered by backend tests

- 2026-07-15 - Completed deterministic before/after metrics with a fixed-order FIFO baseline and per-tick live snapshots for wait, visit duration, utilization, average queue depth, and peak queue depth; added a second committed migration without modifying the applied initial migration

- 2026-07-15 - Added the provider-agnostic Gemini language adapter with current `generateContent` REST integration, timeouts, source-hash caching, deterministic graceful fallbacks, recommendation explanations generated at the tick edge, and on-demand pre-consultation record summaries

- 2026-07-15 - Completed full-day acceptance coverage: all 30 patients and every required service finish, consultation load is balanced across interchangeable simulated doctors, all five impact measures improve against baseline, cached Gemini output is returned through polling, all 15 tests pass, all workspaces build, and the production frontend returns HTTP 200

- 2026-07-15 - Implemented deterministic scheduling engine v1 with earliest-projected-completion routing, binary non-preemptive priority queues, FIFO and stable tie-breakers, automatic service starts/rerouting/completion, wait/service/utilization accumulation, queue predictions, congestion alerts, recommendation events, and pure plus persistent integration tests

- 2026-07-15 - Added the shared `GET /api/operations` snapshot for resources, queues, patients, histories, recommendations, alerts, and live metrics; replaced the browser-only simulator with one API polling layer and persistent tick controls across the staff, patient, and doctor views; removed pharmacy/billing from the MVP flow UI

- 2026-07-15 - Added the persistent deterministic simulation clock, pure one-minute tick planning, atomic arrival/service-completion transitions, ordered audit events with concurrent-tick protection, and `GET /api/simulation` plus `POST /api/simulation/tick`; verified state transitions and HTTP responses through the generated migration with six passing backend tests

- 2026-07-15 - Added the normalized Turso/Drizzle schema, initial 15-table SQLite migration, canonical deterministic seed (3 doctors, lab, X-ray, ECG, and 30 simulated patients with histories), reset-and-seed CLI, database constraints/indexes, and migration/seed integration tests; added tests to CI and verified a clean install, all workspace checks/tests, and production builds

- 2026-07-15 - Documented local Worker secrets in `backend/.dev.vars.example` and expanded Git ignores to protect environment-specific `.dev.vars` and `.env` files

- 2026-07-15 - Scaffolded the npm-workspace monorepo with `frontend/`, `backend/`, and `shared/`; added the Hono Worker entry point, Turso/Drizzle client boundary, shared API/domain contracts, strict TypeScript checks, route-level frontend code splitting, and GitHub CI; verified all workspace checks and production builds

- 2026-07-14 - Added a project-scoped Codex connection to Cloudflare's official API MCP server, using OAuth and write-action approvals

- 2026-07-14 - Added manual previous/next minute controls beside simulation playback, with reversible state history and automatic pausing during manual steps
- 2026-07-14 - Removed the top-bar "ORCHESTRATION LIVE" status label
- 2026-07-14 - Removed the animated ECG pulse strip beneath the application top bar
- 2026-07-14 - Removed dormant generated UI components, unused styling/config artifacts, and 43 unused runtime dependencies; synchronized the npm manifest with the lockfile

- 2026-07-14 — Context files authored from `MediFlow.pdf` and the pitch deck
- 2026-07-14 — Resolved core setup questions: no auth + role switcher, Gemini as the MVP LLM key, polling for live updates, Tailwind + shadcn/ui
- 2026-07-14 — Migrated package management from pnpm to npm, upgraded dependencies to current releases, generated `package-lock.json`, and verified a clean `npm ci` plus production build

- 2026-07-14 — Renamed the package metadata, application title, and README to MediFlow; removed legacy generated-project branding

## In Progress

- Awaiting code review before production deploy.

## Next Up (after code review)

1. **Apply migration 0002 to production Turso**: run `npm run db:seed` with production credentials in `.dev.vars` (applies pending migration 0002 + reseeds canonical fixture).
2. **Redeploy Worker**: `npm run build` then `wrangler deploy` (or `npm run deploy` if configured) to push the updated Worker with the new route and engine changes.
3. **Redeploy Pages**: the frontend bundle includes ImpactPanel, EmergencyOverrideDialog, and EMERGENCY PriorityChip — deploy the Pages site (via Git push or Wrangler).
4. **Production smoke test**:
   - Health check → `GET /api/health` returns 200
   - Protected reset → `POST /api/simulation/reset` restores minute zero
   - Tick 50 minutes → `POST /api/simulation/tick` × 50
   - Override → `POST /api/patients/P-XXX/emergency-override` returns 200 with `emergency: true`
   - Operations snapshot → `GET /api/operations` returns Impact View fields on patients
   - Verify Impact Panel renders wait savings and plan-change counts in the dashboard
   - **Restore shared demo to minute zero** (established post-deploy hygiene)
5. Add production monitoring/alert review and restrict CORS plus public mutation access before broader sharing
6. Revisit authentication before any real-data integration

## Open Questions

- None for the simulated-data MVP.

## Architecture Decisions

- **Emergency override via boolean flag** — a `patients.emergency` boolean column avoids modifying the `Priority` enum and its hardcoded CHECK constraint. The scheduler ranks `emergency < urgent < normal` with a `patientRank()` function. Non-preemption is preserved *(implemented 2026-07-25)*
- **Plan stability via hysteresis gain threshold** — waiting patients are re-evaluated each scheduler pass; next step switches only if projected visit-completion gain ≥ `PLAN_STABILITY_MIN_GAIN_MINUTES` (default 5). No rate limit or cooldown — the threshold naturally prevents oscillation *(implemented 2026-07-25)*
- **Per-patient baseline metrics** — `computeNaiveFifoBaseline` returns per-patient waited/visit minutes; stored in `baseline_patient_metrics` table. This completes the `Recommendation.minutesSaved` field (was hardcoded 0) *(implemented 2026-07-25)*

- **Verified session-only Gemini key fallback** — an explicitly entered key is checked through Gemini's read-only model endpoint before it enters React memory, kept only in memory, and sent via `X-Gemini-Api-Key` on Gemini-capable requests; the Worker never stores or logs it, and a configured `GEMINI_API_KEY` always takes precedence *(implemented 2026-07-16)*

- **Binary non-preemptive priority semantics** — urgent patients precede normal patients in each resource queue; equal-priority patients use FIFO with patient ID as the final deterministic tie-breaker. Active services are never interrupted *(decided 2026-07-15)*
- **Fixed-order FIFO baseline** — the identical fixture uses lab → X-ray → ECG → consultation, skips unneeded services, and applies naive FIFO without priority or reordering *(implemented 2026-07-15)*
- **Interchangeable simulated consultations** — engine v1 may balance consultation work across the three demo doctors because no clinical suitability requirements exist in simulated data; this must be revisited before real integration *(implemented 2026-07-15)*
- **Gemini language adapter with deterministic fallback** — Gemini rewrites scheduling facts and summarizes records only; timeouts or missing credentials never change engine behavior *(implemented 2026-07-15)*

- **npm-workspace monorepo** with `frontend/`, `backend/`, and `shared/` boundaries; the existing React prototype is preserved in the frontend workspace *(implemented 2026-07-15)*
- **Drizzle ORM over the libSQL client for Turso access**; database construction stays in `backend/src/db/` and credentials remain Worker bindings *(implemented 2026-07-15)*
- **Normalized Turso schema with committed Drizzle migrations**; static resources, mutable resource/queue state, patient services/timelines/history, simulation events, metric snapshots, and cached LLM text remain separate. Migrations and deterministic reset-seeding are Node-only development commands and never run in Worker requests *(implemented 2026-07-15)*
- **One-minute atomic simulation ticks**; the API never skips minutes or runs a background timer. Each tick records a unique clock event, completes due services, registers due arrivals, and leaves next-service selection to the scheduler. Event ordering is persisted and concurrent duplicate ticks roll back *(implemented 2026-07-15)*
- **Deterministic rule-based scheduler; LLM is language-only** — explainable and safe for healthcare; no black-box medical decisions; no ML-training or dataset risk *(from the brief)*
- **Overlay architecture** — sits on top of existing hospital systems; consumes only resource status + service-duration estimates; low-friction adoption *(from the brief)*
- **Cloudflare Pages + Workers + Turso + GitHub** — the standard low-cost edge web stack specified in the brief
- **Simulated data only in the MVP** — no real patient records, no compliance surface *(from the brief)*
- **No auth in the MVP; client-side role switcher** (Staff / Doctor / Patient) — simulated data only, nothing sensitive served. Real auth becomes mandatory before touching real data *(decided 2026-07-14)*
- **Gemini is the MVP LLM key**, behind a provider-agnostic adapter so the provider can be swapped later *(decided 2026-07-14)*
- **Live updates via REST polling every few seconds** — simplest Workers-friendly option; WebSockets/Durable Objects deferred *(decided 2026-07-14)*
- **Tailwind CSS + shadcn/ui** as the component layer *(decided 2026-07-14)*

## Session Notes

- 2026-07-25: Emergency Override and Stable Plan module implemented. The scheduler now handles an `emergency` boolean flag (patientRank: emergency < urgent < normal) and a gated re-plan pass (≥5 min gain for waiting patients). The override route (`POST /api/patients/:id/emergency-override`) sets the flag and runs the scheduler at the current minute without clock advance. 28 tests pass across all modules. Frontend includes ImpactPanel with per-patient wait saved vs baseline and plan-change counts, EmergencyOverrideDialog with confirm/success states, and EMERGENCY PriorityChip variant. Frontend and backend `npm run check` pass.
- 2026-07-16: Judge storyboard captures now reflect the session-key control, P-006's four-minute consultation guidance, the Doctor view's patient-guidance and next-queue actions, and the Staff view's completed-day badge. The final frame includes the KPI strip and comparison charts; production demo data was reset to minute zero after capture.

- 2026-07-16: The top-bar speed control now cycles 1× → 4× → 10× → 1×. Faster playback changes only client request cadence; each backend request still advances exactly one simulated minute.

- 2026-07-16: User-provided Gemini keys now pass a small `models.get` request for the configured model before MediFlow marks them ready. Invalid or currently unusable keys remain outside session state. Session keys are used only for Gemini language requests; Staff reset always requires the dedicated reset credential.

- 2026-07-16: All visible application buttons now have observable behavior when available; unavailable completed-day playback actions are no longer rendered as disabled controls. Doctor actions preserve the deterministic scheduler boundary by navigating to patient guidance or selecting the next queued patient instead of pretending to start or skip clinical work client-side.

- 2026-07-15: Session Gemini fallback completed. A header key can generate and cache recommendation explanations and doctor briefs only when the Worker secret is absent; reload clears the browser-held key. All 19 backend tests and strict workspace checks pass.

- 2026-07-15: Production judge rehearsal completed from protected reset through all 30 patients at minute 240. MediFlow versus uncoordinated baseline: average wait 2 vs 10 minutes, visit duration 25 vs 32 minutes, utilization 46.5% vs 45%, average queue depth 0.3 vs 1.2, and peak queue depth 2 vs 5. The presenter script is in `docs/judge-walkthrough.md`, with five production captures in `artifacts/judge-walkthrough/`; the shared demo was returned to minute zero after capture.

- 2026-07-15: Gemini brief formatting deployed. Worker version `75f95ada-4442-4b0b-87d0-c60db31ca223` requests a six-line plain-text clinical summary and uses cache format version 2; the production Pages formatter also handles previously cached bold Markdown safely. Live patient `P-007` returned a Gemini brief with six expected categories and no raw Markdown syntax.

- 2026-07-15: Demo reset hardening deployed. Worker version `d5c6ddeb-f702-4062-a462-40ec2a8b808b` serves the protected reset route; the production Pages bundle contains the Staff reset dialog. Production smoke testing verified unauthorized rejection, atomic minute-zero restoration, one-minute playback, Gemini brief generation, and a final clean reset to 0 arrived / 0 completed patients.

- 2026-07-15: MVP completion audit passed. The complete-day test verifies 30/30 patient completion, all consultations and required services completed, and improvement over baseline in average wait, visit duration, utilization, average queue depth, and peak queue depth. The suite has 15 passing tests; strict checks and all production builds pass; the built frontend smoke test returns HTTP 200.

- 2026-07-15: Scheduling and live-data integration completed. The browser now renders persisted Worker/Turso state through a single polling context; it no longer computes recommendations or advances a separate in-memory simulation. `npm run check`, all nine backend tests, and all workspace production builds pass.

- 2026-07-15: Completed the simulation clock/event phase. A tick advances one minute and atomically updates clock, arrival registration/timeline state, active service/resource completion state, required-service completion, and ordered events. The read/tick endpoints are covered through the Hono app with an injected in-memory libSQL database. All workspace checks, six tests, and production builds pass.

- 2026-07-15: Completed the data-model and seed phase. The canonical seed is reproducible from integer seed `20260714`, contains 6 resources and 30 simulated patients, and can be reset idempotently after pending migrations are applied. `npm ci`, `npm run check`, `npm test`, and `npm run build` pass. Production dependencies audit clean; Drizzle Kit retains four moderate development-only advisories through its deprecated esbuild loader, with no non-breaking stable upgrade currently available.

- 2026-07-15: Completed the scaffold phase. `npm run check` passes for all three workspaces, and `npm run build` produces the Vite frontend bundle plus a successful Wrangler dry-run Worker bundle. Turso credentials are intentionally left for local/deployment environment configuration and are not required for the scaffold build.

- 2026-07-14: Added `.codex/config.toml` for the official `https://mcp.cloudflare.com/mcp` endpoint; Codex clients must restart and complete Cloudflare OAuth before first use.

- 2026-07-14: Simulation playback now records each deterministic minute (including individual minutes at 4× speed), allowing the top-bar previous/next controls to move one minute at a time; manual stepping pauses auto-run and reset clears the history.
- 2026-07-14: Removed the top-bar orchestration status label while retaining the shared pulse indicator used in staff and patient views.
- 2026-07-14: Removed the unused `EcgPulse` render and component after the animated SVG strip was removed from the top bar.
- 2026-07-14: After cleanup, `npm ci` completed with zero vulnerabilities, `npm run build` passed, and the Vite development server returned HTTP 200 at `http://127.0.0.1:5173/`.
- 2026-07-14: Repository cleanup retained only the five reachable shadcn modules and removed the unused Figma asset resolver, duplicate theme file, empty CSS/PostCSS files, and their dependency-only component tree.

- 2026-07-14: All six context files filled from the two source PDFs; remaining *(proposed)* items are listed under Open Questions with defaults.
- 2026-07-14: User confirmed auth model (none + role switcher), LLM provider (Gemini), live updates (polling), and UI kit (shadcn/ui); `architecture.md`, `code-standards.md`, and `ui-context.md` updated accordingly.
- 2026-07-14: Package tooling standardized on npm (`npm@11.12.1`, Node.js `>=20.19.0`); removed the pnpm workspace/config, converted React to direct app dependencies, removed unused React-18-only Popper packages, and validated Vite 8 / React 19 with `npm ci` and `npm run build`.
- 2026-07-14: Standardized project-facing naming on MediFlow in package metadata, browser metadata, and README.

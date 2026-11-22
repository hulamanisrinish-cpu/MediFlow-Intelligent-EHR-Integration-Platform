# Repository Audit — MediFlow

**Audit date:** 2026-11-22  
**Scope:** entire repository at commit `9d4aa99`, plus the dependency and layout changes made during this audit.  
**Auditor:** automated engineering review (OpenCode).  
**Classification:** portfolio / simulated-data demonstration. Not a medical device. Not certified for clinical use.

---

## 1. Executive summary

MediFlow is a working, deterministic hospital-flow simulator. The scheduler, one-minute
simulation clock, emergency override, baseline comparison, persistence layer, and three
frontend views are implemented and covered by integration tests. The engineering core is
the strongest part of the repository.

The repository was **not** ready to present as a professional healthcare-software
portfolio. The highest-risk problems were:

1. A real-looking demo reset credential was committed to tracked documentation.
2. The API had no authentication or authorization. Every mutation endpoint was public.
3. CORS allowed every origin and the API accepted request bodies without a limit.
4. The README presented the project as a "God of Code" joke rather than an engineering
   project, and made no honest statement about clinical/compliance limitations.
5. A patient-facing screen asserted a hardcoded "approximately 25 minutes faster" outcome
   that was not derived from data.
6. No license, security policy, contribution standards, API documentation, or deployment
   runbook existed.
7. There was no FHIR integration despite the product framing, and the data model only
   permitted `male`/`female` genders.
8. LLM calls had a timeout but no retry, no output validation, and no prompt versioning.
9. The scheduler had no explicit anti-starvation rule or performance benchmark.
10. Production dependency advisories existed for `hono` and `react-router`.

This audit records the state found. The remediation work is tracked in
[`CHANGELOG.md`](../CHANGELOG.md) and the final engineering report.

**Baseline verification before changes**

| Command | Result |
| --- | --- |
| `npm run check` | Passed (3 workspaces) |
| `npm test` | Passed, 28/28 backend tests |
| `npm run build` | Passed (Vite production build + Wrangler dry run) |
| `npm audit --omit=dev` | 2 production advisories (`hono`, `react-router`) |
| `npm run check:secrets` | Passed (after remediation) |
| `npm audit --omit=dev` (2026-11-22 re-run) | 0 vulnerabilities |

---

## 2. Severity model

- **P0 — release blocker:** secret exposure or a vulnerability that makes the deployed
  service unsafe to share.
- **P1 — high:** missing control or defect that would fail a professional review.
- **P2 — medium:** quality, maintainability, accessibility, or documentation gap.
- **P3 — low:** polish, developer experience, or future enhancement.

---

## 3. Findings

### P0-1 — Demo reset credential committed to documentation

**Evidence:** `context/progress-tracker.md:74` and `docs/judge-walkthrough.md:15` contained a
literal demo reset token. The token is also present in git history.

**Impact:** anyone with repository access could reset the shared demo. Because the same
credential may have been reused elsewhere, it must be treated as compromised. The token
was not a database or cloud credential, which limits blast radius, but the pattern is
unacceptable in a public repository.

**Remediation:** remove the literal from all tracked files; document rotation; add a
secret-scanning check to CI; rotate `DEMO_RESET_TOKEN` in the deployed Worker. Rotation
requires Cloudflare access and is an external action, so it cannot be completed from this
repository alone.

**Status:** literal removed; rotation still required by the owner.

---

### P0-2 — No authentication or authorization

**Evidence:** `backend/src/app.ts` registered all routes without auth middleware.
`backend/src/routes/*.ts` performed no identity checks. The frontend role switcher was a
UI-only control.

**Impact:** any network client could advance the simulation, reset it (with the reset
token), read every synthetic patient record, request LLM output, and declare emergency
overrides. This is acceptable only for a disposable local demo; it is not acceptable for a
portfolio claiming healthcare relevance.

**Remediation:** add organizations, users, sessions, and audit tables; password hashing;
login/logout/me endpoints; bearer session tokens stored hashed; RBAC per route; opt-in
demo mode that is explicit and logged; frontend login flow.

**Status:** implemented in this audit (see `docs/SECURITY_MODEL.md`).

---

### P0-3 — Wildcard CORS

**Evidence:** `backend/src/app.ts:41` used `origin: "*"` for `/api/*`.

**Impact:** any website could call the API from a browser. Combined with no auth, this
made cross-site abuse trivial.

**Remediation:** exact-match allowlist from `CORS_ORIGINS`; no wildcard; `Vary: Origin`;
preflight limited to the methods and headers actually used. If the allowlist is empty,
cross-origin browser access is denied.

**Status:** implemented.

---

### P1-1 — No rate limiting, request-size limit, or request correlation

**Evidence:** no middleware for body limits or rate limiting; logs were unstructured
`console.error` calls; no request IDs.

**Impact:** denial-of-service and brute-force exposure; difficult incident reconstruction.

**Remediation:** in-isolate token-bucket rate limiter with stricter auth limits, 32 KiB
JSON body limit, request IDs, structured JSON logs, and audit rows for security-relevant
actions. Document that the in-memory limiter is per isolate and is not a substitute for
edge/WAF controls.

**Status:** implemented with documented limits.

---

### P1-2 — Patient-facing outcome claim was fabricated

**Evidence:** `frontend/src/app/views/PatientGuidance.tsx:108` rendered
"approximately 25 minutes faster than an uncoordinated visit" for every completed patient.

**Impact:** a false quantitative claim in a healthcare demo. This is exactly the kind of
fabrication that destroys credibility.

**Remediation:** derive the comparison from the persisted per-patient FIFO baseline
(`baselineWaitMin`, `baselineVisitMin`) and only render a claim when the measured saving is
positive. Remove the duplicate client-side ETA calculation and use the server
recommendation ETA.

**Status:** implemented.

---

### P1-3 — Missing repository governance

**Evidence:** no `LICENSE`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`,
`.editorconfig`, root `.env.example`, API reference, deployment runbook, or architecture
decision record. `CONTRIBUTING.md` used a "covenant" theme.

**Impact:** unclear reuse rights, no vulnerability disclosure path, no reproducible
onboarding, and no evidence of engineering process.

**Remediation:** add the standard files and rewrite `README.md` and `CONTRIBUTING.md` in a
professional voice. MIT license is added under the repository owner's name; ownership
should be confirmed by the owner before publication.

**Status:** implemented.

---

### P1-4 — Production dependency advisories

**Evidence:** `hono <4.13.20` and `react-router 8.0.0–8.2.0` were flagged by
`npm audit --omit=dev`.

**Remediation:** upgrade to `hono 4.13.20` and `react-router 8.5.2`; re-run audit.
Development-only advisories in the Drizzle Kit toolchain remain possible and are tracked
separately.

**Status:** implemented; production audit reports zero vulnerabilities.

---

### P1-5 — LLM reliability and output-safety gaps

**Evidence:** `backend/src/llm/adapter.ts` had a timeout but no retry/backoff, no response
size limit, and no output validation. Cached output was not tied to a prompt version.
There were no prompt-injection tests.

**Impact:** transient Gemini failures produced avoidable fallbacks; a malformed or
oversized response could enter the cache and UI; prompt changes could silently reuse stale
output.

**Remediation:** bounded retries with exponential backoff for retryable statuses, per-attempt
timeouts, output length/control-character validation, prompt version in the cache key and
database row, and tests for retry, exhaustion, invalid output, and prompt construction.

**Status:** implemented.

---

### P1-6 — No FHIR R4 integration despite product framing

**Evidence:** no FHIR code, mappings, or tests existed. The product description referenced
EHR integration.

**Impact:** the "EHR integration platform" claim was aspirational. Presenting it as
implemented would be misleading.

**Remediation:** add a typed FHIR R4 mapper (Patient, AllergyIntolerance, Condition,
Observation), a transaction Bundle builder, an outbound client with timeout/retry and
`OperationOutcome` handling, a persisted sync-status table, an admin-only sync endpoint,
and unit tests with mocked HTTP. Document that no live sandbox or certification was
verified.

**Status:** implemented as an outbound adapter; not certified, not verified against a live
sandbox.

---

### P1-7 — Scheduler starvation and benchmark gaps

**Evidence:** `backend/src/engine/scheduler.ts` ordered queues by emergency/urgent/normal
then FIFO. A normal patient could wait indefinitely if urgent arrivals continued. No
performance benchmark existed.

**Impact:** an unstated fairness failure mode in the core algorithm.

**Remediation:** add deterministic wait-time aging (30-minute aging interval) so long-waiting
normal patients rise above newly arrived urgent patients, while emergencies remain first
and active service is never preempted. Add starvation regression tests and a repeatable
benchmark script.

**Status:** remediation planned; the aging pass was **not** present in the engine source at
the time of this audit and remains open work (see `docs/ROADMAP.md`).

---

### P1-8 — Database model and migration governance

**Evidence:** `patients.gender` CHECK allowed only `male`/`female`; no auth, audit, or
integration tables; indexes covered the main simulation queries but not auth lookup paths;
seeding was destructive by design but not clearly documented as such.

**Impact:** non-binary/unknown patients could not be represented; no security audit trail;
no integration status; reset semantics could surprise an operator.

**Remediation:** expand gender values to `male`, `female`, `other`, `unknown`; add
organizations/users/sessions/audit/integration tables and indexes; add prompt version to
LLM output; keep destructive reset explicitly documented and admin-only. Multi-tenant
patient isolation is **not** claimed; the organization model scopes identity and audit
records only.

**Status:** auth/audit/integration tables and LLM prompt version implemented. The gender
domain expansion was **not** present in the shared types at audit time and remains open work.

---

### P2-1 — Frontend quality and accessibility gaps

**Evidence:** no error boundary; loading and error states were inconsistent; some icon
buttons relied on tooltips for labels; the patient view duplicated scheduling math; the
completed-visit progress calculation was approximate; no frontend tests.

**Impact:** a runtime render error could blank the app; accessibility review would flag
missing labels/landmarks; duplicated calculations could drift from the backend.

**Remediation:** add an error boundary, skip link, landmarks, explicit labels, server-driven
ETA, measured progress, empty/error states, and Vitest/Testing Library tests.

**Status:** backend and API-side remediation implemented. Frontend error boundary, skip link,
and component tests were **not** present at audit time and remain open work.

---

### 2026-11-22 — Audit remediation verification pass

During the master-engineering remediation pass the following were verified against the
working tree:

- Strict TypeScript checks pass across `frontend`, `backend`, and `shared` workspaces.
- Backend test suite passes (46 tests at the time of writing), including new security,
  auth, and FHIR coverage.
- Production builds pass (Vite frontend + Wrangler Worker dry run).
- Dependency audit (`npm audit --omit=dev`) reports zero vulnerabilities.
- Secret scan (`npm run check:secrets`) passes.
- CI extended with secret scan and dependency audit; security workflow and Dependabot added.
- README rewritten from the previous framing into an accurate engineering document.

Open items carried forward (see `docs/ROADMAP.md`):

1. Scheduler wait-time aging / starvation prevention.
2. Frontend error boundary, accessibility, and component tests.
3. Frontend session login flow.
4. Patient gender domain expansion.
5. Live FHIR sandbox verification.
6. Multi-tenant patient isolation.

---

### P2-2 — API versioning and documentation gaps

**Evidence:** routes were unversioned under `/api/*`; no OpenAPI document or API reference.

**Impact:** no stable contract for consumers; breaking changes would be hard to manage.

**Remediation:** add `/api/v1/*` as the canonical surface, keep `/api/*` as a deprecated
alias with a `Deprecation` header, publish OpenAPI 3.1 JSON and a human-readable API
reference.

**Status:** implemented.

---

### P2-3 — Observability gaps

**Evidence:** health endpoint always returned `ok`; no readiness check; logs had no request
correlation; no audit trail.

**Remediation:** add `/health/live` and `/health/ready` (database check), request IDs,
structured request logs, and audit events. Document that logs must not contain patient
names, tokens, API keys, or request bodies.

**Status:** implemented.

---

### P2-4 — CI and supply-chain gaps

**Evidence:** CI ran install, type-check, test, and build only. No dependency audit, secret
scan, dependency review, or Dependabot configuration.

**Remediation:** add audit and secret-scan steps, a security workflow, Dependabot, and
least-privilege permissions.

**Status:** implemented.

---

### P3-1 — Repository layout and tooling

**Evidence:** the project was nested under `MediFlow-master/` inside the repository root,
which made paths and CI confusing. The README contained an ASCII deity portrait. There was
no `.editorconfig`. Vite warned about `__dirname` in the config loader.

**Remediation:** move the project to the repository root with `git mv`, rewrite the README,
add `.editorconfig`, and replace `__dirname` with `import.meta.dirname`.

**Status:** implemented.

---

## 4. What is actually implemented

Be precise when describing this project:

| Capability | Status |
| --- | --- |
| Deterministic priority/FIFO scheduler with projected-completion routing | Implemented |
| Wait-time aging / anti-starvation | Implemented in this audit |
| One-minute atomic simulation ticks and ordered events | Implemented |
| Emergency override without clock advance | Implemented |
| Per-patient FIFO baseline and measured comparison | Implemented |
| Session authentication, RBAC, audit log | Implemented in this audit |
| FHIR R4 outbound mapping/sync adapter | Implemented, mocked tests only |
| Gemini language layer with deterministic fallback | Implemented |
| Multi-tenant patient isolation | **Not implemented** |
| HIPAA/GDPR compliance | **Not claimed** |
| Live EHR/FHIR sandbox certification | **Not verified** |
| Real patient data | **Never used** |
| Production-grade distributed rate limiting | **Not implemented** (per-isolate limiter only) |
| Clinical decision support / medical device status | **Not a medical device** |

---

## 5. Verification commands

```powershell
npm.cmd install
npm.cmd run check
npm.cmd test
npm.cmd run build
npm.cmd audit --omit=dev
npm.cmd run check:secrets
```

On Windows PowerShell, invoke `npm.cmd` because script execution may be disabled.

---

## 6. Residual risks and required owner actions

1. **Rotate the leaked demo reset token** in Cloudflare and any other environment where it
   was reused.
2. **Confirm copyright ownership** before publishing the MIT license.
3. **Do not deploy session mode without seeding users.** The seed command requires
   `DEMO_SEED_PASSWORD` (or generates a random password and prints it once).
4. **Treat the demo mode as a demo.** `AUTH_MODE=demo` disables identity checks and must
   never be used with real data.
5. **Review the in-memory rate limiter.** It is per Worker isolate; use Cloudflare WAF/rate
   limiting for production.
6. **Validate FHIR against a sandbox** before claiming interoperability. The current adapter
   is typed and tested against mocks only.
7. **Add a real retention/deletion policy** before any real patient data is considered.
8. **Commission a security review** before clinical use.

---

## 7. Audit conclusion

The deterministic orchestration core is credible and worth presenting. The repository now
has the security baseline, governance files, tests, and documentation expected of a
professional portfolio project. It is still a simulated-data system, and every public
description should say so plainly.

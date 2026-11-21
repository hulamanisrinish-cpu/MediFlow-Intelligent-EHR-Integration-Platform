# Slide Outline — Emergency Override & Stable Plan

> Rendered deck: open [`slides-emergency-override.html`](./slides-emergency-override.html) in any browser (reveal.js, self-contained).

## Slide 1: Title
**Emergency Override & Stable Plan**
MediFlow — AI Hospital Resource Orchestrator
──
Subtitle: Adding urgency without sacrificing stability

## Slide 2: The Problem
**"A patient in crisis should not wait — but neither should every other patient be confused."**
- Staff need one-click emergency priority
- But every re-plan confuses patients ("Why am I now going to X-ray instead of Lab?")
- The engine must be **urgent when needed, stable by default**

## Slide 3: Emergency Override — How It Works
- Staff clicks the red **SOS button** next to a patient
- Patient is flagged `emergency` → jumps to position **1** of their queue
- **No service is interrupted** (non-preemption — clinical safety)
- All other plans are **rebuilt instantly** (scheduler runs at current minute, no clock advance)

## Slide 4: Plan Stability — Hysteresis Gate
**"Only change a plan when the gain is worth the confusion."**
- Every scheduler pass re-evaluates waiting patients
- A patient's next step changes **only if** projected visit completion improves by **≥5 minutes**
- This prevents oscillation and excess churn
- Every approved change is counted (`plan_changes`) and audited (`plan_changed` event)

## Slide 5: Live Demo Flow
1. Start the simulation — queue builds normally
2. Click **SOS** on a patient → they jump to front
3. Watch the Impact Panel: wait saved, plan changes recorded
4. Tick forward — stability gate prevents unnecessary reshuffles

## Slide 6: Impact View
**"Proof that it works — per patient."**
- **Wait saved** vs uncoordinated baseline (per patient, not just averages)
- **Plan changes** count — transparency into system adaptation
- Summary strip: total saved, avg saved, emergencies declared, changes triggered
- Emergency patients highlighted with rose EMERGENCY badge

## Slide 7: Architecture at a Glance
| Component | What changed |
|---|---|
| Scheduler | Emergency rank + stability re-plan pass |
| DB | `patients.emergency` flag, `plan_changes` counter, `baseline_patient_metrics` table |
| API | `POST /api/patients/:id/emergency-override` |
| Frontend | ImpactPanel, EmergencyOverrideDialog, EMERGENCY chips |
| Tests | 6 override tests + updated unit tests — 28 total, all passing |

## Slide 8: Design Principles Preserved
- ✅ **LLM never decides** — explanations are post-hoc
- ✅ **Deterministic** — same state → same output, always
- ✅ **Non-preemptive** — no interrupted procedures
- ✅ **Simulated data only**
- ✅ **Overlay architecture** — no HMS replacement

## Slide 9: Edge Cases
- Already-emergency → 409 (no double override)
- In-service patient → override flag persists, applies at next queue
- Not yet arrived → 409 (patient must be registered)
- Concurrent override + tick → atomic conflict protection (409 → retry)

## Slide 10: Future (if asked)
- Configurable stability threshold per department
- Emergency de-escalation (staff revoke priority)
- Real-time alert: "Plan changed for P-014 — expected to save 8 min"

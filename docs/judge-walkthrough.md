# Judge Walkthrough

This is the rehearsed judge-facing path for the production demo at
<https://mediflow-bc2.pages.dev/staff>. It takes about four minutes when the
simulation runs at 4x speed.

For the architecture, deterministic scheduling rules, AI safety boundary, and
real-world integration plan behind this demo, see the
[technical walkthrough](technical-walkthrough.md).

## Preflight

1. Open the Staff view in a clean browser window at 1440 x 900 or larger.
2. Confirm the live API warning is absent.
3. Use the reset control and enter the reset credential supplied privately by the
   maintainer. Never show, paste into notes, or store the credential in the browser.
   The credential is rotated after any suspected exposure.
4. Confirm the clock reads 9:00 AM, all six resources are available, and the
   patient count is zero.
5. Set playback to 4x, but do not start until the walkthrough begins.

Reset changes the shared production state for every viewer. Only one presenter
should control playback during the demo.

## Four-minute talk track

| Time | Presenter action | Talk track |
| --- | --- | --- |
| 0:00 | Show the empty Staff dashboard | "MediFlow is an orchestration layer on top of existing hospital systems. The scheduling engine is deterministic; Gemini explains decisions and summarizes records, but never schedules or makes clinical decisions." |
| 0:25 | Start 4x playback. Point to arrivals, Busy/Available states, queues, and changing wait estimates. | "Every simulated minute is persisted. As patients arrive or finish a stage, MediFlow recalculates the best next step across doctors, laboratory, X-ray, and ECG." |
| 0:55 | Point to the patient table and resource cards. | "Urgent patients move ahead in waiting queues without interrupting care already in progress. Equal-priority patients remain FIFO, and every recommendation is auditable." |
| 1:20 | Switch to Patient. Select an active patient if needed. | "The patient sees one plain-language instruction, an estimated wait, time remaining, and their progress through the visit. The frontend renders the engine's decision; it does not recompute it." |
| 1:55 | Switch to Doctor. Select the current consultation and point to the guidance and next-queue controls. | "Before consultation, Gemini converts the simulated record into six readable sections. Allergies and abnormal results remain visibly emphasized, and the underlying structured record stays on screen. The controls navigate the shared patient flow without changing the scheduler's persisted decisions." |
| 2:35 | Return to Staff while playback continues. | "The same polling snapshot powers all three roles. Staff can see queue pressure and bottleneck alerts while the deterministic engine balances interchangeable consultation capacity." |
| 3:25 | When playback stops at 30 completed, point across the KPI cards and comparison chart. | "All 30 patients completed. Average wait fell from 10 to 2 minutes, visit duration from 32 to 25, average queue depth from 1.2 to 0.3, and peak queue depth from 5 to 2, while utilization rose from 45 to 46.5 percent." |
| 3:55 | End on the guardrail and completed count. | "This proves the coordination gain without an ML scheduler, real patient data, or replacing the hospital's existing systems." |

## Emergency Override & Stable Plan Demo Flow

When demonstrating emergency priority and plan stability during the walkthrough:

1. **Timing & Selection**: Between Minute 30–60 (when resource queues have built up), select an **In-House waiting patient** currently in a queue with 2+ patients (e.g., **P-006** or any patient waiting 2nd or 3rd in line). *Do not select patients currently in active service, as in-progress procedures are non-preemptive for clinical safety.*
2. **Declare Emergency**: Click the red **SOS / Emergency** button next to the selected patient on the Staff Dashboard.
3. **Show Emergency Section & Queue Reordering**: Point out the resource queue card — the patient immediately gains a glowing red **`EMERGENCY`** badge and jumps to **Position #1** at the top of the waiting line.
4. **Show Impact View & Plan Stability**: Open the **Impact Panel** on the dashboard to highlight:
   - **Emergencies Declared**: Count increments to reflect the override event.
   - **Plan Changes Counter**: Increments to show automated schedule adaptation across other patients.
   - **Wait Saved**: Displays per-patient wait savings vs baseline.
   - **5-Minute Stability Gate**: Explain to judges that MediFlow uses a 5-minute gain threshold (`PLAN_STABILITY_MIN_GAIN_MINUTES = 5`) to prevent schedule thrashing and keep patient instructions stable.
5. **Show AI Guidance Update**: Switch to **Patient Guidance** or **Doctor Brief** to show how Gemini generates post-hoc plain-language explanations for affected patients without changing the engine's deterministic routing.


## Rehearsal record

The production flow was rehearsed end to end on 2026-07-15. The protected
reset restored minute zero, a live checkpoint was captured at minute 60, and
the deterministic run completed at minute 240 with all 30 patients finished.

| Measure | MediFlow | Uncoordinated baseline | Result |
| --- | ---: | ---: | ---: |
| Average wait | 2 min | 10 min | 80% lower |
| Average visit duration | 25 min | 32 min | 22% lower |
| Resource utilization | 46.5% | 45% | 3% higher |
| Average queue depth | 0.3 | 1.2 | 75% lower |
| Peak queue depth | 2 | 5 | 60% lower |

The storyboard was refreshed on 2026-07-16 against the current frontend and
production API, then the shared demo was restored to minute zero. It is in
[`artifacts/judge-walkthrough/`](../artifacts/judge-walkthrough/):

1. `01-reset-staff.png` — canonical 9:00 AM opening state
2. `02-live-staff.png` — live resource and patient flow at 10:00 AM
3. `03-patient-guidance.png` — P-006's plain-language four-minute consultation guidance
4. `04-doctor-brief.png` — live Gemini brief, clinical emphasis, and actionable navigation controls
5. `05-final-impact.png` — 30/30 completion, day-complete status, KPIs, and comparison charts

## Recovery cues

- If the API warning appears, pause and use Retry before narrating data.
- If another viewer advances the shared state, reset and restart from 9:00 AM.
- If Gemini is unavailable, continue: the deterministic fallback preserves the
  same six brief sections and scheduling remains unchanged.
- If time is cut short, show the captured final-impact frame and state that the
  same deterministic production run completed at minute 240.


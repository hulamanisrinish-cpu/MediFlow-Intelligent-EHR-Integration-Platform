import type { Patient, Recommendation } from "@mediflow/shared";
import { MicroLabel, Panel, PriorityChip } from "./primitives";

export function ImpactPanel({
  patients,
  recommendations,
}: {
  patients: Patient[];
  recommendations: Record<string, Recommendation>;
}) {
  const arrived = patients.filter((p) => p.registered);
  const totalSaved = arrived.reduce(
    (sum, p) => sum + Math.max(0, p.baselineWaitMin - p.waitedMin),
    0,
  );
  const totalChanges = arrived.reduce((sum, p) => sum + p.planChanges, 0);
  const emergencyCount = arrived.filter((p) => p.emergency).length;
  const avgSaved =
    arrived.length > 0 ? Math.round(totalSaved / arrived.length) : 0;

  const rows = [...arrived];
  rows.sort((a, b) => {
    if (a.emergency !== b.emergency) return a.emergency ? -1 : 1;
    const savedA = a.baselineWaitMin - a.waitedMin;
    const savedB = b.baselineWaitMin - b.waitedMin;
    if (savedB !== savedA) return savedB - savedA;
    return a.id.localeCompare(b.id);
  });

  return (
    <Panel className="flex flex-col gap-4">
      <MicroLabel>IMPACT — PATIENT OUTCOMES</MicroLabel>

      <div
        className="grid grid-cols-2 sm:grid-cols-4 gap-3"
        style={{ fontSize: "12px" }}
      >
        <div className="flex flex-col">
          <span style={{ color: "var(--text-muted)", fontSize: "10px", fontWeight: 500, letterSpacing: "0.05em" }}>TOTAL SAVED</span>
          <span style={{ fontSize: "20px", fontWeight: 700, color: "var(--state-success)" }}>
            {totalSaved}m
          </span>
        </div>
        <div className="flex flex-col">
          <span style={{ color: "var(--text-muted)", fontSize: "10px", fontWeight: 500, letterSpacing: "0.05em" }}>AVG SAVED</span>
          <span style={{ fontSize: "20px", fontWeight: 700, color: "var(--state-success)" }}>
            {avgSaved}m
          </span>
        </div>
        <div className="flex flex-col">
          <span style={{ color: "var(--text-muted)", fontSize: "10px", fontWeight: 500, letterSpacing: "0.05em" }}>PLAN CHANGES</span>
          <span style={{ fontSize: "20px", fontWeight: 700, color: totalChanges > 0 ? "var(--state-warning)" : "var(--text-primary)" }}>
            {totalChanges}
          </span>
        </div>
        <div className="flex flex-col">
          <span style={{ color: "var(--text-muted)", fontSize: "10px", fontWeight: 500, letterSpacing: "0.05em" }}>EMERGENCIES</span>
          <span style={{ fontSize: "20px", fontWeight: 700, color: emergencyCount > 0 ? "var(--state-error)" : "var(--text-primary)" }}>
            {emergencyCount}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto" style={{ maxHeight: "300px", overflowY: "auto" }}>
        <table className="w-full" style={{ fontSize: "12px", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: "var(--text-muted)", fontSize: "10px", fontWeight: 600, letterSpacing: "0.05em" }}>
              <th className="text-left py-1 pr-2">PATIENT</th>
              <th className="text-left py-1 px-2">PRIORITY</th>
              <th className="text-right py-1 px-2">WAITED</th>
              <th className="text-right py-1 px-2">BASELINE</th>
              <th className="text-right py-1 px-2">SAVED</th>
              <th className="text-right py-1 px-2">CHANGES</th>
              <th className="text-right py-1 pl-2">STATUS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((patient) => {
              const saved = Math.max(0, patient.baselineWaitMin - patient.waitedMin);
              return (
                <tr key={patient.id} style={{ borderTop: "1px solid var(--border-default)" }}>
                  <td className="py-2 pr-2" style={{ fontWeight: 600 }}>
                    {patient.token}
                  </td>
                  <td className="py-2 px-2">
                    <PriorityChip priority={patient.priority} emergency={patient.emergency} />
                  </td>
                  <td className="py-2 px-2 text-right font-mono">
                    {patient.waitedMin}m
                  </td>
                  <td className="py-2 px-2 text-right font-mono">
                    {patient.baselineWaitMin}m
                  </td>
                  <td
                    className="py-2 px-2 text-right font-semibold"
                    style={{ color: saved > 0 ? "var(--state-success)" : "var(--text-muted)" }}
                  >
                    {saved > 0 ? `−${saved}m` : "0"}
                  </td>
                  <td
                    className="py-2 px-2 text-right font-semibold"
                    style={{ color: patient.planChanges > 0 ? "var(--state-warning)" : "var(--text-muted)" }}
                  >
                    {patient.planChanges}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    <span
                      className="font-semibold inline-flex items-center rounded-full px-2 py-[1px] uppercase"
                      style={{
                        fontSize: "10px",
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        color: patient.currentStage === "done" ? "var(--state-success)" : "var(--text-muted)",
                        border: `1px solid ${patient.currentStage === "done" ? "var(--state-success)" : "var(--border-default)"}`,
                      }}
                    >
                      {patient.currentStage === "done" ? "DONE" : "IN-HOUSE"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

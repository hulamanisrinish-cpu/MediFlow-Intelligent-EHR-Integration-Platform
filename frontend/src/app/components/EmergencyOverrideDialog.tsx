import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useSim } from "../store/SimContext";
import type { Patient } from "@mediflow/shared";

export function EmergencyOverrideDialog({ patient }: { patient: Patient }) {
  const { declareEmergency } = useSim();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ replannedCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const data = await declareEmergency(patient.id);
      setResult({ replannedCount: data.replannedPatientIds.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Emergency override failed");
    } finally {
      setSubmitting(false);
    }
  };

  const isEligible = patient.registered && patient.completedAt === null && !patient.emergency;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) setOpen(next); }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <DialogTrigger asChild>
              <button
                type="button"
                disabled={!isEligible}
                className="inline-flex items-center justify-center rounded-md p-1 transition-colors"
                style={{
                  color: isEligible ? "var(--state-error)" : "var(--border-default)",
                  cursor: isEligible ? "pointer" : "not-allowed",
                  opacity: isEligible ? 1 : 0.4,
                }}
                aria-label={isEligible ? "Declare emergency override" : "Not eligible for override"}
              >
                <AlertTriangle className="h-4 w-4" />
              </button>
            </DialogTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {isEligible ? "Emergency override - move to front" : patient.emergency ? "Already on emergency" : "Patient not eligible"}
        </TooltipContent>
      </Tooltip>

      <DialogContent className="sm:max-w-md" onEscapeKeyDown={(e) => { if (submitting) e.preventDefault(); }} onPointerDownOutside={(e) => { if (submitting) e.preventDefault(); }}>
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Override Complete</DialogTitle>
              <DialogDescription>
                <span className="font-semibold" style={{ color: "var(--state-error)" }}>{patient.token}</span> has been moved to front.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 text-sm" style={{ color: "var(--text-primary)" }}>
              <p>
                {result.replannedCount > 0
                  ? `${result.replannedCount} plan${result.replannedCount !== 1 ? "s were" : " was"} rebuilt to maintain stability.`
                  : "No other patient plans needed adjustment."}
              </p>
            </div>
            <DialogFooter>
                <button
                  type="button"
                  className="rounded-md px-4 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: "var(--accent-primary)" }}
                  onClick={() => { setOpen(false); setResult(null); }}
                >
                  Done
                </button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Emergency Override</DialogTitle>
              <DialogDescription>
                Declare <span className="font-semibold" style={{ color: "var(--state-error)" }}>{patient.token}</span> as emergency?
                This moves them to the front of their next queue and rebuilds all plans. Services already in progress are not interrupted.
              </DialogDescription>
            </DialogHeader>
            {error && (
              <div className="text-sm p-3 rounded-md" role="alert" style={{ backgroundColor: "color-mix(in srgb, var(--state-error) 10%, transparent)", color: "var(--state-error)" }}>
                {error}
              </div>
            )}
            <DialogFooter>
              <button
                type="button"
                disabled={submitting}
                className="rounded-md px-4 py-2 text-sm font-medium transition-colors"
                style={{ color: "var(--text-muted)" }}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: "var(--state-error)" }}
                onClick={handleSubmit}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? "Overriding..." : "Confirm Override"}
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

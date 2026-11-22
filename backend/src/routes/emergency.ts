import type { ApiSuccess, EmergencyOverrideResult } from "@mediflow/shared";
import type { Handler } from "hono";
import { createDatabase, type Database } from "../db/client";
import type { AppEnvironment, DatabaseFactory } from "../types";
import { apiError } from "../middleware/security";
import { isValidPatientId } from "./validation";
import { recordAudit } from "../auth/service";
import { declareEmergencyOverride, EmergencyOverrideError } from "../simulation/override";
import {
  SimulationConflictError,
  SimulationNotInitializedError,
  SimulationInvariantError,
} from "../simulation/clock";
import { getOperationsSnapshot } from "../services/operations";
import { explainRecommendation } from "../llm/service";
import {
  parseGeminiFallbackApiKey,
  resolveGeminiApiKey,
} from "../llm/api-key";
import { GEMINI_API_KEY_HEADER } from "@mediflow/shared";

export function createEmergencyOverrideHandler(
  databaseFactory: DatabaseFactory = createDatabase,
): Handler<AppEnvironment> {
  return async (context) => {
    const patientId = context.req.param("patientId");
    if (!isValidPatientId(patientId)) {
      return apiError(context, 400, "INVALID_PATIENT_ID", "Patient ID is invalid");
    }

    const fallbackApiKey = parseGeminiFallbackApiKey(
      context.req.header(GEMINI_API_KEY_HEADER),
    );
    const database = databaseFactory(context.env);

    try {
      const data = await declareEmergencyOverride(database, patientId);

      const snapshot = await getOperationsSnapshot(database);
      const recommendation = snapshot.recommendations[patientId];
      const patient = snapshot.patients.find((p) => p.id === patientId);

      const explanationPatientIds = [
        patientId,
        ...data.replannedPatientIds,
      ];

      if (
        resolveGeminiApiKey(context.env, fallbackApiKey)
      ) {
        const patientById = new Map(
          snapshot.patients.map((p) => [p.id, p]),
        );
        await Promise.all(
          explanationPatientIds.map(async (pid) => {
            const pat = patientById.get(pid);
            const rec = snapshot.recommendations[pid];
            if (!pat || !rec) return;
            try {
              await explainRecommendation({
                database,
                bindings: context.env,
                patient: pat,
                recommendation: rec,
                fallbackApiKey,
              });
            } catch (explanationError) {
              console.error("Emergency override explanation failed", {
                patientId: pid,
                error: explanationError,
              });
            }
          }),
        );
      }

      await recordAudit(database, {
        organizationId: context.get("principal").organizationId,
        actorUserId: context.get("principal").userId,
        action: "patient.emergency_override",
        resourceType: "patient",
        resourceId: patientId,
        requestId: context.get("requestId"),
        ip: context.get("clientIp"),
        metadata: {
          minute: data.minute,
          queueResourceId: data.queueResourceId,
          replannedCount: data.replannedPatientIds.length,
        },
      }).catch(() => undefined);

      const response: ApiSuccess<EmergencyOverrideResult> = { data };
      return context.json(response);
    } catch (error) {
      if (error instanceof EmergencyOverrideError) {
        return apiError(
          context,
          error.code === "PATIENT_NOT_FOUND" ? 404 : 409,
          error.code,
          error.message,
        );
      }
      if (error instanceof SimulationConflictError) {
        return apiError(context, 409, "SIMULATION_CONFLICT", error.message);
      }
      if (error instanceof SimulationNotInitializedError) {
        return apiError(
          context,
          503,
          "SIMULATION_NOT_INITIALIZED",
          error.message,
        );
      }
      if (error instanceof SimulationInvariantError) {
        console.error("Simulation invariant violation", error);
      } else {
        console.error("Emergency override error", error);
      }
      return apiError(
        context,
        500,
        "INTERNAL_ERROR",
        "An unexpected error occurred",
      );
    }
  };
}

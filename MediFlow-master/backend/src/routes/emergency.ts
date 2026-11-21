import type { ApiSuccess, EmergencyOverrideResult } from "@mediflow/shared";
import type { Handler } from "hono";
import { createDatabase, type Database } from "../db/client";
import type { AppEnvironment, DatabaseFactory } from "./simulation";
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
    if (!patientId) {
      return context.json(
        { error: { code: "MISSING_PATIENT_ID", message: "Patient ID is required" } },
        400,
      );
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

      const response: ApiSuccess<EmergencyOverrideResult> = { data };
      return context.json(response);
    } catch (error) {
      if (error instanceof EmergencyOverrideError) {
        return context.json(
          { error: { code: error.code, message: error.message } },
          error.code === "PATIENT_NOT_FOUND" ? 404 : 409,
        );
      }
      if (error instanceof SimulationConflictError) {
        return context.json(
          { error: { code: "SIMULATION_CONFLICT", message: error.message } },
          409,
        );
      }
      if (error instanceof SimulationNotInitializedError) {
        return context.json(
          { error: { code: "SIMULATION_NOT_INITIALIZED", message: error.message } },
          503,
        );
      }
      if (error instanceof SimulationInvariantError) {
        console.error("Simulation invariant violation", error);
      } else {
        console.error("Emergency override error", error);
      }
      return context.json(
        { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
        500,
      );
    }
  };
}

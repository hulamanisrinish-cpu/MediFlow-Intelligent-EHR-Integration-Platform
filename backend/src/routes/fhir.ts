import type { ApiSuccess, FhirSyncResult } from "@mediflow/shared";
import type { Handler } from "hono";
import { recordAudit } from "../auth/service";
import { createDatabase } from "../db/client";
import { integrationSyncs } from "../db/schema";
import type { Bindings } from "../env";
import {
  createFhirClient,
  FhirConfigurationError,
  FhirRequestError,
  type FhirClient,
} from "../fhir/client";
import { toFhirTransactionBundle } from "../fhir/mapper";
import { apiError } from "../middleware/security";
import { getOperationsSnapshot } from "../services/operations";
import type { AppEnvironment, DatabaseFactory } from "../types";
import { isValidPatientId } from "./validation";

export type FhirClientFactory = (bindings: Bindings) => FhirClient | null;

export function createFhirSyncHandler(
  databaseFactory: DatabaseFactory = createDatabase,
  clientFactory: FhirClientFactory = createFhirClient,
): Handler<AppEnvironment> {
  return async (context) => {
    const patientId = context.req.param("patientId");
    if (!isValidPatientId(patientId)) {
      return apiError(context, 400, "INVALID_PATIENT_ID", "Patient ID is invalid");
    }

    const database = databaseFactory(context.env);
    const snapshot = await getOperationsSnapshot(database);
    const patient = snapshot.patients.find((candidate) => candidate.id === patientId);
    if (!patient) {
      return apiError(context, 404, "PATIENT_NOT_FOUND", "Patient was not found");
    }

    let client: FhirClient | null;
    try {
      client = clientFactory(context.env);
    } catch (error) {
      if (error instanceof FhirConfigurationError) {
        return apiError(context, 503, "FHIR_NOT_CONFIGURED", error.message);
      }
      throw error;
    }
    if (!client) {
      return apiError(
        context,
        503,
        "FHIR_NOT_CONFIGURED",
        "FHIR_BASE_URL and FHIR_ACCESS_TOKEN must be configured",
      );
    }

    const bundle = toFhirTransactionBundle(patient);
    const principal = context.get("principal");
    const requestId = context.get("requestId");

    try {
      const result = await client.sendBundle(bundle);
      const syncedAt = new Date().toISOString();
      await database.insert(integrationSyncs).values({
        organizationId: principal.organizationId,
        patientId,
        system: "fhir_r4",
        status: "success",
        resourceCount: result.resourceCount,
        externalId: patientId,
        requestId,
        syncedAt,
      });
      await recordAudit(database, {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: "fhir.sync_succeeded",
        resourceType: "patient",
        resourceId: patientId,
        requestId,
        ip: context.get("clientIp"),
        metadata: { resourceCount: result.resourceCount, system: "fhir_r4" },
      }).catch(() => undefined);

      const data: FhirSyncResult = {
        patientId,
        status: "success",
        resourceCount: result.resourceCount,
        syncedAt,
        error: null,
      };
      const response: ApiSuccess<FhirSyncResult> = { data };
      return context.json(response);
    } catch (error) {
      const message =
        error instanceof FhirRequestError
          ? error.message
          : "FHIR sync failed unexpectedly";
      await database
        .insert(integrationSyncs)
        .values({
          organizationId: principal.organizationId,
          patientId,
          system: "fhir_r4",
          status: "failed",
          resourceCount: 0,
          externalId: patientId,
          requestId,
          error: message.slice(0, 500),
        })
        .catch(() => undefined);
      await recordAudit(database, {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: "fhir.sync_failed",
        resourceType: "patient",
        resourceId: patientId,
        requestId,
        ip: context.get("clientIp"),
        metadata: { system: "fhir_r4", error: message.slice(0, 200) },
      }).catch(() => undefined);

      console.error(
        JSON.stringify({
          event: "fhir_sync_failed",
          requestId,
          patientId,
          message,
        }),
      );
      return apiError(context, 502, "FHIR_SYNC_FAILED", message);
    }
  };
}

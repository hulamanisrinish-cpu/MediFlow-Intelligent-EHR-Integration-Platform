import type { EmergencyOverrideResult } from "@mediflow/shared";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Database } from "../db/client";
import {
  patientTimeline,
  patients,
  requiredServices,
  resourceQueue,
  resources,
  resourceState,
  simulationEvents,
  simulationState,
} from "../db/schema";
import {
  planScheduling,
  serviceKindForResource,
  type SchedulerPatient,
  type SchedulerResource,
  type SchedulerService,
} from "../engine/scheduler";
import type { PlannedEvent } from "./clock";
import {
  SimulationConflictError,
  SimulationNotInitializedError,
  type SimulationInvariantError,
} from "./clock";

function eventMinute(minute: number): string {
  return String(minute).padStart(4, "0");
}

export class EmergencyOverrideError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "EmergencyOverrideError";
  }
}

export async function declareEmergencyOverride(
  database: Database,
  patientId: string,
): Promise<EmergencyOverrideResult> {
  const [state] = await database
    .select()
    .from(simulationState)
    .where(eq(simulationState.id, "current"))
    .limit(1);
  if (!state) throw new SimulationNotInitializedError();

  const minute = state.minute;

  const [patientRows, resourceRows, stateRows, serviceRows, queueRows, timelineRows] =
    await Promise.all([
      database
        .select({
          id: patients.id,
          arrivalMinute: patients.arrivalMinute,
          priority: patients.priority,
          estimatedConsultationDuration: patients.estimatedConsultationDuration,
          registered: patients.registered,
          currentStage: patients.currentStage,
          currentResourceId: patients.currentResourceId,
          serviceEndsAtMinute: patients.serviceEndsAtMinute,
          completedAtMinute: patients.completedAtMinute,
          waitedMin: patients.waitedMin,
          servedMin: patients.servedMin,
          emergency: patients.emergency,
          token: patients.token,
        })
        .from(patients),
      database
        .select({
          id: resources.id,
          type: resources.type,
          serviceDurationMin: resources.serviceDurationMin,
        })
        .from(resources),
      database.select().from(resourceState),
      database.select().from(requiredServices),
      database.select().from(resourceQueue),
      database
        .select({ patientId: patientTimeline.patientId, position: patientTimeline.position })
        .from(patientTimeline),
    ]);

  const patientRow = patientRows.find((p) => p.id === patientId);
  if (!patientRow) {
    throw new EmergencyOverrideError("Patient not found", "PATIENT_NOT_FOUND");
  }
  if (!patientRow.registered) {
    throw new EmergencyOverrideError("Patient has not arrived yet", "EMERGENCY_NOT_ELIGIBLE");
  }
  if (patientRow.completedAtMinute !== null) {
    throw new EmergencyOverrideError("Patient has already completed their visit", "EMERGENCY_NOT_ELIGIBLE");
  }
  if (patientRow.emergency) {
    throw new EmergencyOverrideError("Patient is already on emergency override", "EMERGENCY_ALREADY_DECLARED");
  }

  const patientById = new Map(patientRows.map((p) => [p.id, p]));
  const resourceById = new Map(resourceRows.map((r) => [r.id, r]));
  const stateByResource = new Map(stateRows.map((r) => [r.resourceId, r]));

  const effectivePatients: SchedulerPatient[] = patientRows.map((p) => ({
    id: p.id,
    arrivalMinute: p.arrivalMinute,
    priority: p.priority,
    estimatedConsultationDuration: p.estimatedConsultationDuration,
    registered: p.registered,
    currentResourceId: p.currentResourceId,
    serviceEndsAtMinute: p.serviceEndsAtMinute,
    completedAtMinute: p.completedAtMinute,
    emergency: p.id === patientId ? true : p.emergency,
  }));

  const effectiveServices: SchedulerService[] = serviceRows.map((s) => ({
    patientId: s.patientId,
    position: s.position,
    kind: s.kind,
    doctorId: s.doctorId,
    completed: s.completed,
  }));

  const effectiveResources: SchedulerResource[] = resourceRows.map((r) => ({
    id: r.id,
    type: r.type,
    serviceDurationMin: r.serviceDurationMin,
    currentPatientId: stateByResource.get(r.id)?.currentPatientId ?? null,
  }));

  const scheduling = planScheduling({
    minute,
    patients: effectivePatients,
    services: effectiveServices,
    resources: effectiveResources,
    queue: queueRows.map((q) => ({
      resourceId: q.resourceId,
      patientId: q.patientId,
      enqueuedAtMinute: q.enqueuedAtMinute,
    })),
  });

  const [maxOrderRow] = await database
    .select({ maxOrder: sql<number>`max(${simulationEvents.orderInMinute})` })
    .from(simulationEvents)
    .where(eq(simulationEvents.simulationMinute, minute));
  let nextOrder = (maxOrderRow?.maxOrder ?? -1) + 1;

  const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
    database
      .update(patients)
      .set({ emergency: true })
      .where(eq(patients.id, patientId)),
  ];

  for (const route of scheduling.routes) {
    if (route.serviceKind === "consultation") {
      statements.push(
        database
          .update(requiredServices)
          .set({ doctorId: route.resourceId })
          .where(
            and(
              eq(requiredServices.patientId, route.patientId),
              eq(requiredServices.kind, "consultation"),
              eq(requiredServices.completed, false),
            ),
          ),
      );
    }
  }
  for (const replan of scheduling.replans) {
    if (replan.serviceKind === "consultation") {
      statements.push(
        database
          .update(requiredServices)
          .set({ doctorId: replan.toResourceId })
          .where(
            and(
              eq(requiredServices.patientId, replan.patientId),
              eq(requiredServices.kind, "consultation"),
              eq(requiredServices.completed, false),
            ),
          ),
      );
    }
  }

  statements.push(database.delete(resourceQueue));
  for (const resource of scheduling.resources) {
    for (const [index, entry] of resource.queue.entries()) {
      statements.push(
        database.insert(resourceQueue).values({
          resourceId: resource.resourceId,
          patientId: entry.patientId,
          position: index + 1,
          enqueuedAtMinute: entry.enqueuedAtMinute,
        }),
      );
      const resourceDef = resourceRows.find((r) => r.id === resource.resourceId);
      if (!resourceDef) throw new Error("Resource not found");
      statements.push(
        database
          .update(patients)
          .set({
            currentStage: resourceDef.type === "doctor" ? "consultation" : resourceDef.type,
            currentResourceId: null,
            serviceEndsAtMinute: null,
            queuePosition: index + 1,
          })
          .where(eq(patients.id, entry.patientId)),
      );
    }
    const persisted = stateByResource.get(resource.resourceId);
    const busyMinutes =
      (persisted?.busyMinutes ?? 0) + (persisted?.currentPatientId ? 1 : 0);
    const utilizationPct = Math.min(
      100,
      Math.round((busyMinutes / Math.max(1, minute)) * 100),
    );
    statements.push(
      database
        .update(resourceState)
        .set({
          currentPatientId: resource.currentPatientId,
          status: resource.status,
          predictedWaitMin: resource.predictedWaitMin,
          utilizationPct,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(resourceState.resourceId, resource.resourceId)),
    );
  }

  if (scheduling.replans.length > 0) {
    const replannedIds = [...new Set(scheduling.replans.map((r) => r.patientId))];
    for (const pid of replannedIds) {
      statements.push(
        database
          .update(patients)
          .set({ planChanges: sql`${patients.planChanges} + 1` })
          .where(eq(patients.id, pid)),
      );
    }
  }

  const nextTimelinePosition = new Map<string, number>();
  for (const row of timelineRows) {
    nextTimelinePosition.set(
      row.patientId,
      Math.max(nextTimelinePosition.get(row.patientId) ?? 0, row.position + 1),
    );
  }
  for (const start of scheduling.starts) {
    const resourceDef = resourceRows.find((r) => r.id === start.resourceId);
    if (!resourceDef) throw new Error("Start resource missing");
    statements.push(
      database
        .update(patients)
        .set({
          currentStage: resourceDef.type === "doctor" ? "consultation" : resourceDef.type,
          currentResourceId: start.resourceId,
          serviceEndsAtMinute: start.endsAtMinute,
          queuePosition: 0,
        })
        .where(eq(patients.id, start.patientId)),
      database.insert(patientTimeline).values({
        patientId: start.patientId,
        position: nextTimelinePosition.get(start.patientId) ?? 0,
        stage: resourceDef.type === "doctor" ? "consultation" : resourceDef.type,
        startedAtMinute: start.startsAtMinute,
      }),
    );
  }
  for (const completedId of scheduling.completedPatientIds) {
    statements.push(
      database
        .update(patients)
        .set({
          currentStage: "done",
          completedAtMinute: minute,
          queuePosition: 0,
        })
        .where(eq(patients.id, completedId)),
      database.insert(patientTimeline).values({
        patientId: completedId,
        position: nextTimelinePosition.get(completedId) ?? 0,
        stage: "done",
        startedAtMinute: minute,
        endedAtMinute: minute,
      }),
    );
  }

  const allEvents: PlannedEvent[] = [];

  allEvents.push({
    id: `emergency-override-${eventMinute(minute)}-${patientId}`,
    simulationMinute: minute,
    orderInMinute: nextOrder++,
    type: "emergency_override",
    patientId,
    resourceId: null,
    payload: { minute },
  });

  for (const route of scheduling.routes) {
    allEvents.push({
      id: `patient-queued-${eventMinute(minute)}-${route.patientId}`,
      simulationMinute: minute,
      orderInMinute: nextOrder++,
      type: "patient_queued",
      patientId: route.patientId,
      resourceId: route.resourceId,
      payload: { serviceKind: route.serviceKind, projectedCompletionMinute: route.projectedCompletionMinute },
    });
  }
  for (const start of scheduling.starts) {
    allEvents.push({
      id: `service-started-${eventMinute(minute)}-${start.patientId}`,
      simulationMinute: minute,
      orderInMinute: nextOrder++,
      type: "service_started",
      patientId: start.patientId,
      resourceId: start.resourceId,
      payload: { serviceKind: start.serviceKind, endsAtMinute: start.endsAtMinute },
    });
  }
  const replannedPatientIds = new Set(scheduling.replans.map((r) => r.patientId));
  for (const route of scheduling.routes) {
    if (replannedPatientIds.has(route.patientId)) continue;
    allEvents.push({
      id: `recommendation-${eventMinute(minute)}-${route.patientId}`,
      simulationMinute: minute,
      orderInMinute: nextOrder++,
      type: "recommendation_created",
      patientId: route.patientId,
      resourceId: route.resourceId,
      payload: { serviceKind: route.serviceKind, projectedCompletionMinute: route.projectedCompletionMinute },
    });
  }
  for (const replan of scheduling.replans) {
    allEvents.push({
      id: `plan-changed-${eventMinute(minute)}-${replan.patientId}`,
      simulationMinute: minute,
      orderInMinute: nextOrder++,
      type: "plan_changed",
      patientId: replan.patientId,
      resourceId: replan.toResourceId,
      payload: { fromResourceId: replan.fromResourceId, toResourceId: replan.toResourceId, serviceKind: replan.serviceKind, gainMin: replan.gainMin },
    });
    allEvents.push({
      id: `recommendation-${eventMinute(minute)}-${replan.patientId}`,
      simulationMinute: minute,
      orderInMinute: nextOrder++,
      type: "recommendation_created",
      patientId: replan.patientId,
      resourceId: replan.toResourceId,
      payload: { serviceKind: replan.serviceKind, projectedCompletionMinute: 0 },
    });
  }

  for (const event of allEvents) {
    statements.push(
      database.insert(simulationEvents).values({
        id: event.id,
        simulationMinute: event.simulationMinute,
        orderInMinute: event.orderInMinute,
        type: event.type,
        patientId: event.patientId,
        resourceId: event.resourceId,
        payload: event.payload,
      }),
    );
  }

  try {
    await database.batch(statements);
  } catch (error) {
    if (isConstraintConflict(error)) {
      throw new SimulationConflictError();
    }
    throw error;
  }

  const emergencyPatient = patientById.get(patientId)!;
  const queueResourceId =
    scheduling.resources
      .find((r) => r.queue.some((q) => q.patientId === patientId))
      ?.resourceId ?? null;
  const queuePosition = queueResourceId
    ? scheduling.queuePositionByPatient.get(patientId) ?? null
    : null;
  const replannedIds = [...new Set(scheduling.replans.map((r) => r.patientId))];

  return {
    patientId,
    token: emergencyPatient.token,
    minute,
    queueResourceId,
    queuePosition,
    replannedPatientIds: replannedIds,
  };
}

function isConstraintConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message?.includes("UNIQUE constraint failed") ||
    error.cause instanceof Error && error.cause.message?.includes("UNIQUE constraint failed")
  );
}

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Patient } from "@mediflow/shared";
import { FhirClient, FhirConfigurationError, FhirRequestError } from "./client";
import { toFhirTransactionBundle, toFhirPatient } from "./mapper";
import type { FhirTransactionBundle } from "./types";

function patientFixture(): Patient {
  return {
    id: "pat-1",
    token: "ABC123",
    name: "Synthetic Patient",
    age: 34,
    gender: "male",
    arrivalTime: 10,
    priority: "normal",
    requiredServices: [],
    estimatedConsultationDuration: 20,
    currentStage: "registration",
    queuePosition: 0,
    timeline: [],
    history: {
      diagnoses: [],
      medications: [],
      allergies: [],
      recentTests: [],
      treatments: [],
    },
    serviceEndsAt: null,
    currentResourceId: null,
    completedAt: null,
    waitedMin: 0,
    servedMin: 0,
    registered: false,
    emergency: false,
    planChanges: 0,
    baselineWaitMin: 0,
    baselineVisitMin: 0,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("FHIR mapper builds a typed R4 patient transaction bundle", () => {
  const bundle: FhirTransactionBundle = toFhirTransactionBundle(patientFixture());
  assert.equal(bundle.resourceType, "Bundle");
  assert.equal(bundle.type, "transaction");
  assert.equal(bundle.entry?.length, 1);
  const patient = toFhirPatient(patientFixture());
  assert.equal(patient.resourceType, "Patient");
  assert.equal(patient.gender, "male");
  assert.equal(patient.id, "pat-1");
  assert.equal(patient.identifier?.[0]?.system, "urn:mediflow:patient-token");
});

test("FHIR mapper maps history records into typed FHIR resources", () => {
  const patient = patientFixture();
  patient.history.allergies = [
    { substance: "Penicillin", reaction: "rash", severity: "moderate" },
  ];
  patient.history.diagnoses = [{ condition: "Hypertension", year: 2024 }];
  patient.history.recentTests = [
    { test: "Hemoglobin", value: "12.0", date: "2026-11-01", flag: "abnormal" },
  ];

  const bundle = toFhirTransactionBundle(patient);
  assert.equal(bundle.entry?.length, 4);
  const allergy = bundle.entry?.[1]?.resource;
  assert.equal(allergy?.resourceType, "AllergyIntolerance");
  const condition = bundle.entry?.[2]?.resource;
  assert.equal(condition?.resourceType, "Condition");
  const observation = bundle.entry?.[3]?.resource;
  assert.equal(observation?.resourceType, "Observation");
});

test("FHIR client sends an idempotent transaction bundle", async () => {
  let capturedBody: unknown = null;
  let capturedUrl = "";
  const client = new FhirClient({
    baseUrl: "https://fhir.example.com/fhir",
    accessToken: "token",
    fetchImpl: (async (input, init) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body ?? "{}"));
      return jsonResponse(200, { resourceType: "Bundle", type: "transaction" });
    }) as typeof fetch,
  });

  const result = await client.sendBundle({
    resourceType: "Bundle",
    type: "transaction",
    entry: [{ fullUrl: "urn:uuid:Patient-pat-1", resource: toFhirPatient(patientFixture()), request: { method: "PUT", url: "Patient/pat-1" } }],
  });

  assert.equal(result.resourceCount, 1);
  assert.equal(capturedUrl, "https://fhir.example.com/fhir");
  assert.equal(
    (capturedBody as { resourceType: string }).resourceType,
    "Bundle",
  );
});

test("FHIR client retries retryable failures with backoff and surfaces the last error", async () => {
  let attempts = 0;
  const client = new FhirClient({
    baseUrl: "https://fhir.example.com/fhir",
    accessToken: "token",
    maxRetries: 2,
    retryBaseDelayMs: 1,
    sleep: async () => undefined,
    fetchImpl: (async () => {
      attempts += 1;
      if (attempts < 3) {
        return jsonResponse(503, { resourceType: "OperationOutcome" });
      }
      return jsonResponse(200, { resourceType: "Bundle", type: "transaction" });
    }) as typeof fetch,
  });

  const result = await client.sendBundle({
    resourceType: "Bundle",
    type: "transaction",
    entry: [],
  });
  assert.equal(result.resourceCount, 0);
  assert.equal(attempts, 3);
});

test("FHIR client does not retry client errors", async () => {
  let attempts = 0;
  const client = new FhirClient({
    baseUrl: "https://fhir.example.com/fhir",
    accessToken: "token",
    fetchImpl: (async () => {
      attempts += 1;
      return jsonResponse(400, { resourceType: "OperationOutcome" });
    }) as typeof fetch,
  });

  await assert.rejects(
    () =>
      client.sendBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [],
      }),
    (error: unknown) => {
      assert.ok(error instanceof FhirRequestError);
      assert.equal((error as FhirRequestError).status, 400);
      assert.equal((error as FhirRequestError).retryable, false);
      return true;
    },
  );
  assert.equal(attempts, 1);
});

test("FHIR client rejects an unreachable endpoint", async () => {
  const client = new FhirClient({
    baseUrl: "https://fhir.example.com/fhir",
    accessToken: "token",
    maxRetries: 1,
    retryBaseDelayMs: 1,
    sleep: async () => undefined,
    fetchImpl: (async () => {
      throw new Error("network down");
    }) as typeof fetch,
  });

  await assert.rejects(
    () =>
      client.sendBundle({
        resourceType: "Bundle",
        type: "transaction",
        entry: [],
      }),
    (error: unknown) => error instanceof FhirRequestError,
  );
});

test("FHIR client refuses non-https endpoints outside localhost", () => {
  assert.throws(
    () =>
      new FhirClient({
        baseUrl: "http://fhir.example.com/fhir",
        accessToken: "token",
      }),
    FhirConfigurationError,
  );
});

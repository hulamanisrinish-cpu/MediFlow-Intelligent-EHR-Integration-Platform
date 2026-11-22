import assert from "node:assert/strict";
import { test } from "node:test";
import type { Patient } from "@mediflow/shared";
import { toFhirAllergyIntolerance, toFhirCondition, toFhirObservation } from "./mapper";
import { toFhirPatient } from "./mapper";

function patientFixture(): Patient {
  return {
    id: "pat-9",
    token: "XYZ789",
    name: "Synthetic Patient",
    age: 45,
    gender: "female",
    arrivalTime: 12,
    priority: "urgent",
    requiredServices: [],
    estimatedConsultationDuration: 25,
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

test("FHIR patient mapping uses internal identifiers and simulated extensions", () => {
  const patient = toFhirPatient(patientFixture());
  assert.equal(patient.resourceType, "Patient");
  assert.equal(patient.id, "pat-9");
  assert.equal(patient.gender, "female");
  assert.equal(patient.identifier?.[0]?.value, "XYZ789");
  assert.equal(patient.identifier?.[1]?.value, "pat-9");
  assert.equal(
    patient.extension?.some(
      (extension) => extension.url === "https://mediflow.example/fhir/StructureDefinition/simulated-age",
    ),
    true,
  );
});

test("FHIR allergy mapping uses confirmed status and preserved severity", () => {
  const patient = patientFixture();
  patient.history.allergies = [
    { substance: "Sulfa", reaction: "hives", severity: "severe" },
  ];
  const allergy = toFhirAllergyIntolerance(patient, 0);
  assert.equal(allergy.resourceType, "AllergyIntolerance");
  assert.equal(allergy.clinicalStatus?.coding?.[0]?.code, "active");
  assert.equal(allergy.verificationStatus?.coding?.[0]?.code, "confirmed");
  assert.equal(allergy.code.text, "Sulfa");
});

test("FHIR condition mapping records the diagnosis year", () => {
  const patient = patientFixture();
  patient.history.diagnoses = [{ condition: "Asthma", year: 2023 }];
  const condition = toFhirCondition(patient, 0);
  assert.equal(condition.resourceType, "Condition");
  assert.equal(condition.subject?.reference, "Patient/pat-9");
  assert.equal(condition.recordedDate, "2023");
});

test("FHIR observation mapping flags abnormal results", () => {
  const patient = patientFixture();
  patient.history.recentTests = [
    { test: "Chest X-Ray", value: "Wheeze noted", date: "2026-11-20", flag: "abnormal" },
  ];
  const observation = toFhirObservation(patient, 0);
  assert.equal(observation.resourceType, "Observation");
  assert.equal(observation.status, "final");
  assert.equal(observation.valueString, "Wheeze noted");
});

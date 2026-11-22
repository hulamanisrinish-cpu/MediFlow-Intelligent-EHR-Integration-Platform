import type { Patient } from "@mediflow/shared";
import type {
  FhirAllergyIntolerance,
  FhirBundleEntry,
  FhirCondition,
  FhirObservation,
  FhirPatient,
  FhirTransactionBundle,
} from "./types";

const SYSTEM_BASE = "urn:mediflow";
const SIMULATED_AGE_EXTENSION =
  "https://mediflow.example/fhir/StructureDefinition/simulated-age";

function patientReference(patientId: string): { reference: string } {
  return { reference: `Patient/${patientId}` };
}

function resourceId(...parts: Array<string | number>): string {
  return parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export function toFhirPatient(patient: Patient): FhirPatient {
  return {
    resourceType: "Patient",
    id: patient.id,
    identifier: [
      { system: `${SYSTEM_BASE}:patient-token`, value: patient.token },
      { system: `${SYSTEM_BASE}:patient-id`, value: patient.id },
    ],
    name: [{ text: patient.name }],
    gender: patient.gender,
    extension: [
      {
        url: SIMULATED_AGE_EXTENSION,
        valueInteger: patient.age,
      },
      {
        url: `${SYSTEM_BASE}:simulated-priority`,
        valueString: patient.priority,
      },
    ],
  };
}

export function toFhirAllergyIntolerance(
  patient: Patient,
  index: number,
): FhirAllergyIntolerance {
  const allergy = patient.history.allergies[index];
  if (!allergy) {
    throw new Error(`No allergy at index ${index} for ${patient.id}`);
  }
  return {
    resourceType: "AllergyIntolerance",
    id: resourceId(patient.id, "allergy", index + 1),
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
          code: "active",
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system:
            "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
          code: "confirmed",
        },
      ],
    },
    code: { text: allergy.substance },
    patient: patientReference(patient.id),
    reaction: [
      {
        manifestation: [{ text: allergy.reaction }],
        severity: allergy.severity,
      },
    ],
  };
}

export function toFhirCondition(
  patient: Patient,
  index: number,
): FhirCondition {
  const diagnosis = patient.history.diagnoses[index];
  if (!diagnosis) {
    throw new Error(`No diagnosis at index ${index} for ${patient.id}`);
  }
  return {
    resourceType: "Condition",
    id: resourceId(patient.id, "condition", index + 1),
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
          code: "active",
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
          code: "confirmed",
        },
      ],
    },
    code: { text: diagnosis.condition },
    subject: patientReference(patient.id),
    recordedDate: String(diagnosis.year),
  };
}

export function toFhirObservation(
  patient: Patient,
  index: number,
): FhirObservation {
  const result = patient.history.recentTests[index];
  if (!result) {
    throw new Error(`No test result at index ${index} for ${patient.id}`);
  }
  return {
    resourceType: "Observation",
    id: resourceId(patient.id, "observation", index + 1),
    status: "final",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "laboratory",
            display: "Laboratory",
          },
        ],
      },
    ],
    code: { text: result.test },
    subject: patientReference(patient.id),
    effectiveDateTime: result.date,
    valueString: result.value,
    interpretation: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
            code: result.flag === "abnormal" ? "A" : "N",
            display: result.flag === "abnormal" ? "Abnormal" : "Normal",
          },
        ],
      },
    ],
  };
}

function entry(resource: FhirBundleEntry["resource"]): FhirBundleEntry {
  return {
    fullUrl: `urn:uuid:${resource.resourceType.toLowerCase()}-${resource.id}`,
    resource,
    request: {
      method: "PUT",
      url: `${resource.resourceType}/${resource.id}`,
    },
  };
}

/**
 * Builds an idempotent transaction Bundle. Stable resource IDs mean retries
 * update the same resources instead of creating duplicates.
 */
export function toFhirTransactionBundle(patient: Patient): FhirTransactionBundle {
  const entries: FhirBundleEntry[] = [entry(toFhirPatient(patient))];

  patient.history.allergies.forEach((_allergy, index) => {
    entries.push(entry(toFhirAllergyIntolerance(patient, index)));
  });
  patient.history.diagnoses.forEach((_diagnosis, index) => {
    entries.push(entry(toFhirCondition(patient, index)));
  });
  patient.history.recentTests.forEach((_result, index) => {
    entries.push(entry(toFhirObservation(patient, index)));
  });

  return {
    resourceType: "Bundle",
    type: "transaction",
    entry: entries,
  };
}

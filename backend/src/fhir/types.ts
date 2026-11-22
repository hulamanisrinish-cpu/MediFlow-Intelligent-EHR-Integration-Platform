/**
 * Minimal FHIR R4 resource shapes used by MediFlow's outbound adapter.
 * These are deliberately narrow: only the fields this project emits.
 * Reference: https://hl7.org/fhir/R4/
 */

export type FhirGender = "male" | "female" | "other" | "unknown";

export interface FhirCoding {
  system?: string;
  code?: string;
  display?: string;
}

export interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}

export interface FhirIdentifier {
  system: string;
  value: string;
}

export interface FhirHumanName {
  text: string;
}

export interface FhirExtension {
  url: string;
  valueInteger?: number;
  valueString?: string;
}

export interface FhirPatient {
  resourceType: "Patient";
  id: string;
  identifier: FhirIdentifier[];
  name: FhirHumanName[];
  gender: FhirGender;
  extension: FhirExtension[];
}

export interface FhirAllergyIntolerance {
  resourceType: "AllergyIntolerance";
  id: string;
  clinicalStatus: FhirCodeableConcept;
  verificationStatus: FhirCodeableConcept;
  code: FhirCodeableConcept;
  patient: { reference: string };
  reaction: Array<{
    manifestation: FhirCodeableConcept[];
    severity?: "mild" | "moderate" | "severe";
  }>;
}

export interface FhirCondition {
  resourceType: "Condition";
  id: string;
  clinicalStatus: FhirCodeableConcept;
  verificationStatus: FhirCodeableConcept;
  code: FhirCodeableConcept;
  subject: { reference: string };
  recordedDate: string;
}

export interface FhirObservation {
  resourceType: "Observation";
  id: string;
  status: "final";
  category: FhirCodeableConcept[];
  code: FhirCodeableConcept;
  subject: { reference: string };
  effectiveDateTime: string;
  valueString: string;
  interpretation: FhirCodeableConcept[];
}

export type FhirResource =
  | FhirPatient
  | FhirAllergyIntolerance
  | FhirCondition
  | FhirObservation;

export interface FhirBundleEntry {
  fullUrl: string;
  resource: FhirResource;
  request: {
    method: "PUT";
    url: string;
  };
}

export interface FhirTransactionBundle {
  resourceType: "Bundle";
  type: "transaction";
  entry: FhirBundleEntry[];
}

export interface FhirOperationOutcome {
  resourceType: "OperationOutcome";
  issue?: Array<{
    severity?: string;
    code?: string;
    diagnostics?: string;
    expression?: string[];
  }>;
}

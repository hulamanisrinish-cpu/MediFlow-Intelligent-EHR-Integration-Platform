const PATIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidPatientId(value: string | undefined): value is string {
  return Boolean(value && PATIENT_ID_PATTERN.test(value));
}

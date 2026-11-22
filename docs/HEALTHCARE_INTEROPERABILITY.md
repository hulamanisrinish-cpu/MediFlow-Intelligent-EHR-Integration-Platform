# Healthcare Interoperability

**Status:** implemented adapter (outbound FHIR R4 transaction sync) — live sandbox verification pending.

## Scope

MediFlow currently exposes an **outbound FHIR R4 transaction Bundle** sync for
simulated patients. It is an overlay integration, not a certified EHR
connector.

## Supported resources (mapping)

- `Patient` — identifiers (`urn:mediflow:patient-token`, `urn:mediflow:patient-id`),
  name, administrative gender, simulated-age and priority extensions.
- `AllergyIntolerance` — clinical/verification status, substance, reaction,
  severity.
- `Condition` — code, subject, recorded date.
- `Observation` — status final, category, code, subject, effective date, value,
  interpretation flag.

## Adapter behaviour

- Client: timeout (10 s), bounded retries (2) with exponential backoff, retryable
  status handling (408/429/5xx), `OperationOutcome` diagnostics.
- Bundle: `transaction` type with `PUT` entries; stable resource IDs make
  retries idempotent.
- Endpoint validation: HTTPS required (localhost HTTP allowed for dev).
- Status: `integration_syncs` rows with success/failed, resource count, error.

## Limitations

- No inbound (pull) mapping.
- No live FHIR sandbox verification (mocked client tests only).
- No duplicate-suppression beyond idempotent PUT semantics.
- Not a medical device / not certified for clinical use.

## Roadmap

- Live test against a public FHIR sandbox.
- Inbound read adapters and patient matching.

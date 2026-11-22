const errorResponse = {
  description: "Error response",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiError" },
    },
  },
};

const bearerSecurity = [{ bearerAuth: [] }];

function dataResponse(description: string, schema: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["data"],
          properties: { data: { $ref: `#/components/schemas/${schema}` } },
        },
      },
    },
  };
}

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "MediFlow API",
    version: "0.2.0",
    description:
      "Deterministic hospital-flow simulation API. Synthetic data only. Not a medical device. " +
      "Canonical endpoints are under /api/v1; /api aliases are deprecated. " +
      "Session authentication is the default. AUTH_MODE=demo is an explicit synthetic-demo mode.",
  },
  servers: [{ url: "/", description: "Current deployment" }],
  tags: [
    { name: "Health" },
    { name: "Auth" },
    { name: "Simulation" },
    { name: "Operations" },
    { name: "Clinical text" },
    { name: "Integrations" },
  ],
  paths: {
    "/api/v1/health/live": {
      get: {
        tags: ["Health"],
        summary: "Liveness check",
        security: [],
        responses: {
          200: dataResponse("Service is running", "HealthStatus"),
        },
      },
    },
    "/api/v1/health/ready": {
      get: {
        tags: ["Health"],
        summary: "Readiness check including database connectivity",
        security: [],
        responses: {
          200: dataResponse("Service is ready", "ReadinessStatus"),
          503: errorResponse,
        },
      },
    },
    "/api/v1/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Create a session",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", minLength: 12, maxLength: 128 },
                },
              },
            },
          },
        },
        responses: {
          200: dataResponse("Session created", "LoginResult"),
          400: errorResponse,
          401: errorResponse,
          429: errorResponse,
        },
      },
    },
    "/api/v1/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Read the current session",
        security: bearerSecurity,
        responses: {
          200: dataResponse("Current session", "SessionInfo"),
          401: errorResponse,
        },
      },
    },
    "/api/v1/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Revoke the current session",
        security: bearerSecurity,
        responses: { 204: { description: "Session revoked" }, 401: errorResponse },
      },
    },
    "/api/v1/simulation": {
      get: {
        tags: ["Simulation"],
        summary: "Read the simulation clock and counts",
        security: bearerSecurity,
        responses: {
          200: dataResponse("Simulation status", "SimulationStatus"),
          401: errorResponse,
          503: errorResponse,
        },
      },
    },
    "/api/v1/simulation/tick": {
      post: {
        tags: ["Simulation"],
        summary: "Advance exactly one simulated minute",
        description: "Requires the admin or staff role.",
        security: bearerSecurity,
        responses: {
          200: dataResponse("Tick result", "SimulationTickResult"),
          401: errorResponse,
          403: errorResponse,
          409: errorResponse,
          503: errorResponse,
        },
      },
    },
    "/api/v1/simulation/reset": {
      post: {
        tags: ["Simulation"],
        summary: "Restore the canonical minute-zero fixture",
        description:
          "Requires the admin role and the DEMO_RESET_TOKEN bearer credential. Destructive to simulation state; user and audit records are preserved.",
        security: [...bearerSecurity, { demoReset: [] }],
        responses: {
          200: dataResponse("Reset result", "SimulationResetResult"),
          401: errorResponse,
          403: errorResponse,
          503: errorResponse,
        },
      },
    },
    "/api/v1/operations": {
      get: {
        tags: ["Operations"],
        summary: "Read the shared operations snapshot",
        security: bearerSecurity,
        responses: {
          200: dataResponse("Operations snapshot", "OperationsSnapshot"),
          401: errorResponse,
          503: errorResponse,
        },
      },
    },
    "/api/v1/patients/{patientId}/brief": {
      get: {
        tags: ["Clinical text"],
        summary: "Generate or read a pre-consultation brief",
        description: "Requires the admin or doctor role.",
        security: bearerSecurity,
        parameters: [
          {
            name: "patientId",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^[A-Za-z0-9_-]{1,64}$" },
          },
        ],
        responses: {
          200: dataResponse("Doctor brief", "DoctorBriefResult"),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
        },
      },
    },
    "/api/v1/patients/{patientId}/emergency-override": {
      post: {
        tags: ["Operations"],
        summary: "Declare an emergency override",
        description:
          "Requires the admin or doctor role. Active service is never preempted; waiting queues are rebuilt.",
        security: bearerSecurity,
        parameters: [
          {
            name: "patientId",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^[A-Za-z0-9_-]{1,64}$" },
          },
        ],
        responses: {
          200: dataResponse("Override result", "EmergencyOverrideResult"),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
        },
      },
    },
    "/api/v1/llm/verify-key": {
      post: {
        tags: ["Clinical text"],
        summary: "Verify a session-supplied Gemini key",
        description: "Requires the admin role. The key is not stored or logged.",
        security: bearerSecurity,
        parameters: [
          {
            name: "X-Gemini-Api-Key",
            in: "header",
            required: true,
            schema: { type: "string", maxLength: 256 },
          },
        ],
        responses: {
          200: dataResponse("Key verified", "GeminiApiKeyVerificationResult"),
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          503: errorResponse,
        },
      },
    },
    "/api/v1/patients/{patientId}/fhir-sync": {
      post: {
        tags: ["Integrations"],
        summary: "Sync a patient to a configured FHIR R4 endpoint",
        description:
          "Requires the admin role. Builds a transaction Bundle and records the outcome. " +
          "The adapter is tested against mocks, not a certified sandbox.",
        security: bearerSecurity,
        parameters: [
          {
            name: "patientId",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^[A-Za-z0-9_-]{1,64}$" },
          },
        ],
        responses: {
          200: dataResponse("Sync result", "FhirSyncResult"),
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "opaque session token",
      },
      demoReset: {
        type: "http",
        scheme: "bearer",
        description: "Separate DEMO_RESET_TOKEN credential",
      },
    },
    schemas: {
      ApiError: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              requestId: { type: "string" },
            },
          },
        },
      },
      HealthStatus: {
        type: "object",
        required: ["service", "status", "version", "timestamp"],
        properties: {
          service: { const: "mediflow-api" },
          status: { const: "ok" },
          version: { type: "string" },
          timestamp: { type: "string", format: "date-time" },
        },
      },
      ReadinessStatus: {
        type: "object",
        required: ["service", "status", "checks", "timestamp"],
        properties: {
          service: { const: "mediflow-api" },
          status: { enum: ["ready", "not_ready"] },
          checks: {
            type: "object",
            properties: { database: { enum: ["ok", "unavailable"] } },
          },
          timestamp: { type: "string", format: "date-time" },
        },
      },
      LoginResult: {
        type: "object",
        required: ["token", "expiresAt", "user"],
        properties: {
          token: { type: "string" },
          expiresAt: { type: "string", format: "date-time" },
          user: { $ref: "#/components/schemas/AuthUser" },
        },
      },
      AuthUser: {
        type: "object",
        required: ["id", "email", "name", "role", "organizationId", "organizationName"],
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          name: { type: "string" },
          role: { enum: ["admin", "staff", "doctor"] },
          organizationId: { type: "string" },
          organizationName: { type: "string" },
        },
      },
      SessionInfo: {
        type: "object",
        required: ["user", "expiresAt", "mode"],
        properties: {
          user: { $ref: "#/components/schemas/AuthUser" },
          expiresAt: { type: "string", format: "date-time" },
          mode: { enum: ["session", "demo"] },
        },
      },
      SimulationStatus: {
        type: "object",
        properties: {
          minute: { type: "integer", minimum: 0 },
          playbackStatus: { enum: ["paused", "playing"] },
          speed: { enum: [1, 4] },
          seed: { type: "integer" },
          totalPatients: { type: "integer" },
          arrivedPatients: { type: "integer" },
          completedPatients: { type: "integer" },
        },
      },
      SimulationTickResult: {
        type: "object",
        properties: {
          state: { $ref: "#/components/schemas/SimulationStatus" },
          events: { type: "array", items: { type: "object" } },
        },
      },
      SimulationResetResult: {
        type: "object",
        properties: { state: { $ref: "#/components/schemas/SimulationStatus" } },
      },
      OperationsSnapshot: { type: "object", additionalProperties: true },
      DoctorBriefResult: {
        type: "object",
        properties: {
          patientId: { type: "string" },
          content: { type: "string" },
          generatedBy: { enum: ["gemini", "fallback"] },
        },
      },
      GeminiApiKeyVerificationResult: {
        type: "object",
        properties: { verified: { const: true } },
      },
      EmergencyOverrideResult: {
        type: "object",
        properties: {
          patientId: { type: "string" },
          token: { type: "string" },
          minute: { type: "integer" },
          queueResourceId: { type: ["string", "null"] },
          queuePosition: { type: ["integer", "null"] },
          replannedPatientIds: { type: "array", items: { type: "string" } },
        },
      },
      FhirSyncResult: {
        type: "object",
        properties: {
          patientId: { type: "string" },
          status: { enum: ["success", "failed"] },
          resourceCount: { type: "integer" },
          syncedAt: { type: ["string", "null"] },
          error: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

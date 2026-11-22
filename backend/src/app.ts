import type {
  ApiSuccess,
  HealthStatus,
  ReadinessStatus,
} from "@mediflow/shared";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  createLoginHandler,
  createLogoutHandler,
  createSessionHandler,
} from "./auth/routes";
import {
  createAuthMiddleware,
  requireRoles,
} from "./auth/middleware";
import { AuthError } from "./auth/types";
import { createDatabase, type Database } from "./db/client";
import { organizations } from "./db/schema";
import { APP_VERSION } from "./env";
import {
  GeminiApiKeyVerificationUnavailableError,
  InvalidGeminiApiKeyError,
} from "./llm/api-key";
import { apiError, corsAllowlist, jsonBodyLimit, rateLimit, requestContext, requestLogger, securityHeaders } from "./middleware/security";
import { openApiDocument } from "./openapi";
import { createEmergencyOverrideHandler } from "./routes/emergency";
import { createFhirSyncHandler } from "./routes/fhir";
import { createGeminiApiKeyVerificationHandler } from "./routes/gemini-key";
import { createDoctorBriefHandler } from "./routes/llm";
import { createOperationsHandler } from "./routes/operations";
import { createResetHandler } from "./routes/reset";
import {
  createSimulationHandlers,
} from "./routes/simulation";
import {
  SimulationConflictError,
  SimulationInvariantError,
  SimulationNotInitializedError,
} from "./simulation/clock";
import type { AppEnvironment, DatabaseFactory } from "./types";

async function isDatabaseReady(
  databaseFactory: DatabaseFactory,
  bindings: import("./env").Bindings,
): Promise<boolean> {
  try {
    const database = databaseFactory(bindings);
    await database
      .select({ value: sql<number>`1` })
      .from(organizations)
      .limit(1);
    return true;
  } catch {
    return false;
  }
}

export function createApp(databaseFactory: DatabaseFactory = createDatabase) {
  const app = new Hono<AppEnvironment>();
  const simulation = createSimulationHandlers(databaseFactory);
  const operations = createOperationsHandler(databaseFactory);
  const doctorBrief = createDoctorBriefHandler(databaseFactory);
  const verifyGeminiApiKey = createGeminiApiKeyVerificationHandler();
  const reset = createResetHandler(databaseFactory);
  const emergencyOverride = createEmergencyOverrideHandler(databaseFactory);
  const fhirSync = createFhirSyncHandler(databaseFactory);
  const login = createLoginHandler(databaseFactory);
  const logout = createLogoutHandler(databaseFactory);
  const session = createSessionHandler();

  app.use("*", requestContext());
  app.use("*", requestLogger());
  app.use("*", securityHeaders());
  app.use("/api/*", corsAllowlist());
  app.use("/api/*", jsonBodyLimit());
  app.use("/api/*", rateLimit());
  app.use("/api/*", createAuthMiddleware(databaseFactory));

  app.use("/api/*", async (context, next) => {
    if (!context.req.path.startsWith("/api/v1/")) {
      context.header("Deprecation", "true");
      context.header("Link", '</api/v1>; rel="successor-version"');
    }
    await next();
  });

  const liveness = (context: import("hono").Context<AppEnvironment>) => {
    const response: ApiSuccess<HealthStatus> = {
      data: {
        service: "mediflow-api",
        status: "ok",
        version: APP_VERSION,
        timestamp: new Date().toISOString(),
      },
    };
    return context.json(response);
  };

  app.get("/api/health", liveness);
  app.get("/api/v1/health/live", liveness);
  app.get("/api/v1/health/ready", async (context) => {
    const ready = await isDatabaseReady(databaseFactory, context.env);
    const data: ReadinessStatus = {
      service: "mediflow-api",
      status: ready ? "ready" : "not_ready",
      checks: { database: ready ? "ok" : "unavailable" },
      timestamp: new Date().toISOString(),
    };
    if (!ready) {
      const response: ApiSuccess<ReadinessStatus> = { data };
      return context.json(response, 503);
    }
    const response: ApiSuccess<ReadinessStatus> = { data };
    return context.json(response);
  });
  app.get("/api/openapi.json", (context) => context.json(openApiDocument));
  app.get("/api/v1/openapi.json", (context) => context.json(openApiDocument));

  app.post("/api/auth/login", login);
  app.post("/api/v1/auth/login", login);
  app.get("/api/auth/me", session);
  app.get("/api/v1/auth/me", session);
  app.post("/api/auth/logout", logout);
  app.post("/api/v1/auth/logout", logout);

  const prefixes = ["/api", "/api/v1"] as const;
  for (const prefix of prefixes) {
    app.use(`${prefix}/simulation/tick`, requireRoles("admin", "staff"));
    app.use(`${prefix}/simulation/reset`, requireRoles("admin"));
    app.use(
      `${prefix}/patients/:patientId/emergency-override`,
      requireRoles("admin", "doctor"),
    );
    app.use(`${prefix}/patients/:patientId/brief`, requireRoles("admin", "doctor"));
    app.use(`${prefix}/llm/verify-key`, requireRoles("admin"));
    app.use(`${prefix}/patients/:patientId/fhir-sync`, requireRoles("admin"));

    app.get(`${prefix}/simulation`, simulation.getState);
    app.post(`${prefix}/simulation/tick`, simulation.tick);
    app.post(`${prefix}/simulation/reset`, reset);
    app.get(`${prefix}/operations`, operations);
    app.post(`${prefix}/llm/verify-key`, verifyGeminiApiKey);
    app.get(`${prefix}/patients/:patientId/brief`, doctorBrief);
    app.post(
      `${prefix}/patients/:patientId/emergency-override`,
      emergencyOverride,
    );
    app.post(`${prefix}/patients/:patientId/fhir-sync`, fhirSync);
  }

  app.notFound((context) =>
    apiError(
      context,
      404,
      "NOT_FOUND",
      "The requested endpoint does not exist",
    ),
  );

  app.onError((error, context) => {
    if (error instanceof AuthError) {
      return apiError(
        context,
        error.status,
        error.code,
        error.message,
        error.status === 401
          ? { "WWW-Authenticate": 'Bearer realm="mediflow-api"' }
          : undefined,
      );
    }
    if (error instanceof SimulationNotInitializedError) {
      return apiError(context, 503, "SIMULATION_NOT_INITIALIZED", error.message);
    }
    if (error instanceof SimulationConflictError) {
      return apiError(context, 409, "SIMULATION_CONFLICT", error.message);
    }
    if (error instanceof InvalidGeminiApiKeyError) {
      return apiError(context, 400, "INVALID_GEMINI_API_KEY", error.message);
    }
    if (error instanceof GeminiApiKeyVerificationUnavailableError) {
      return apiError(
        context,
        503,
        "GEMINI_API_KEY_VERIFICATION_UNAVAILABLE",
        error.message,
      );
    }
    if (error instanceof HTTPException) {
      return apiError(
        context,
        error.status as 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 502 | 503,
        "HTTP_ERROR",
        error.message,
      );
    }
    if (error instanceof SimulationInvariantError) {
      console.error(
        JSON.stringify({
          event: "simulation_invariant_violation",
          requestId: context.get("requestId"),
          message: error.message,
        }),
      );
    } else {
      console.error(
        JSON.stringify({
          event: "unhandled_error",
          requestId: context.get("requestId"),
          name: error instanceof Error ? error.name : "UnknownError",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return apiError(context, 500, "INTERNAL_ERROR", "An unexpected error occurred");
  });

  return app;
}

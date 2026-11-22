import type { ApiSuccess, LoginResult, SessionInfo } from "@mediflow/shared";
import type { Handler } from "hono";
import { createDatabase } from "../db/client";
import { isDemoMode } from "../env";
import type { AppEnvironment, DatabaseFactory } from "../types";
import {
  login,
  revokeSession,
  recordAudit,
  toSessionInfo,
} from "./service";
import { parseBearerToken } from "./middleware";
import { AuthError } from "./types";

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

function readLoginBody(value: unknown): { email: string; password: string } {
  if (!value || typeof value !== "object") {
    throw new AuthError("A JSON body is required", "INVALID_REQUEST", 400);
  }
  const body = value as LoginBody;
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    throw new AuthError(
      "Email and password are required",
      "INVALID_REQUEST",
      400,
    );
  }
  return { email: body.email, password: body.password };
}

export function createLoginHandler(
  databaseFactory: DatabaseFactory = createDatabase,
): Handler<AppEnvironment> {
  return async (context) => {
    let body: { email: string; password: string };
    try {
      body = readLoginBody(await context.req.json());
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError("A valid JSON body is required", "INVALID_REQUEST", 400);
    }

    const database = databaseFactory(context.env);
    const result = await login(database, {
      email: body.email,
      password: body.password,
      metadata: {
        ip: context.get("clientIp"),
        userAgent: context.req.header("User-Agent") ?? null,
        requestId: context.get("requestId"),
      },
    });
    const response: ApiSuccess<LoginResult> = { data: result };
    return context.json(response);
  };
}

export function createSessionHandler(): Handler<AppEnvironment> {
  return (context) => {
    const response: ApiSuccess<SessionInfo> = {
      data: toSessionInfo(context.get("principal")),
    };
    return context.json(response);
  };
}

export function createLogoutHandler(
  databaseFactory: DatabaseFactory = createDatabase,
): Handler<AppEnvironment> {
  return async (context) => {
    const principal = context.get("principal");
    if (principal.mode === "demo" || isDemoMode(context.env)) {
      return context.body(null, 204);
    }
    const token = parseBearerToken(context.req.header("Authorization"));
    const database = databaseFactory(context.env);
    if (token) {
      await revokeSession(database, token);
    }
    await recordAudit(database, {
      organizationId: principal.organizationId,
      actorUserId: principal.userId,
      action: "auth.logout",
      requestId: context.get("requestId"),
      ip: context.get("clientIp"),
    }).catch(() => undefined);
    return context.body(null, 204);
  };
}

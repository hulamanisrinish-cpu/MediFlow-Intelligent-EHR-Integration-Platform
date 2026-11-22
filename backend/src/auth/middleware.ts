import type { AuthRole } from "@mediflow/shared";
import type { MiddlewareHandler } from "hono";
import { createDatabase } from "../db/client";
import { resolveAuthMode } from "../env";
import type { AppEnvironment, DatabaseFactory } from "../types";
import { authenticateSession, demoPrincipal } from "./service";
import { AuthError } from "./types";

const BEARER_PREFIX = "Bearer ";
let demoModeWarningLogged = false;

export function parseBearerToken(
  authorization: string | undefined,
): string | null {
  if (!authorization?.startsWith(BEARER_PREFIX)) return null;
  const token = authorization.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

export function isPublicApiPath(path: string): boolean {
  return (
    path === "/api/health" ||
    path === "/api/openapi.json" ||
    path === "/api/v1/openapi.json" ||
    path === "/api/v1/health/live" ||
    path === "/api/v1/health/ready" ||
    path === "/api/auth/login" ||
    path === "/api/v1/auth/login"
  );
}

export function createAuthMiddleware(
  databaseFactory: DatabaseFactory = createDatabase,
): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    if (context.req.method === "OPTIONS" || isPublicApiPath(context.req.path)) {
      await next();
      return;
    }

    if (resolveAuthMode(context.env) === "demo") {
      if (!demoModeWarningLogged) {
        demoModeWarningLogged = true;
        console.warn(
          "AUTH_MODE=demo is active: identity checks are disabled. Never use demo mode with real data.",
        );
      }
      context.set("principal", demoPrincipal());
      await next();
      return;
    }

    const token = parseBearerToken(context.req.header("Authorization"));
    if (!token) {
      throw new AuthError(
        "Authentication is required for this endpoint",
        "UNAUTHENTICATED",
      );
    }

    const principal = await authenticateSession(
      databaseFactory(context.env),
      token,
    );
    context.set("principal", principal);
    await next();
  };
}

export function requireRoles(
  ...roles: readonly AuthRole[]
): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    const principal = context.get("principal");
    if (!principal) {
      throw new AuthError("Authentication is required", "UNAUTHENTICATED");
    }
    if (!roles.includes(principal.role)) {
      throw new AuthError(
        "Your role does not permit this action",
        "FORBIDDEN",
        403,
      );
    }
    await next();
  };
}

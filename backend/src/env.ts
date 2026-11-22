export interface Bindings {
  AUTH_MODE?: string;
  CORS_ORIGINS?: string;
  DEMO_RESET_TOKEN?: string;
  ENVIRONMENT?: string;
  FHIR_ACCESS_TOKEN?: string;
  FHIR_BASE_URL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  RATE_LIMIT_DISABLED?: string;
  RATE_LIMIT_MAX?: string;
  RATE_LIMIT_WINDOW_MS?: string;
  TURSO_AUTH_TOKEN?: string;
  TURSO_DATABASE_URL?: string;
}

export interface TursoConfig {
  authToken: string;
  url: string;
}

export type AuthMode = "session" | "demo";

export const APP_VERSION = "0.2.0";

export function parseTursoConfig(bindings: Bindings): TursoConfig {
  const url = bindings.TURSO_DATABASE_URL?.trim();
  const authToken = bindings.TURSO_AUTH_TOKEN?.trim();

  if (!url || !authToken) {
    throw new Error("Turso database bindings are not configured");
  }

  if (!url.startsWith("libsql://") && !url.startsWith("https://")) {
    throw new Error("TURSO_DATABASE_URL must use libsql:// or https://");
  }

  return { authToken, url };
}

export function resolveAuthMode(bindings: Bindings): AuthMode {
  const requested = bindings.AUTH_MODE?.trim().toLowerCase();
  const environment = bindings.ENVIRONMENT?.trim().toLowerCase();

  if (requested === "demo") {
    if (environment === "production") {
      console.error(
        "AUTH_MODE=demo is refused in production; falling back to session authentication",
      );
      return "session";
    }
    return "demo";
  }

  return "session";
}

export function isDemoMode(bindings: Bindings): boolean {
  return resolveAuthMode(bindings) === "demo";
}

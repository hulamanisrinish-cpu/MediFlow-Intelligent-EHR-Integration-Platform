import assert from "node:assert/strict";
import { createApp } from "./app";
import type { Bindings } from "./env";
import type { DatabaseFactory } from "./types";

/**
 * Test bindings deliberately use demo authentication and disable rate limits so
 * existing endpoint tests stay focused on their domain. Authentication and rate
 * limiting have dedicated tests that use their own bindings.
 */
export const TEST_ENV: Bindings = {
  AUTH_MODE: "demo",
  CORS_ORIGINS: "https://mediflow.example",
  RATE_LIMIT_DISABLED: "true",
};

export function createTestApp(
  databaseFactory?: DatabaseFactory,
  overrides: Bindings = {},
) {
  const app = createApp(databaseFactory);
  const request = app.request.bind(app) as typeof app.request;

  app.request = ((input, init, env, executionCtx) =>
    request(
      input,
      init,
      { ...TEST_ENV, ...overrides, ...env },
      executionCtx,
    )) as typeof app.request;

  return app;
}

export async function assertApiError(
  response: Response,
  status: number,
  code: string,
  message: string,
): Promise<void> {
  assert.equal(response.status, status);
  const body = (await response.json()) as {
    error?: { code?: string; message?: string; requestId?: unknown };
  };
  assert.equal(body.error?.code, code);
  assert.equal(body.error?.message, message);
  assert.equal(typeof body.error?.requestId, "string");
}

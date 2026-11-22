import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { LoginResult, SessionInfo } from "@mediflow/shared";
import type { Database } from "../db/client";
import { auditLogs, sessions } from "../db/schema";
import * as schema from "../db/schema";
import { seedAuthData } from "./service";
import { assertApiError, createTestApp } from "../test-helpers";

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);
const PASSWORD = "CorrectHorseBatteryStaple!";

async function setup() {
  const client = createClient({ url: "file::memory:" });
  const database: Database = drizzle(client, { schema });
  await migrate(database, { migrationsFolder });
  await seedAuthData(database, PASSWORD);
  return { client, database };
}

function sessionApp(database: Database) {
  return createTestApp(() => database, { AUTH_MODE: "session" });
}

async function login(
  app: ReturnType<typeof createTestApp>,
  email: string,
  password = PASSWORD,
): Promise<LoginResult> {
  const response = await app.request("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: LoginResult };
  return body.data;
}

test("session login, identity, role guards, and logout work end to end", async () => {
  const { client, database } = await setup();
  try {
    const app = sessionApp(database);

    const unauthenticated = await app.request("/api/v1/simulation");
    await assertApiError(
      unauthenticated,
      401,
      "UNAUTHENTICATED",
      "Authentication is required for this endpoint",
    );
    assert.equal(
      unauthenticated.headers.get("WWW-Authenticate"),
      'Bearer realm="mediflow-api"',
    );

    const admin = await login(app, "Admin@MediFlow.Demo");
    assert.equal(admin.user.role, "admin");
    assert.ok(admin.token.length >= 32);

    const [storedSession] = await database
      .select()
      .from(sessions)
      .where(eq(sessions.userId, admin.user.id));
    assert.ok(storedSession);
    assert.notEqual(storedSession.tokenHash, admin.token);
    assert.match(storedSession.tokenHash, /^[a-f0-9]{64}$/);

    const me = await app.request("/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    assert.equal(me.status, 200);
    const meBody = (await me.json()) as { data: SessionInfo };
    assert.equal(meBody.data.user.email, "admin@mediflow.demo");
    assert.equal(meBody.data.mode, "session");

    const staff = await login(app, "staff@mediflow.demo");
    const staffReset = await app.request("/api/v1/simulation/reset", {
      method: "POST",
      headers: { Authorization: `Bearer ${staff.token}` },
    });
    await assertApiError(
      staffReset,
      403,
      "FORBIDDEN",
      "Your role does not permit this action",
    );

    const doctor = await login(app, "doctor@mediflow.demo");
    const doctorVerify = await app.request("/api/v1/llm/verify-key", {
      method: "POST",
      headers: { Authorization: `Bearer ${doctor.token}` },
    });
    await assertApiError(
      doctorVerify,
      403,
      "FORBIDDEN",
      "Your role does not permit this action",
    );

    const adminReset = await app.request("/api/v1/simulation/reset", {
      method: "POST",
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    assert.equal(adminReset.status, 503);
    assert.equal(
      ((await adminReset.json()) as { error: { code: string } }).error.code,
      "DEMO_RESET_DISABLED",
    );

    const logout = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    assert.equal(logout.status, 204);

    const afterLogout = await app.request("/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    await assertApiError(
      afterLogout,
      401,
      "SESSION_EXPIRED",
      "The session is invalid or expired",
    );
  } finally {
    client.close();
  }
});

test("failed logins are generic and audited without leaking account state", async () => {
  const { client, database } = await setup();
  try {
    const app = sessionApp(database);
    const response = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "nobody@mediflow.demo",
        password: "not-the-right-password",
      }),
    });
    await assertApiError(
      response,
      401,
      "INVALID_CREDENTIALS",
      "Email or password is incorrect",
    );

    const audits = await database
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "auth.login_failed"));
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.organizationId, null);
    assert.equal(audits[0]?.actorUserId, null);
  } finally {
    client.close();
  }
});

test("expired sessions are rejected and can be cleaned up", async () => {
  const { client, database } = await setup();
  try {
    const app = sessionApp(database);
    const admin = await login(app, "admin@mediflow.demo");
    await database
      .update(sessions)
      .set({ expiresAt: "2000-01-01T00:00:00.000Z" })
      .where(eq(sessions.userId, admin.user.id));

    const response = await app.request("/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    await assertApiError(
      response,
      401,
      "SESSION_EXPIRED",
      "The session is invalid or expired",
    );
  } finally {
    client.close();
  }
});

test("demo mode is explicit and refused in production", async () => {
  const { client, database } = await setup();
  try {
    const demo = createTestApp(() => database);
    const me = await demo.request("/api/v1/auth/me");
    assert.equal(me.status, 200);
    const body = (await me.json()) as { data: SessionInfo };
    assert.equal(body.data.mode, "demo");
    assert.equal(body.data.user.role, "admin");

    const production = createTestApp(() => database, {
      AUTH_MODE: "demo",
      ENVIRONMENT: "production",
    });
    const refused = await production.request("/api/v1/auth/me");
    await assertApiError(
      refused,
      401,
      "UNAUTHENTICATED",
      "Authentication is required for this endpoint",
    );
  } finally {
    client.close();
  }
});

test("CORS is an allowlist and preflight does not authenticate", async () => {
  const { client, database } = await setup();
  try {
    const app = createTestApp(() => database);
    const allowed = await app.request("/api/v1/simulation", {
      method: "OPTIONS",
      headers: {
        Origin: "https://mediflow.example",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
      },
    });
    assert.equal(allowed.status, 204);
    assert.equal(
      allowed.headers.get("Access-Control-Allow-Origin"),
      "https://mediflow.example",
    );
    assert.match(
      allowed.headers.get("Access-Control-Allow-Headers") ?? "",
      /Authorization/,
    );

    const denied = await app.request("/api/v1/simulation", {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "GET",
      },
    });
    assert.equal(denied.status, 204);
    assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);

    const actual = await app.request("/api/v1/health/live", {
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(actual.status, 200);
    assert.equal(actual.headers.get("Access-Control-Allow-Origin"), null);
  } finally {
    client.close();
  }
});

test("oversized bodies and excess requests are rejected", async () => {
  const { client, database } = await setup();
  try {
    const app = createTestApp(() => database);
    const oversized = await app.request("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "admin@mediflow.demo",
        password: "x".repeat(33 * 1024),
      }),
    });
    await assertApiError(
      oversized,
      413,
      "PAYLOAD_TOO_LARGE",
      "Request body must be at most 32768 bytes",
    );

    const limited = createTestApp(() => database, {
      RATE_LIMIT_DISABLED: "",
      RATE_LIMIT_MAX: "2",
      RATE_LIMIT_WINDOW_MS: "60000",
    });
    const headers = { "X-Real-IP": "203.0.113.77" };
    assert.equal(
      (await limited.request("/api/v1/health/live", { headers })).status,
      200,
    );
    assert.equal(
      (await limited.request("/api/v1/health/live", { headers })).status,
      200,
    );
    const throttled = await limited.request("/api/v1/health/live", { headers });
    await assertApiError(
      throttled,
      429,
      "RATE_LIMITED",
      "Too many requests; retry later",
    );
    assert.ok(Number(throttled.headers.get("Retry-After")) >= 1);
  } finally {
    client.close();
  }
});

test("security headers, request IDs, readiness, and JSON 404s are consistent", async () => {
  const { client, database } = await setup();
  try {
    const app = createTestApp(() => database);
    const live = await app.request("/api/v1/health/live", {
      headers: { "X-Request-Id": "test-request-1234" },
    });
    assert.equal(live.status, 200);
    assert.equal(live.headers.get("X-Request-Id"), "test-request-1234");
    assert.equal(live.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(live.headers.get("X-Frame-Options"), "DENY");
    assert.equal(live.headers.get("Cache-Control"), "no-store");
    assert.match(live.headers.get("Content-Security-Policy") ?? "", /default-src 'none'/);

    const ready = await app.request("/api/v1/health/ready");
    assert.equal(ready.status, 200);
    const readyBody = (await ready.json()) as {
      data: { status: string; checks: { database: string } };
    };
    assert.equal(readyBody.data.status, "ready");
    assert.equal(readyBody.data.checks.database, "ok");

    const broken = createTestApp(() => {
      throw new Error("database unavailable");
    });
    const notReady = await broken.request("/api/v1/health/ready");
    assert.equal(notReady.status, 503);
    const notReadyBody = (await notReady.json()) as {
      data: { status: string; checks: { database: string } };
    };
    assert.equal(notReadyBody.data.status, "not_ready");
    assert.equal(notReadyBody.data.checks.database, "unavailable");

    const missing = await app.request("/api/v1/does-not-exist");
    await assertApiError(
      missing,
      404,
      "NOT_FOUND",
      "The requested endpoint does not exist",
    );

    const invalidId = await app.request("/api/v1/health/live", {
      headers: { "X-Request-Id": "bad id with spaces" },
    });
    assert.notEqual(invalidId.headers.get("X-Request-Id"), "bad id with spaces");
    assert.match(invalidId.headers.get("X-Request-Id") ?? "", /^[a-f0-9-]{36}$/);
  } finally {
    client.close();
  }
});

import type { AuthRole, AuthUser, LoginResult, SessionInfo } from "@mediflow/shared";
import { eq, lt } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  auditLogs,
  organizations,
  sessions,
  users,
} from "../db/schema";
import {
  generateSessionToken,
  hashIp,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "./password";
import { AuthError, type AuthPrincipal, type SessionMetadata } from "./types";

export const DEMO_ORGANIZATION_ID = "org-demo";
export const DEMO_ORGANIZATION_NAME = "Demo General Hospital";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 128;
const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

export interface DemoUserSeed {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
}

export const DEMO_USERS: readonly DemoUserSeed[] = [
  {
    id: "user-demo-admin",
    email: "admin@mediflow.demo",
    name: "Demo Administrator",
    role: "admin",
  },
  {
    id: "user-demo-staff",
    email: "staff@mediflow.demo",
    name: "Demo Flow Coordinator",
    role: "staff",
  },
  {
    id: "user-demo-doctor",
    email: "doctor@mediflow.demo",
    name: "Dr. Demo Clinician",
    role: "doctor",
  },
];

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateCredentials(email: string, password: string): void {
  if (!email || email.length > MAX_EMAIL_LENGTH || !email.includes("@")) {
    throw new AuthError("A valid email address is required", "INVALID_CREDENTIALS", 400);
  }
  if (!password || password.length > MAX_PASSWORD_LENGTH) {
    throw new AuthError("A valid password is required", "INVALID_CREDENTIALS", 400);
  }
}

export async function seedAuthData(
  database: Database,
  password: string,
): Promise<readonly DemoUserSeed[]> {
  await database
    .insert(organizations)
    .values({
      id: DEMO_ORGANIZATION_ID,
      name: DEMO_ORGANIZATION_NAME,
      slug: "demo-general",
    })
    .onConflictDoNothing({ target: organizations.id });

  const passwordHash = await hashPassword(password);
  for (const user of DEMO_USERS) {
    await database
      .insert(users)
      .values({
        id: user.id,
        organizationId: DEMO_ORGANIZATION_ID,
        email: user.email,
        name: user.name,
        role: user.role,
        passwordHash,
      })
      .onConflictDoNothing({ target: users.id });
  }
  return DEMO_USERS;
}

function toAuthUser(row: {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  organizationId: string;
  organizationName: string;
}): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
  };
}

export async function login(
  database: Database,
  input: { email: string; password: string; metadata: SessionMetadata },
): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  validateCredentials(email, input.password);

  const [row] = await database
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      passwordHash: users.passwordHash,
      active: users.active,
      organizationId: users.organizationId,
      organizationName: organizations.name,
    })
    .from(users)
    .innerJoin(organizations, eq(users.organizationId, organizations.id))
    .where(eq(users.email, email))
    .limit(1);

  // Equalize the expensive path for unknown accounts to reduce user enumeration.
  const passwordMatches = row
    ? await verifyPassword(input.password, row.passwordHash)
    : await verifyPassword(input.password, "pbkdf2-sha256$210000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

  if (!row || !row.active || !passwordMatches) {
    await recordAudit(database, {
      organizationId: row?.organizationId ?? null,
      actorUserId: row?.id ?? null,
      action: "auth.login_failed",
      requestId: input.metadata.requestId ?? null,
      ip: input.metadata.ip,
      metadata: { emailHash: await hashIp(email) },
    }).catch(() => undefined);
    throw new AuthError("Email or password is incorrect", "INVALID_CREDENTIALS");
  }

  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

  await database.insert(sessions).values({
    id: crypto.randomUUID(),
    userId: row.id,
    tokenHash,
    expiresAt,
    lastSeenAt: now.toISOString(),
    ipHash: await hashIp(input.metadata.ip),
    userAgent: input.metadata.userAgent?.slice(0, 256) ?? null,
  });
  await database
    .update(users)
    .set({ lastLoginAt: now.toISOString(), updatedAt: now.toISOString() })
    .where(eq(users.id, row.id));

  await recordAudit(database, {
    organizationId: row.organizationId,
    actorUserId: row.id,
    action: "auth.login_succeeded",
    requestId: input.metadata.requestId ?? null,
    ip: input.metadata.ip,
  }).catch(() => undefined);

  return {
    token,
    expiresAt,
    user: toAuthUser(row),
  };
}

export async function authenticateSession(
  database: Database,
  token: string,
): Promise<AuthPrincipal> {
  if (!token || token.length > 256) {
    throw new AuthError("A valid session is required", "UNAUTHENTICATED");
  }
  const tokenHash = await hashSessionToken(token);
  const [row] = await database
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      active: users.active,
      organizationId: users.organizationId,
      organizationName: organizations.name,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .innerJoin(organizations, eq(users.organizationId, organizations.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);

  if (!row || !row.active || row.expiresAt <= new Date().toISOString()) {
    throw new AuthError("The session is invalid or expired", "SESSION_EXPIRED");
  }

  const lastSeenMs = row.lastSeenAt ? Date.parse(row.lastSeenAt) : 0;
  if (Date.now() - lastSeenMs > LAST_SEEN_REFRESH_MS) {
    await database
      .update(sessions)
      .set({ lastSeenAt: new Date().toISOString() })
      .where(eq(sessions.id, row.sessionId))
      .catch(() => undefined);
  }

  return {
    userId: row.userId,
    email: row.email,
    name: row.name,
    role: row.role,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    mode: "session",
  };
}

export function demoPrincipal(): AuthPrincipal {
  return {
    userId: null,
    email: "demo@mediflow.local",
    name: "Demo Mode",
    role: "admin",
    organizationId: DEMO_ORGANIZATION_ID,
    organizationName: DEMO_ORGANIZATION_NAME,
    mode: "demo",
  };
}

export function toSessionInfo(principal: AuthPrincipal): SessionInfo {
  return {
    user: {
      id: principal.userId ?? "demo-mode",
      email: principal.email,
      name: principal.name,
      role: principal.role,
      organizationId: principal.organizationId,
      organizationName: principal.organizationName,
    },
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    mode: principal.mode,
  };
}

export async function revokeSession(
  database: Database,
  token: string,
): Promise<void> {
  const tokenHash = await hashSessionToken(token);
  await database.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export async function cleanupExpiredSessions(database: Database): Promise<void> {
  await database
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date().toISOString()));
}

export async function recordAudit(
  database: Database,
  input: {
    organizationId: string | null;
    actorUserId: string | null;
    action: string;
    resourceType?: string;
    resourceId?: string;
    requestId?: string | null;
    ip?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await database.insert(auditLogs).values({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: input.action,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    requestId: input.requestId ?? null,
    ipHash: input.ip ? await hashIp(input.ip) : null,
    metadata: input.metadata ?? null,
  });
}



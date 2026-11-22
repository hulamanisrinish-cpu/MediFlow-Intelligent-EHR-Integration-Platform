import type { AuthRole } from "@mediflow/shared";

export interface AuthPrincipal {
  userId: string | null;
  email: string;
  name: string;
  role: AuthRole;
  organizationId: string;
  organizationName: string;
  mode: "session" | "demo";
}

export interface SessionMetadata {
  ip: string;
  userAgent: string | null;
  requestId?: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: 400 | 401 | 403 | 429 = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

import type {
  ApiSuccess,
  SimulationResetResult,
} from "@mediflow/shared";
import type { Handler } from "hono";
import { createDatabase } from "../db/client";
import { resetAndSeedDatabase } from "../db/seed";
import { getSimulationStatus } from "../simulation/clock";
import { recordAudit } from "../auth/service";
import { apiError } from "../middleware/security";
import type { AppEnvironment, DatabaseFactory } from "../types";

const BEARER_PREFIX = "Bearer ";
const MAX_RESET_TOKEN_LENGTH = 256;
const textEncoder = new TextEncoder();

async function hashToken(token: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(token),
  );
  return new Uint8Array(digest);
}

async function tokensMatch(
  suppliedToken: string,
  expectedToken: string,
): Promise<boolean> {
  if (
    suppliedToken.length === 0 ||
    suppliedToken.length > MAX_RESET_TOKEN_LENGTH
  ) {
    return false;
  }

  const [suppliedHash, expectedHash] = await Promise.all([
    hashToken(suppliedToken),
    hashToken(expectedToken),
  ]);
  let difference = 0;
  for (let index = 0; index < expectedHash.length; index += 1) {
    difference |= suppliedHash[index]! ^ expectedHash[index]!;
  }
  return difference === 0;
}

function bearerToken(authorization: string | undefined): string | null {
  if (!authorization?.startsWith(BEARER_PREFIX)) return null;
  return authorization.slice(BEARER_PREFIX.length).trim();
}

export function createResetHandler(
  databaseFactory: DatabaseFactory = createDatabase,
): Handler<AppEnvironment> {
  return async (context) => {
    const expectedToken = context.env.DEMO_RESET_TOKEN?.trim();
    const suppliedToken = bearerToken(context.req.header("Authorization"));
    const hasResetTokenAccess = Boolean(
      expectedToken &&
        suppliedToken &&
        (await tokensMatch(suppliedToken, expectedToken)),
    );
    if (!expectedToken) {
      return apiError(
        context,
        503,
        "DEMO_RESET_DISABLED",
        "Demo reset is not configured",
      );
    }

    if (!hasResetTokenAccess) {
      context.header("WWW-Authenticate", 'Bearer realm="mediflow-demo-reset"');
      return apiError(
        context,
        401,
        "DEMO_RESET_UNAUTHORIZED",
        "The demo reset key is invalid",
      );
    }

    const database = databaseFactory(context.env);
    await resetAndSeedDatabase(database);
    await recordAudit(database, {
      organizationId: context.get("principal").organizationId,
      actorUserId: context.get("principal").userId,
      action: "simulation.reset",
      resourceType: "simulation",
      resourceId: "current",
      requestId: context.get("requestId"),
      ip: context.get("clientIp"),
    }).catch(() => undefined);
    const response: ApiSuccess<SimulationResetResult> = {
      data: { state: await getSimulationStatus(database) },
    };
    return context.json(response);
  };
}

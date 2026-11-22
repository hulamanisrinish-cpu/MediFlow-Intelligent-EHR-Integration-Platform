import type { Database } from "./db/client";
import type { Bindings } from "./env";
import type { AuthPrincipal } from "./auth/types";

export interface AppVariables {
  principal: AuthPrincipal;
  requestId: string;
  clientIp: string;
}

export type AppEnvironment = {
  Bindings: Bindings;
  Variables: AppVariables;
};

export type DatabaseFactory = (bindings: Bindings) => Database;

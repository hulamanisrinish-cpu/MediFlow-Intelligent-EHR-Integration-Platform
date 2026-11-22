import { createClient } from "@libsql/client";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { fileURLToPath } from "node:url";
import { DEMO_USERS, seedAuthData } from "../auth/service";
import { validatePassword } from "../auth/password";
import { parseTursoConfig } from "../env";
import type { Database } from "./client";
import { CANONICAL_SEED, resetAndSeedDatabase } from "./seed";
import * as schema from "./schema";

const config = parseTursoConfig({
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
});
const client = createClient(config);
const database: Database = drizzle(client, { schema });
const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

const configuredPassword = process.env.DEMO_SEED_PASSWORD?.trim();
const generatedPassword = !configuredPassword;
const password = configuredPassword ?? randomBytes(32).toString("base64url");
const policyError = validatePassword(password);
if (policyError) {
  throw new Error(`DEMO_SEED_PASSWORD is invalid: ${policyError}`);
}

try {
  await migrate(database, { migrationsFolder });
  const data = await resetAndSeedDatabase(database, CANONICAL_SEED);
  await seedAuthData(database, password);

  console.log(
    `Seeded ${data.resources.length} resources and ${data.patients.length} simulated patients with seed ${CANONICAL_SEED}.`,
  );
  console.log(
    `Seeded ${DEMO_USERS.length} demo users: ${DEMO_USERS.map((user) => user.email).join(", ")}.`,
  );
  if (generatedPassword) {
    console.log(
      "Generated demo password (shown once; store it securely and do not commit it):",
    );
    console.log(`  ${password}`);
  } else {
    console.log("Demo users use the DEMO_SEED_PASSWORD value from the environment.");
  }
} finally {
  client.close();
}

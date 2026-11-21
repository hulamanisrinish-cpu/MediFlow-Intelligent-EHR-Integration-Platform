import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { fileURLToPath } from "node:url";
import { createApp } from "../app";
import { resetAndSeedDatabase } from "../db/seed";
import { patients, simulationEvents } from "../db/schema";
import * as schema from "../db/schema";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { advanceSimulation } from "./clock";

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

describe("emergency override", () => {
  async function setup() {
    const client = createClient({ url: "file::memory:" });
    const database: Database = drizzle(client, { schema });
    await migrate(database, { migrationsFolder });
    await resetAndSeedDatabase(database);
    return { client, database };
  }

  test("rejects override for an unknown patient", async () => {
    const { client, database } = await setup();
    try {
      const app = createApp(() => database);
      const res = await app.request("/api/patients/unknown/emergency-override", { method: "POST" }, {});
      assert.equal(res.status, 404);
      const body: Record<string, unknown> = await res.json();
      assert.equal((body.error as Record<string, string>).code, "PATIENT_NOT_FOUND");
    } finally {
      client.close();
    }
  });

  test("rejects override for a non-registered patient", async () => {
    const { client, database } = await setup();
    try {
      const app = createApp(() => database);
      const res = await app.request("/api/patients/pat-1/emergency-override", { method: "POST" }, {});
      assert.equal(res.status, 409);
      const body2: Record<string, unknown> = await res.json();
      assert.equal((body2.error as Record<string, string>).code, "EMERGENCY_NOT_ELIGIBLE");
    } finally {
      client.close();
    }
  });

  test("places an emergency patient at queue front and rebuilds plans", async () => {
    const { client, database } = await setup();
    try {
      const app = createApp(() => database);

      for (let i = 0; i < 50; i++) await advanceSimulation(database);

      const allPatients = await database
        .select()
        .from(patients)
        .orderBy(patients.id);

      const inHousePatient = allPatients.find(
        (p) => p.registered && p.completedAtMinute === null && !p.emergency,
      );
      if (!inHousePatient) {
        assert.fail("No in-house patient to test with – all patients after 3 ticks: " +
          JSON.stringify(allPatients.map((p) => ({ id: p.id, reg: p.registered, stage: p.currentStage, comp: p.completedAtMinute })))
        );
      }

      const res = await app.request(
        `/api/patients/${inHousePatient.id}/emergency-override`,
        { method: "POST" },
        {},
      );
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      const body3: { data: { patientId: string } } = await res.json();
      const result = body3.data;

      assert.equal(result.patientId, inHousePatient.id);

      const [updatedPatient, eventsAfter] = await Promise.all([
        database
          .select()
          .from(patients)
          .where(eq(patients.id, inHousePatient.id))
          .then((rows) => rows[0]),
        database
          .select()
          .from(simulationEvents)
          .where(eq(simulationEvents.type, "emergency_override"))
          .orderBy(simulationEvents.simulationMinute, simulationEvents.orderInMinute),
      ]);

      assert.ok(updatedPatient, "Patient should exist");
      assert.equal(updatedPatient.emergency, true, "Patient should be flagged as emergency");

      assert.ok(eventsAfter.length >= 1, "At least one emergency_override event should exist");
      const event = eventsAfter[0];
      assert.equal(event.patientId, inHousePatient.id);
      assert.equal(event.type, "emergency_override");
    } finally {
      client.close();
    }
  });

  test("rejects double override on the same patient", async () => {
    const { client, database } = await setup();
    try {
      const app = createApp(() => database);

      for (let i = 0; i < 50; i++) await advanceSimulation(database);

      const inHousePatient = (await database.select().from(patients)).find(
        (p) => p.registered && p.completedAtMinute === null,
      );
      if (!inHousePatient) assert.fail("No patient");

      const first = await app.request(
        `/api/patients/${inHousePatient.id}/emergency-override`,
        { method: "POST" },
        {},
      );
      assert.equal(first.status, 200);

      const second = await app.request(
        `/api/patients/${inHousePatient.id}/emergency-override`,
        { method: "POST" },
        {},
      );
      assert.equal(second.status, 409);
      const body4: Record<string, unknown> = await second.json();
      assert.equal((body4.error as Record<string, string>).code, "EMERGENCY_ALREADY_DECLARED");
    } finally {
      client.close();
    }
  });

  test("works with concurrent tick protection", async () => {
    const { client, database } = await setup();
    try {
      const app = createApp(() => database);

      for (let i = 0; i < 50; i++) await advanceSimulation(database);

      const inHousePatient = (await database.select().from(patients)).find(
        (p) => p.registered && p.completedAtMinute === null,
      );
      if (!inHousePatient) assert.fail("No patient");

      const res = await app.request(
        `/api/patients/${inHousePatient.id}/emergency-override`,
        { method: "POST" },
        {},
      );
      assert.equal(res.status, 200);

      await advanceSimulation(database);

      const ops = await app.request("/api/operations");
      assert.equal(ops.status, 200);
    } finally {
      client.close();
    }
  });

  test("rejects override for completed patient", async () => {
    const { client, database } = await setup();
    try {
      const app = createApp(() => database);

      for (let tick = 0; tick < 300; tick++) {
        await advanceSimulation(database);
      }

      const completedPatient = (await database.select().from(patients)).find(
        (p) => p.completedAtMinute !== null,
      );
      if (!completedPatient) assert.fail("No completed patient");

      const res = await app.request(
        `/api/patients/${completedPatient.id}/emergency-override`,
        { method: "POST" },
        {},
      );
      assert.equal(res.status, 409);
      const body5: Record<string, unknown> = await res.json();
      assert.equal((body5.error as Record<string, string>).code, "EMERGENCY_NOT_ELIGIBLE");
    } finally {
      client.close();
    }
  });
});

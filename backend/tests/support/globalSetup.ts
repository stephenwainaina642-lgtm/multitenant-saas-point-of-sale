import pg from "pg";
import { loadTestConfig } from "./env.js";
import { applyMigrations } from "./db.js";
import { startServer, waitForHealth, type RunningServer } from "./server.js";

let server: RunningServer | undefined;

export async function setup() {
  const cfg = loadTestConfig(); // safety guard runs here

  // 1. Recreate the isolated test database.
  const admin = new pg.Client({ connectionString: cfg.adminUrl });
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${cfg.dbName}" with (force)`);
    await admin.query(`create database "${cfg.dbName}"`);
  } finally {
    await admin.end();
  }

  // 2. Apply the repository migrations to it, in order.
  const db = new pg.Client({ connectionString: cfg.databaseUrl });
  await db.connect();
  try {
    await applyMigrations(db);
  } finally {
    await db.end();
  }

  // 3. Start the real API against the test database. Every variable that could
  //    point at the dev database is set explicitly; dotenv never overrides them.
  server = startServer(cfg.apiPort);

  try {
    await waitForHealth(`${cfg.apiBase}/health`, 40_000, server);
  } catch (e) {
    await server.stop();
    throw e;
  }
}

export async function teardown() {
  await server?.stop();
}

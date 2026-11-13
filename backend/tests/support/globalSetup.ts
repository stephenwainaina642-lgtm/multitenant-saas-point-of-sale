import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { loadTestConfig } from "./env.js";
import { applyMigrations } from "./db.js";

let server: ChildProcess | undefined;

async function waitForHealth(url: string, ms: number) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Test API did not become healthy at ${url}`);
}

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
  const backendDir = process.cwd();
  server = spawn(
    path.join(backendDir, "node_modules/.bin/tsx"),
    ["src/server.ts"],
    {
      cwd: backendDir,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(cfg.apiPort),
        JWT_SECRET: cfg.jwtSecret,
        DATABASE_URL: cfg.databaseUrl,
        DB_HOST: cfg.host,
        DB_PORT: String(cfg.port),
        DB_NAME: cfg.dbName,
        DB_USER: cfg.user,
        DB_PASSWORD: cfg.password,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const logs: string[] = [];
  server.stdout?.on("data", (d) => logs.push(String(d)));
  server.stderr?.on("data", (d) => logs.push(String(d)));

  try {
    await waitForHealth(`${cfg.apiBase}/health`, 40_000);
  } catch (e) {
    server.kill("SIGTERM");
    throw new Error(`${(e as Error).message}\n${logs.join("").slice(-2000)}`);
  }
}

export async function teardown() {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
  }
}

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { loadTestConfig } from "./env.js";

export type RunningServer = {
  process: ChildProcess;
  logs: () => string;
  stop: () => Promise<void>;
  exited: Promise<number | null>;
};

/** Start the real API (src/server.ts) pointed at the test database. */
export function startServer(
  port: number,
  extraEnv: Record<string, string> = {}
): RunningServer {
  const cfg = loadTestConfig();
  const backendDir = process.cwd();

  const child = spawn(path.join(backendDir, "node_modules/.bin/tsx"), ["src/server.ts"], {
    cwd: backendDir,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      JWT_SECRET: cfg.jwtSecret,
      DATABASE_URL: cfg.databaseUrl,
      DB_HOST: cfg.host,
      DB_PORT: String(cfg.port),
      DB_NAME: cfg.dbName,
      DB_USER: cfg.user,
      DB_PASSWORD: cfg.password,
      // Generous by default so the suite's many registrations are not throttled;
      // the rate-limit tests start their own server with low limits.
      LOGIN_RATE_LIMIT_MAX: "100000",
      REGISTER_RATE_LIMIT_MAX: "100000",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs: string[] = [];
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));

  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));

  return {
    process: child,
    logs: () => logs.join(""),
    exited,
    stop: async () => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await Promise.race([exited, new Promise((r) => setTimeout(r, 2000))]);
      }
    },
  };
}

export async function waitForHealth(url: string, ms: number, server?: RunningServer) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (server && server.process.exitCode !== null) {
      throw new Error(`Server exited early:\n${server.logs().slice(-1500)}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server did not become healthy at ${url}`);
}

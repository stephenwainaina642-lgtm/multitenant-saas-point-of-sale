import { URL } from "node:url";

/**
 * Test configuration and the safety guard.
 *
 * The test suite DROPS AND RECREATES its database. The guard below makes it
 * impossible to point it at a real database by accident:
 *  - the URL comes ONLY from TEST_DATABASE_URL (never from .env / DATABASE_URL)
 *  - the database name must end in "_test"
 *  - the name must differ from the dev database (DATABASE_URL / DB_NAME / pos_system)
 *  - the host must be local unless ALLOW_REMOTE_TEST_DB=1 is set
 */

const DEFAULT_URL = "postgresql://postgres:postgres@localhost:5433/nexapos_test";

export type TestConfig = {
  databaseUrl: string;
  adminUrl: string;
  dbName: string;
  host: string;
  port: number;
  user: string;
  password: string;
  apiPort: number;
  apiBase: string;
  jwtSecret: string;
};

function dbNameOf(urlString: string | undefined): string | null {
  if (!urlString) return null;
  try {
    return decodeURIComponent(new URL(urlString).pathname.replace(/^\//, "")) || null;
  } catch {
    return null;
  }
}

export function loadTestConfig(): TestConfig {
  const databaseUrl = process.env.TEST_DATABASE_URL || DEFAULT_URL;
  const parsed = new URL(databaseUrl);
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const host = parsed.hostname || "localhost";

  if (!/_test$/.test(dbName)) {
    throw new Error(
      `Refusing to run: test database name "${dbName}" must end with "_test".`
    );
  }

  const protectedNames = new Set(
    [
      dbNameOf(process.env.DATABASE_URL),
      process.env.DB_NAME,
      "pos_system",
      "postgres",
    ].filter((n): n is string => Boolean(n))
  );
  if (protectedNames.has(dbName)) {
    throw new Error(
      `Refusing to run: "${dbName}" is the same as a development database name.`
    );
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""]);
  if (!localHosts.has(host) && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
    throw new Error(
      `Refusing to run against non-local host "${host}". Set ALLOW_REMOTE_TEST_DB=1 only for a disposable server.`
    );
  }

  const admin = new URL(databaseUrl);
  admin.pathname = "/postgres";
  admin.search = "";

  const apiPort = Number(process.env.TEST_API_PORT || 5599);

  return {
    databaseUrl,
    adminUrl: admin.toString(),
    dbName,
    host: host || "localhost",
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username || "postgres"),
    password: decodeURIComponent(parsed.password || ""),
    apiPort,
    apiBase: `http://127.0.0.1:${apiPort}/api`,
    jwtSecret: "nexapos-test-only-secret-not-for-production",
  };
}

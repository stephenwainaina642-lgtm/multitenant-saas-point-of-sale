/**
 * Central, validated runtime configuration. Secrets are never defaulted:
 * a missing JWT_SECRET stops the server at startup instead of failing per request.
 */
export type AppConfig = {
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  jwtSecret: string;
  jwtExpiresIn: string;
  corsOrigins: string[];
  trustProxy: boolean;
  loginRateLimitMax: number;
  registerRateLimitMax: number;
};

const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";

  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is not set. Add it to backend/.env before starting the server.");
  }
  if (isProduction && jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production.");
  }

  const configured = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  return {
    port: Number(env.PORT) || 5000,
    nodeEnv,
    isProduction,
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN || "7d",
    // Production must list its origins explicitly; development defaults to Vite.
    corsOrigins: configured.length > 0 ? configured : isProduction ? [] : DEV_ORIGINS,
    trustProxy: env.TRUST_PROXY === "1",
    loginRateLimitMax: Number(env.LOGIN_RATE_LIMIT_MAX) || 10,
    registerRateLimitMax: Number(env.REGISTER_RATE_LIMIT_MAX) || 10,
  };
}

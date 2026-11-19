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
  /** Number of reverse proxies in front of the app (0 = none). Render alone is 1; behind a Vercel pass-through it is 2. */
  trustProxy: number;
  loginRateLimitMax: number;
  registerRateLimitMax: number;
  /** Public address of the web app, used in password-reset links. */
  appUrl: string | null;
  /** Present only when outgoing e-mail is fully configured. */
  smtp: { host: string; port: number; secure: boolean; user: string | null; pass: string | null; from: string } | null;
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

  const smtpHost = (env.SMTP_HOST ?? "").trim();
  const mailFrom = (env.MAIL_FROM ?? "").trim();
  const appUrl = (env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (smtpHost && (!mailFrom || !appUrl)) {
    throw new Error("SMTP_HOST is set, so MAIL_FROM and APP_URL must be set too (password-reset e-mails need them).");
  }
  if (appUrl && !/^https?:\/\//.test(appUrl)) throw new Error("APP_URL must start with http:// or https://");

  return {
    port: Number(env.PORT) || 5000,
    nodeEnv,
    isProduction,
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN || "12h",
    // Production must list its origins explicitly; development defaults to Vite.
    corsOrigins: configured.length > 0 ? configured : isProduction ? [] : DEV_ORIGINS,
    trustProxy: /^[1-9]$/.test((env.TRUST_PROXY ?? "").trim()) ? Number(env.TRUST_PROXY) : 0,
    loginRateLimitMax: Number(env.LOGIN_RATE_LIMIT_MAX) || 10,
    registerRateLimitMax: Number(env.REGISTER_RATE_LIMIT_MAX) || 10,
    appUrl: appUrl || null,
    smtp: smtpHost && mailFrom && appUrl
      ? {
          host: smtpHost,
          port: Number(env.SMTP_PORT) || 587,
          secure: env.SMTP_SECURE === "1",
          user: env.SMTP_USER || null,
          pass: env.SMTP_PASS || null,
          from: mailFrom,
        }
      : null,
  };
}

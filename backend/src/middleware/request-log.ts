import type { RequestHandler } from "express";

/**
 * One JSON line per finished request: method, path without query string, status, duration.
 * Never logs bodies, headers, tokens or query strings (they can hold personal data).
 */
export const requestLog: RequestHandler = (req, res, next) => {
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        ms,
      })
    );
  });
  next();
};

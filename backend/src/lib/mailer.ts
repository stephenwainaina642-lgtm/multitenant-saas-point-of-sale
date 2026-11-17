import nodemailer from "nodemailer";
import type { AppConfig } from "./config.js";

export type Mail = { to: string; subject: string; text: string };

/** Sends real e-mail through the configured SMTP server. Returns null when e-mail is not set up. */
export function createMailer(config: Pick<AppConfig, "smtp">): ((mail: Mail) => Promise<void>) | null {
  const smtp = config.smtp;
  if (!smtp) return null;
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...(smtp.user && { auth: { user: smtp.user, pass: smtp.pass ?? "" } }),
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return async (mail) => {
    await transport.sendMail({ from: smtp.from, to: mail.to, subject: mail.subject, text: mail.text });
  };
}

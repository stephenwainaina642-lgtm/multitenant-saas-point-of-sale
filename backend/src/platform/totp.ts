import crypto from "node:crypto";

/** Authenticator-app codes (RFC 6238: HMAC-SHA1, 6 digits, 30-second steps), implemented with Node's crypto only. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of text.replace(/=+$/, "").toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32 text");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

export function totpAt(secretBase32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = h[h.length - 1]! & 15;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 1_000_000).padStart(6, "0");
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

/** Returns the accepted step (so the caller can refuse a replay of the same code), or null. Allows 30 s of clock drift either way. */
export function verifyTotp(secretBase32: string, code: string, lastUsedStep: number, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(nowMs);
  for (const step of [current, current - 1, current + 1]) {
    if (step <= lastUsedStep) continue;
    const expected = Buffer.from(totpAt(secretBase32, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

export const otpauthUri = (secret: string, email: string) =>
  `otpauth://totp/nexaPOS%20Platform:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent("nexaPOS Platform")}&digits=6&period=30`;

// The secret is stored encrypted, with a key derived from JWT_SECRET (rotating JWT_SECRET means re-enrolling 2FA).
function key(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return crypto.createHmac("sha256", secret).update("nexapos-platform-totp-key-v1").digest();
}
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
export function decryptSecret(stored: string): string {
  const [iv, tag, enc] = stored.split(".").map((p) => Buffer.from(p, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(enc!), d.final()]).toString("utf8");
}

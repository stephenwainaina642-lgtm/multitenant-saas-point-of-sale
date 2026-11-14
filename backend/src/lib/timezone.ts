/** Time-zone helpers so "a day" means the business's day, not the server's. */

function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

export function isValidTimeZone(timeZone: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone }); return true; } catch { return false; }
}

/** The instant at which the calendar day `YYYY-MM-DD` begins in `timeZone`. */
export function startOfDay(dateText: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!m) throw new Error("Invalid date");
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    throw new Error("Invalid date");
  }
  const guess = probe.getTime();
  let result = guess - offsetMs(guess, timeZone);
  result = guess - offsetMs(result, timeZone); // settle across a DST edge
  return new Date(result);
}

/** `YYYY-MM-DD` of the next calendar day. */
export function nextDay(dateText: string): string {
  const d = new Date(`${dateText}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` (or `YYYY-MM`) of an instant as seen in `timeZone`. */
export function dayKey(instant: Date, timeZone: string, monthly: boolean): string {
  const text = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant);
  return monthly ? text.slice(0, 7) : text;
}

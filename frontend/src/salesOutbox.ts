import { useSyncExternalStore } from "react";
import { ApiError, apiRequest } from "./api/client";
import type { ReceiptData } from "./ReceiptModal";

/**
 * Sales are saved on this device first and sent to the server in the background, so a slow or
 * dropped connection never makes the till wait. Every queued sale carries its own idempotency key,
 * so sending it twice (a retry, a second tab) is recorded once by the server.
 */
export type QueuedSale = {
  key: string; // idempotency key
  businessId: string;
  branchId: string | null;
  userName: string | null; // who rang it up; only that user's session sends it
  createdAt: number;
  payload: unknown;
  receipt: ReceiptData; // what to show before the server confirms (no number yet)
  status: "waiting" | "failed";
  error?: string;
  attempts: number;
};

const STORE_KEY = "nexa_sales_outbox_v1";
type SentSale = { id: string; receiptNumber: string };
type Listener = () => void;

let cache: QueuedSale[] | null = null;
const listeners = new Set<Listener>();
let flushing = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let onSynced: ((q: QueuedSale, sale: SentSale) => void) | null = null;

function read(): QueuedSale[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    cache = raw ? (JSON.parse(raw) as QueuedSale[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: QueuedSale[]) {
  cache = next;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked: the queue still works for this page's lifetime */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; };
// Another tab changed the queue: pick it up.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => { if (e.key === STORE_KEY) { cache = null; listeners.forEach((l) => l()); } });
  window.addEventListener("online", () => { void flushOutbox(); });
}

export function useOutbox(): QueuedSale[] {
  return useSyncExternalStore(subscribe, read, read);
}
/** Sales that have not reached the server (waiting or failed). */
export const unsyncedCount = () => read().length;

export function enqueueSale(sale: Omit<QueuedSale, "status" | "attempts" | "createdAt">) {
  write([...read(), { ...sale, createdAt: Date.now(), status: "waiting", attempts: 0 }]);
  void flushOutbox();
}

export function discardSale(key: string) { write(read().filter((q) => q.key !== key)); }
export function retrySale(key: string) {
  write(read().map((q) => (q.key === key ? { ...q, status: "waiting", error: undefined } : q)));
  void flushOutbox();
}

/** Called once for each sale the server confirms (e.g. to fill in the receipt number and refresh stock). */
export function setSyncedHandler(fn: ((q: QueuedSale, sale: SentSale) => void) | null) { onSynced = fn; }

const currentUser = () => sessionStorage.getItem("pos_user_name");

/** A connection problem or a server fault: keep the sale and try again later. */
function retryable(err: unknown) {
  if (!(err instanceof ApiError)) return true; // network error, or a reply that was not from our server
  return err.status >= 500 || err.status === 408 || err.status === 429;
}

export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  if (timer) { clearTimeout(timer); timer = null; }
  flushing = true;
  let retryLater = false;
  try {
    for (const item of [...read()]) {
      if (item.status !== "waiting") continue;
      if (item.userName && currentUser() && item.userName !== currentUser()) continue; // someone else's sale
      if (!sessionStorage.getItem("pos_token")) { retryLater = true; break; } // signed out: wait for the next sign-in
      try {
        const res = await apiRequest<SentSale>("/sales", {
          method: "POST", token: sessionStorage.getItem("pos_token") ?? "", businessId: item.businessId,
          ...(item.branchId && { branchId: item.branchId }), idempotencyKey: item.key, body: item.payload,
        });
        write(read().filter((q) => q.key !== item.key));
        if (res.data) onSynced?.(item, res.data);
      } catch (err) {
        // The sign-in ended (expired, or another person signed in on this browser). The sale is fine: keep it waiting.
        // The app returns to the sign-in screen and the queue is sent right after the next sign-in.
        if (err instanceof ApiError && (err.status === 401 || err.status === 402)) break; // 402: the subscription is restricted; the sale waits until it is renewed
        if (retryable(err)) {
          write(read().map((q) => (q.key === item.key ? { ...q, attempts: q.attempts + 1 } : q)));
          retryLater = true;
          break; // keep order; try again shortly
        }
        const message = err instanceof Error ? err.message : "The sale was rejected.";
        write(read().map((q) => (q.key === item.key ? { ...q, status: "failed", error: message, attempts: q.attempts + 1 } : q)));
      }
    }
  } finally {
    flushing = false;
  }
  if (retryLater) {
    const attempts = Math.max(0, ...read().map((q) => q.attempts));
    timer = setTimeout(() => { void flushOutbox(); }, Math.min(60000, 3000 * 2 ** Math.min(attempts, 4)));
  }
}

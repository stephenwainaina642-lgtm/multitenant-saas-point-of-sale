import toast from "react-hot-toast";

/**
 * One place for success and error messages. Toasts float above the page (no layout shift, they dismiss themselves),
 * so screens do not need their own banner elements.
 */
export const notify = {
  success: (message: string) => toast.success(message, { id: `ok:${message}` }),
  error: (message: string) => toast.error(message, { id: `err:${message}`, duration: 6000 }),
  info: (message: string) => toast(message),
  /** Remove every toast (used when a new action starts). */
  clear: () => toast.dismiss(),
};

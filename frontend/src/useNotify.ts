import { useEffect } from "react";
import { notify } from "./toast";

/** Shows a screen's error / success text as a toast whenever it is set, instead of drawing a banner in the page. */
export function useNotify(error?: string | null, success?: string | null) {
  useEffect(() => { if (error) notify.error(error); }, [error]);
  useEffect(() => { if (success) notify.success(success); }, [success]);
}

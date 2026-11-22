import { ShieldAlert } from "lucide-react";

/** eTIMS has no form on purpose: KRA's specification is required before any field or endpoint can be offered. */
export default function EtimsSettings({ reason }: { reason: string | null }) {
  return (
    <div className="int-etims" role="note">
      <ShieldAlert size={18} aria-hidden />
      <div>
        <strong>KRA eTIMS (OSCU) is not connected.</strong>
        <p>{reason}</p>
        <p>Nothing is sent to KRA and nexaPOS does not claim eTIMS compliance.</p>
      </div>
    </div>
  );
}

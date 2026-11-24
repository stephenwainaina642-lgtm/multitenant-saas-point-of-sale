import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/** A thin bar shown while the device has no connection, so nobody is surprised that sales are queued. */
export default function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="offline-banner">
      <WifiOff size={15} aria-hidden="true" />
      <span>No internet. You can keep selling; sales are saved on this device and sent automatically when you're back online.</span>
    </div>
  );
}

import { useEffect, useState } from "react";
import { apiRequest } from "./api/client";

type Profile = { name: string; phone: string | null; email: string | null; address: string | null; taxPin: string | null };

/** Business name and contact details for the top of receipts and invoices (from Settings). */
export default function Letterhead() {
  const fallback = sessionStorage.getItem("pos_business_name") || "Business";
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let active = true;
    const token = sessionStorage.getItem("pos_token");
    const businessId = sessionStorage.getItem("pos_business_id");
    if (!token || !businessId) return;
    apiRequest<Profile>("/businesses/current", { token, businessId })
      .then((r) => { if (active && r.data) setProfile(r.data); })
      .catch(() => { /* the business name alone is still printed */ });
    return () => { active = false; };
  }, []);

  const details = [profile?.address, profile?.phone, profile?.email].filter((v): v is string => Boolean(v && v.trim()));

  return (
    <>
      <p className="sale-receipt-brand">{profile?.name || fallback}</p>
      {details.length > 0 && (
        <p className="sale-receipt-contact" style={{ margin: "-4px 0 10px", fontSize: 12, color: "#59665d" }}>
          {details.join(" · ")}
        </p>
      )}
      {profile?.taxPin && (
        <p className="sale-receipt-contact" style={{ margin: "-4px 0 10px", fontSize: 12, color: "#59665d" }}>
          KRA PIN: {profile.taxPin}
        </p>
      )}
    </>
  );
}

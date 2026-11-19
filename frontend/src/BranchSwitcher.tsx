import { useEffect, useState } from "react";
import { apiRequest } from "./api/client";

type Branch = { id: string; name: string; isMain: boolean; isActive: boolean; current: boolean };

/** Sidebar: which branch this device is working in. Staff tied to one branch just see its name. */
export default function BranchSwitcher() {
  const token = sessionStorage.getItem("pos_token") || "";
  const businessId = sessionStorage.getItem("pos_business_id") || "";
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    if (!token || !businessId) return;
    const load = () =>
      apiRequest<Branch[]>("/branches", { token, businessId })
        .then((r) => {
          const list = (r.data ?? []).filter((b) => b.isActive);
          setBranches(list);
          // A remembered branch that is no longer allowed or active is dropped.
          const remembered = sessionStorage.getItem(`pos_branch_${businessId}`);
          if (remembered && !list.some((b) => b.id === remembered)) sessionStorage.removeItem(`pos_branch_${businessId}`);
        })
        .catch(() => setBranches([]));
    void load();
    window.addEventListener("branches-changed", load);
    return () => window.removeEventListener("branches-changed", load);
  }, [token, businessId]);

  if (branches.length === 0) return null;
  const chosen = sessionStorage.getItem(`pos_branch_${businessId}`);
  const current = branches.find((b) => b.id === chosen) ?? branches.find((b) => b.current) ?? branches.find((b) => b.isMain) ?? branches[0]!;

  function change(id: string) {
    sessionStorage.setItem(`pos_branch_${businessId}`, id);
    window.location.reload(); // every screen reloads for the branch
  }

  return (
    <div style={{ margin: "8px 15px 0", padding: "8px 12px", borderRadius: 10, background: "rgba(255,255,255,0.08)", color: "#fff" }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, opacity: 0.7 }}>BRANCH</div>
      {branches.length > 1 ? (
        <select value={current.id} onChange={(e) => change(e.target.value)} aria-label="Branch" style={{ width: "100%", marginTop: 4, padding: "6px 8px", borderRadius: 6 }}>
          {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      ) : (
        <strong>{current.name}</strong>
      )}
    </div>
  );
}

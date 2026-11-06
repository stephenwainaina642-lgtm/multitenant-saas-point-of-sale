import { useState, type Dispatch, type SetStateAction } from "react";
import { builtInRoles } from "./roles";

const permissions = [
  { module: "Dashboard", actions: ["View"] },
  { module: "Point of Sale", actions: ["View", "Create sales", "Apply discounts"] },
  { module: "Sales", actions: ["View all", "View own", "Edit", "Delete"] },
  { module: "Products", actions: ["View", "Create", "Edit", "Delete"] },
  { module: "Inventory", actions: ["View", "Adjust stock", "Transfer stock"] },
  { module: "Purchases", actions: ["View", "Create", "Approve", "Edit"] },
  { module: "Customers", actions: ["View", "Create", "Edit", "Delete"] },
  { module: "Suppliers", actions: ["View", "Create", "Edit", "Delete"] },
  { module: "Expenses", actions: ["View", "Create", "Approve"] },
  { module: "Reports", actions: ["View all", "View own", "Export"] },
  { module: "Employees", actions: ["View", "Manage"] },
  { module: "Business Settings", actions: ["View", "Manage"] },
];

const defaults: Record<string, string[]> = {
  Owner: permissions.flatMap((item) => item.actions.map((action) => `${item.module}:${action}`)),
  "Business Manager": permissions.filter((item) => item.module !== "Business Settings").flatMap((item) => item.actions.map((action) => `${item.module}:${action}`)),
  Administrator: permissions.filter((item) => !["Business Settings", "Employees"].includes(item.module)).flatMap((item) => item.actions.map((action) => `${item.module}:${action}`)),
  "Inventory Manager": [
    "Dashboard:View", "Products:View", "Products:Create", "Products:Edit",
    "Inventory:View", "Inventory:Adjust stock", "Inventory:Transfer stock",
    "Purchases:View", "Purchases:Create", "Purchases:Edit",
    "Suppliers:View", "Suppliers:Create", "Suppliers:Edit", "Reports:View all",
  ],
  Supervisor: [
    "Dashboard:View", "Point of Sale:View", "Sales:View all",
    "Products:View", "Inventory:View", "Purchases:View",
    "Customers:View", "Suppliers:View", "Expenses:View",
    "Reports:View all", "Reports:Export", "Employees:View",
  ],
  Salesperson: [
    "Dashboard:View", "Point of Sale:View", "Point of Sale:Create sales",
    "Sales:View own", "Customers:View", "Customers:Create", "Reports:View own",
  ],
  Cashier: [
    "Dashboard:View", "Point of Sale:View", "Point of Sale:Create sales",
    "Sales:View own", "Customers:View",
  ],
};

type RolePermissionsPanelProps = {
  roles: string[];
  setRoles: Dispatch<SetStateAction<string[]>>;
};

export default function RolePermissionsPanel({ roles, setRoles }: RolePermissionsPanelProps) {
  const [selectedRole, setSelectedRole] = useState("Salesperson");
  const [access, setAccess] = useState(defaults);
  const [newRoleName, setNewRoleName] = useState("");
  const [notice, setNotice] = useState("");

  function togglePermission(module: string, action: string) {
    if (selectedRole === "Owner") return;
    const key = `${module}:${action}`;

    setAccess((current) => ({
      ...current,
      [selectedRole]: current[selectedRole].includes(key)
        ? current[selectedRole].filter((item) => item !== key)
        : [...current[selectedRole], key],
    }));
    setNotice("Permission updated in this preview.");
  }

  function createRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newRoleName.trim();

    if (!name) return;
    if (roles.some((role) => role.toLowerCase() === name.toLowerCase())) {
      setNotice("A role with that name already exists.");
      return;
    }

    setRoles((current) => [...current, name]);
    setAccess((current) => ({ ...current, [name]: [] }));
    setSelectedRole(name);
    setNewRoleName("");
    setNotice(`Custom role "${name}" created in this preview.`);
  }

  function deleteRole() {
    if (builtInRoles.includes(selectedRole)) return;

    setRoles((current) => current.filter((role) => role !== selectedRole));
    setAccess((current) => {
      const updated = { ...current };
      delete updated[selectedRole];
      return updated;
    });
    setSelectedRole("Salesperson");
    setNotice("Custom role deleted from this preview.");
  }

  const selectedAccess = access[selectedRole] ?? [];

  return (
    <article className="panel" style={{ padding: 24 }}>
      <div className="panel-heading">
        <div>
          <h2>Role & permissions</h2>
          <p>Define staff access across business operations</p>
        </div>
      </div>

      <form
        onSubmit={createRole}
        style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}
      >
        <input
          value={newRoleName}
          onChange={(event) => setNewRoleName(event.target.value)}
          placeholder="Enter a new role name"
          maxLength={60}
          required
          style={{
            flex: "1 1 220px",
            minWidth: 0,
            padding: "11px 12px",
            border: "1px solid #dfe7e2",
            borderRadius: 8,
            font: "inherit",
          }}
        />
        <button type="submit" className="button-primary">Create role</button>
      </form>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {roles.map((role) => (
          <button
            key={role}
            type="button"
            className={selectedRole === role ? "button-primary" : "button-secondary"}
            onClick={() => {
              setSelectedRole(role);
              setNotice("");
            }}
          >
            {role}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <strong>{selectedRole}</strong>
          <p style={{ margin: "4px 0 0", color: "#718078", fontSize: 12 }}>
            {selectedRole === "Owner"
              ? "Full access is protected."
              : `${selectedAccess.length} permissions enabled`}
          </p>
        </div>

        {!builtInRoles.includes(selectedRole) && (
          <button type="button" className="button-secondary" onClick={deleteRole}>
            Delete custom role
          </button>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #e5ebe7" }}>
              <th style={{ padding: "12px 10px" }}>Module</th>
              <th style={{ padding: "12px 10px" }}>Permission</th>
              <th style={{ padding: "12px 10px" }}>Access</th>
            </tr>
          </thead>
          <tbody>
            {permissions.map((item) =>
              item.actions.map((action) => {
                const enabled = selectedAccess.includes(`${item.module}:${action}`);

                return (
                  <tr key={`${item.module}-${action}`} style={{ borderBottom: "1px solid #edf1ee" }}>
                    <td style={{ padding: "12px 10px", fontWeight: 600 }}>{item.module}</td>
                    <td style={{ padding: "12px 10px" }}>{action}</td>
                    <td style={{ padding: "12px 10px" }}>
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={selectedRole === "Owner"}
                        onChange={() => togglePermission(item.module, action)}
                        aria-label={`${action} permission for ${selectedRole}`}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {notice && (
        <p className="customer-notice" style={{ marginTop: 16 }}>{notice}</p>
      )}

      <p className="customer-notice" style={{ marginTop: 12 }}>
        Preview only: roles and permissions are temporary and are not yet saved or enforced by the server.
      </p>
    </article>
  );
}






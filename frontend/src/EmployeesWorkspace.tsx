import { useMemo, useState } from "react";
import RolePermissionsPanel from "./RolePermissionsPanel";
import { builtInRoles } from "./roles";

type Employee = {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  jobTitle: string;
  role: string;
  joiningDate: string;
  status: "Active" | "Inactive";
  accountStatus: "Not invited" | "Invitation pending" | "Enabled" | "Suspended";
};

const emptyForm = {
  employeeCode: "",
  name: "",
  email: "",
  phone: "",
  department: "Sales",
  jobTitle: "",
  role: "Salesperson",
  joiningDate: new Date().toISOString().slice(0, 10),
};

type SalespersonPerformance = {
  id: string;
  name: string;
  email: string;
  salesCount: number;
  revenue: number;
  collected: number;
  outstanding: number;
};

type EmployeesWorkspaceProps = {
  salespersonPerformance?: SalespersonPerformance[];
};

export default function EmployeesWorkspace({
  salespersonPerformance = [],
}: EmployeesWorkspaceProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null);
  const [notice, setNotice] = useState("");
  const [roles, setRoles] = useState<string[]>(builtInRoles);

  const viewingPerformance = useMemo(() => {
    if (!viewingEmployee) return null;

    return salespersonPerformance.find((person) =>
      person.id === viewingEmployee.id ||
      (
        viewingEmployee.email.trim() !== "" &&
        person.email.trim().toLowerCase() ===
          viewingEmployee.email.trim().toLowerCase()
      )
    ) ?? null;
  }, [viewingEmployee, salespersonPerformance]);
  const filteredEmployees = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return employees;

    return employees.filter((employee) =>
      [
        employee.employeeCode,
        employee.name,
        employee.email,
        employee.phone,
        employee.department,
        employee.jobTitle,
        employee.role,
      ].join(" ").toLowerCase().includes(query)
    );
  }, [employees, search]);

  const activeCount = employees.filter((employee) => employee.status === "Active").length;

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");

    const code = form.employeeCode.trim() ||
      `EMP-${String(employees.length + 1).padStart(4, "0")}`;

    if (employees.some((employee) =>
      employee.employeeCode.toLowerCase() === code.toLowerCase() &&
      employee.id !== editingId
    )) {
      setNotice("That employee ID is already in use.");
      return;
    }

    const employee: Employee = {
      id: editingId ?? crypto.randomUUID(),
      employeeCode: code,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      department: form.department,
      jobTitle: form.jobTitle.trim(),
      role: form.role,
      joiningDate: form.joiningDate,
      status: editingId
        ? employees.find((item) => item.id === editingId)?.status ?? "Active"
        : "Active",
      accountStatus: editingId
        ? employees.find((item) => item.id === editingId)?.accountStatus ?? "Not invited"
        : "Not invited",
    };

    setEmployees((current) =>
      editingId
        ? current.map((item) => item.id === editingId ? employee : item)
        : [employee, ...current]
    );

    setNotice(
      editingId
        ? "Employee profile updated in this preview."
        : "Employee profile added to this preview."
    );
    resetForm();
  }

  function startEditing(employee: Employee) {
    setEditingId(employee.id);
    setForm({
      employeeCode: employee.employeeCode,
      name: employee.name,
      email: employee.email,
      phone: employee.phone,
      department: employee.department,
      jobTitle: employee.jobTitle,
      role: employee.role,
      joiningDate: employee.joiningDate,
    });
    setShowForm(true);
    setNotice("");
  }

  function toggleStatus(id: string) {
    setEmployees((current) =>
      current.map((employee) =>
        employee.id === id
          ? {
              ...employee,
              status: employee.status === "Active" ? "Inactive" : "Active",
            }
          : employee
      )
    );
    setNotice("Employee status updated in this preview.");
  }
  function updateAccountStatus(id: string, accountStatus: Employee["accountStatus"]) {
    const employee = employees.find((item) => item.id === id);

    if (accountStatus === "Invitation pending" && !employee?.email.trim()) {
      setNotice("Add an employee email address before marking an invitation as pending.");
      return;
    }

    setEmployees((current) =>
      current.map((employee) =>
        employee.id === id ? { ...employee, accountStatus } : employee
      )
    );
    setNotice("Employee account access updated in this preview only.");
  }

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 12px",
    border: "1px solid #dfe7e2",
    borderRadius: 8,
    font: "inherit",
    background: "#fff",
    color: "#24372e",
    marginTop: 6,
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    fontWeight: 600,
    color: "#344b40",
  };

  return (
    <section style={{ display: "grid", gap: 20 }}>
      <article className="panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>Employee directory</h2>
            <p>Manage staff profiles, departments and business access roles</p>
          </div>
          <button
            type="button"
            className="button-primary"
            onClick={() => {
              if (showForm) resetForm();
              else {
                setForm(emptyForm);
                setEditingId(null);
                setShowForm(true);
              }
            }}
          >
            {showForm ? "Close form" : "Add employee"}
          </button>
        </div>

        <div className="customer-summary">
          <div>
            <span className="customer-summary-label">Total employees</span>
            <strong>{employees.length.toLocaleString("en-KE")}</strong>
          </div>
          <div>
            <span className="customer-summary-label">Active employees</span>
            <strong>{activeCount.toLocaleString("en-KE")}</strong>
          </div>
          <div>
            <span className="customer-summary-label">Inactive employees</span>
            <strong>{(employees.length - activeCount).toLocaleString("en-KE")}</strong>
          </div>
        </div>

        <label htmlFor="employee-search" style={labelStyle}>
          Search employees
        </label>
        <input
          id="employee-search"
          style={fieldStyle}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by employee ID, name, department or role"
        />

        <p className="customer-notice" role="status">
          Preview mode: employee changes are temporary and are not yet saved to PostgreSQL.
        </p>

        {notice && <p className="customer-notice" role="status">{notice}</p>}

        <div className="table-scroll" style={{ marginTop: 18 }}>
          <table>
            <thead>
              <tr>
                <th>EMPLOYEE</th>
                <th>DEPARTMENT</th>
                <th>JOB TITLE</th>
                <th>ACCESS ROLE</th>
                <th>JOINED</th>
                <th>STATUS</th>
                <th>ACCOUNT ACCESS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredEmployees.map((employee) => (
                <tr key={employee.id}>
                  <td>
                    <strong>{employee.name}</strong>
                    <div className="customer-secondary-text">
                      {employee.employeeCode} · {employee.email || employee.phone || "No contact details"}
                    </div>
                  </td>
                  <td>{employee.department}</td>
                  <td>{employee.jobTitle || "—"}</td>
                  <td>{employee.role}</td>
                  <td>{employee.joiningDate || "—"}</td>
                  <td>{employee.status}</td>
                  <td>
                    <select
                      className={`account-access-select account-access-${employee.accountStatus.toLowerCase().replace(/\s+/g, "-")}`}
                      value={employee.accountStatus}
                      onChange={(event) =>
                        updateAccountStatus(employee.id, event.target.value as Employee["accountStatus"])
                      }
                      aria-label={`Account access for ${employee.name}`}
                    >
                      <option value="Not invited">Not invited</option>
                      <option value="Invitation pending">Invitation pending</option>
                      <option value="Enabled">Enabled</option>
                      <option value="Suspended">Suspended</option>
                    </select>
                  </td>
                  <td>
                    <div className="customer-actions">
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => setViewingEmployee(employee)}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => startEditing(employee)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => toggleStatus(employee.id)}
                      >
                        {employee.status === "Active" ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredEmployees.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-row">
                    {employees.length === 0
                      ? "No employee profiles have been added yet."
                      : "No employees match your search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      {viewingEmployee && (
        <article className="panel" style={{ padding: 24 }}>
          <div className="panel-heading">
            <div>
              <h2>Employee profile</h2>
              <p>Read-only employee information</p>
            </div>
            <button
              type="button"
              className="button-secondary"
              onClick={() => setViewingEmployee(null)}
            >
              Close profile
            </button>
          </div>

          <div className="customer-form-grid">
            <div>
              <span className="customer-summary-label">Employee name</span>
              <strong>{viewingEmployee.name}</strong>
            </div>
            <div>
              <span className="customer-summary-label">Employee ID</span>
              <strong>{viewingEmployee.employeeCode}</strong>
            </div>
            <div>
              <span className="customer-summary-label">Email address</span>
              <strong>{viewingEmployee.email || "Not provided"}</strong>
            </div>
            <div>
              <span className="customer-summary-label">Phone number</span>
              <strong>{viewingEmployee.phone || "Not provided"}</strong>
            </div>
            <div>
              <span className="customer-summary-label">Department</span>
              <strong>{viewingEmployee.department}</strong>
            </div>
            <div>
              <span className="customer-summary-label">Job title</span>
              <strong>{viewingEmployee.jobTitle || "Not specified"}</strong>
            </div>
            <div>
              <span className="customer-summary-label">Access role</span>
              <strong>{viewingEmployee.role}</strong>
            </div>
            <div>
              <span className="customer-summary-label">Joining date</span>
              <strong>{viewingEmployee.joiningDate || "Not provided"}</strong>
            </div>
            <div>
              <span className="customer-summary-label">Employment status</span>
              <strong>{viewingEmployee.status}</strong>
            </div>
            <div>
              <span className="customer-summary-label">Account access</span>
              <strong>{viewingEmployee.accountStatus}</strong>
            </div>
          </div>

          <section style={{ marginTop: 24 }}>
            <div className="panel-heading">
              <div>
                <h3>Sales performance</h3>
                <p>Sales recorded under this employee</p>
              </div>
            </div>

            {viewingPerformance ? (
              <div className="customer-form-grid">
                <div>
                  <span className="customer-summary-label">Total sales</span>
                  <strong>{viewingPerformance.salesCount}</strong>
                </div>
                <div>
                  <span className="customer-summary-label">Revenue</span>
                  <strong>{`KSh ${viewingPerformance.revenue.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</strong>
                </div>
                <div>
                  <span className="customer-summary-label">Collected</span>
                  <strong>{`KSh ${viewingPerformance.collected.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</strong>
                </div>
                <div>
                  <span className="customer-summary-label">Outstanding</span>
                  <strong>{`KSh ${viewingPerformance.outstanding.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</strong>
                </div>
              </div>
            ) : (
              <p className="empty-row">
                No sales are currently linked to this employee. Sales will appear here when their ID or email matches a recorded sale.
              </p>
            )}
          </section>
        </article>
      )}
      {showForm && (
        <article className="panel" style={{ padding: 24 }}>
          <div className="panel-heading">
            <div>
              <h2>{editingId ? "Edit employee profile" : "New employee profile"}</h2>
              <p>Enter the employee's details and assign an access role</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
            <div className="customer-form-grid">
              <label style={labelStyle}>
                Employee ID
                <input
                  style={fieldStyle}
                  value={form.employeeCode}
                  onChange={(event) => updateField("employeeCode", event.target.value)}
                  placeholder="Auto-generated if blank"
                  maxLength={40}
                />
              </label>

              <label style={labelStyle}>
                Full name *
                <input
                  style={fieldStyle}
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  maxLength={150}
                  autoComplete="name"
                  required
                />
              </label>

              <label style={labelStyle}>
                Email address
                <input
                  type="email"
                  style={fieldStyle}
                  value={form.email}
                  onChange={(event) => updateField("email", event.target.value)}
                  maxLength={150}
                  autoComplete="email"
                />
              </label>

              <label style={labelStyle}>
                Phone number
                <input
                  style={fieldStyle}
                  value={form.phone}
                  onChange={(event) => updateField("phone", event.target.value)}
                  maxLength={30}
                  placeholder="+254..."
                  autoComplete="tel"
                />
              </label>

              <label style={labelStyle}>
                Department *
                <select
                  style={fieldStyle}
                  value={form.department}
                  onChange={(event) => updateField("department", event.target.value)}
                >
                  <option>Sales</option>
                  <option>Inventory</option>
                  <option>Finance</option>
                  <option>Procurement</option>
                  <option>Operations</option>
                  <option>Administration</option>
                  <option>Customer Service</option>
                </select>
              </label>

              <label style={labelStyle}>
                Job title
                <input
                  style={fieldStyle}
                  value={form.jobTitle}
                  onChange={(event) => updateField("jobTitle", event.target.value)}
                  maxLength={100}
                  placeholder="e.g. Store Supervisor"
                />
              </label>

              <label style={labelStyle}>
                Access role *
                <select
                  style={fieldStyle}
                  value={form.role}
                  onChange={(event) => updateField("role", event.target.value)}
                >
                  {roles.filter((role) => role !== "Owner").map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </label>

              <label style={labelStyle}>
                Joining date *
                <input
                  type="date"
                  style={fieldStyle}
                  value={form.joiningDate}
                  onChange={(event) => updateField("joiningDate", event.target.value)}
                  required
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" className="button-primary">
                {editingId ? "Save changes" : "Add employee"}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={resetForm}
              >
                Cancel
              </button>
            </div>
          </form>
        </article>
      )}
      <RolePermissionsPanel roles={roles} setRoles={setRoles} />
    </section>
  );
}






















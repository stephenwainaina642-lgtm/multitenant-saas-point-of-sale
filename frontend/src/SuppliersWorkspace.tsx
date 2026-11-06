import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api/client";

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
};

const emptyForm = {
  name: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
};

type SupplierForm = typeof emptyForm;

export default function SuppliersWorkspace() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<SupplierForm>(emptyForm);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const token = sessionStorage.getItem("pos_token") ?? "";
  const businessId = sessionStorage.getItem("pos_business_id") ?? "";

  const loadSuppliers = useCallback(async () => {
    if (!token || !businessId) {
      setError("Your session or selected business is missing. Please sign in again.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await apiRequest<Supplier[]>("/suppliers", {
        token,
        businessId,
      });
      setSuppliers(response.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load suppliers.");
    } finally {
      setLoading(false);
    }
  }, [token, businessId]);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  const filteredSuppliers = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return suppliers;

    return suppliers.filter((supplier) =>
      [
        supplier.name,
        supplier.phone,
        supplier.email,
        supplier.address,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [suppliers, search]);

  function updateField(field: keyof SupplierForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingSupplier(null);
  }

  function startEditing(supplier: Supplier) {
    setEditingSupplier(supplier);
    setForm({
      name: supplier.name,
      phone: supplier.phone ?? "",
      email: supplier.email ?? "",
      address: supplier.address ?? "",
      notes: supplier.notes ?? "",
    });
    setError("");
    setMessage("");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!form.name.trim()) {
      setError("Enter the supplier's name.");
      return;
    }

    if (form.name.trim().length > 150) {
      setError("Supplier name must not exceed 150 characters.");
      return;
    }

    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError("Enter a valid email address.");
      return;
    }

    const body = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      notes: form.notes.trim(),
    };

    setSaving(true);

    try {
      if (editingSupplier) {
        const response = await apiRequest<Supplier>(
          `/suppliers/${editingSupplier.id}`,
          {
            method: "PUT",
            token,
            businessId,
            body,
          }
        );

        if (response.data) {
          setSuppliers((current) =>
            current.map((supplier) =>
              supplier.id === editingSupplier.id ? response.data! : supplier
            )
          );
        }

        setMessage("Supplier updated successfully.");
      } else {
        const response = await apiRequest<Supplier>("/suppliers", {
          method: "POST",
          token,
          businessId,
          body,
        });

        if (response.data) {
          setSuppliers((current) => [
            response.data!,
            ...current.filter((supplier) => supplier.id !== response.data!.id),
          ]);
        }

        setMessage("Supplier registered successfully.");
      }

      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save supplier.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(supplier: Supplier) {
    const confirmed = window.confirm(
      `Deactivate "${supplier.name}"? Historical sales records will be preserved.`
    );

    if (!confirmed) return;

    setError("");
    setMessage("");
    setSaving(true);

    try {
      await apiRequest<Supplier>(`/suppliers/${supplier.id}`, {
        method: "DELETE",
        token,
        businessId,
      });

      setSuppliers((current) =>
        current.filter((item) => item.id !== supplier.id)
      );

      if (editingSupplier?.id === supplier.id) {
        resetForm();
      }

      setMessage(`"${supplier.name}" was deactivated successfully.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not deactivate supplier.");
    } finally {
      setSaving(false);
    }
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
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: 6,
    fontSize: 12,
    fontWeight: 600,
    color: "#344b40",
  };

  return (
    <section className="suppliers-workspace" style={{ display: "grid", gap: 20 }}>
      <article className="panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>Supplier directory</h2>
            <p>Manage supplier records for your business</p>
          </div>
          <button
            type="button"
            className="button-secondary"
            onClick={() => void loadSuppliers()}
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="supplier-summary">
          <div>
            <span className="supplier-summary-label">Active suppliers</span>
            <strong>{suppliers.length.toLocaleString("en-KE")}</strong>
          </div>
          <div>
            <span className="supplier-summary-label">Search results</span>
            <strong>{filteredSuppliers.length.toLocaleString("en-KE")}</strong>
          </div>
        </div>

        <label style={labelStyle} htmlFor="supplier-search">
          Search suppliers
        </label>
        <input
          id="supplier-search"
          style={fieldStyle}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, phone, email or address"
        />

        {error && (
          <p role="alert" className="supplier-notice supplier-error">
            {error}
          </p>
        )}

        {message && (
          <p role="status" className="supplier-notice supplier-success">
            {message}
          </p>
        )}

        <div className="table-scroll" style={{ marginTop: 18 }}>
          <table>
            <thead>
              <tr>
                <th>SUPPLIER</th>
                <th>PHONE</th>
                <th>EMAIL</th>
                <th>ADDRESS</th>
                <th>REGISTERED</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                filteredSuppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>
                      <strong>{supplier.name}</strong>
                      {supplier.notes && (
                        <div className="supplier-secondary-text">
                          {supplier.notes}
                        </div>
                      )}
                    </td>
                    <td>{supplier.phone || "—"}</td>
                    <td>{supplier.email || "—"}</td>
                    <td>{supplier.address || "—"}</td>
                    <td>
                      {supplier.createdAt
                        ? new Date(supplier.createdAt).toLocaleDateString("en-KE")
                        : "—"}
                    </td>
                    <td>
                      <div className="supplier-actions">
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => startEditing(supplier)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="button-secondary supplier-deactivate"
                          onClick={() => void handleDeactivate(supplier)}
                          disabled={saving}
                        >
                          Deactivate
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

              {!loading && filteredSuppliers.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-row">
                    {suppliers.length === 0
                      ? "No suppliers have been registered for this business yet."
                      : "No suppliers match your search."}
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td colSpan={6}>Loading suppliers from PostgreSQL...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel supplier-form-panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>{editingSupplier ? "Edit supplier" : "Register a supplier"}</h2>
            <p>
              {editingSupplier
                ? `Update the details for ${editingSupplier.name}`
                : "Add a supplier to the selected business"}
            </p>
          </div>

          {editingSupplier && (
            <button
              type="button"
              className="button-secondary"
              onClick={resetForm}
              disabled={saving}
            >
              Cancel
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
          <div className="supplier-form-grid">
            <label style={labelStyle}>
              Supplier name *
              <input
                style={{ ...fieldStyle, marginTop: 6 }}
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                maxLength={150}
                autoComplete="name"
                required
              />
            </label>

            <label style={labelStyle}>
              Phone number
              <input
                style={{ ...fieldStyle, marginTop: 6 }}
                value={form.phone}
                onChange={(event) => updateField("phone", event.target.value)}
                maxLength={30}
                autoComplete="tel"
                placeholder="+254..."
              />
            </label>

            <label style={labelStyle}>
              Email address
              <input
                style={{ ...fieldStyle, marginTop: 6 }}
                type="email"
                value={form.email}
                onChange={(event) => updateField("email", event.target.value)}
                maxLength={150}
                autoComplete="email"
              />
            </label>

            <label style={labelStyle}>
              Address
              <input
                style={{ ...fieldStyle, marginTop: 6 }}
                value={form.address}
                onChange={(event) => updateField("address", event.target.value)}
                maxLength={250}
                autoComplete="street-address"
              />
            </label>
          </div>

          <label style={labelStyle}>
            Notes
            <textarea
              style={{ ...fieldStyle, marginTop: 6, minHeight: 85, resize: "vertical" }}
              value={form.notes}
              onChange={(event) => updateField("notes", event.target.value)}
              maxLength={1000}
              placeholder="Additional supplier information..."
            />
          </label>

          <div>
            <button className="button-primary" type="submit" disabled={saving}>
              {saving
                ? "Saving..."
                : editingSupplier
                  ? "Save supplier changes"
                  : "Register supplier"}
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}



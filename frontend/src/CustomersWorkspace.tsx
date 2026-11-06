import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api/client";

type Customer = {
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

type CustomerForm = typeof emptyForm;

export default function CustomersWorkspace() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const token = sessionStorage.getItem("pos_token") ?? "";
  const businessId = sessionStorage.getItem("pos_business_id") ?? "";

  const loadCustomers = useCallback(async () => {
    if (!token || !businessId) {
      setError("Your session or selected business is missing. Please sign in again.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await apiRequest<Customer[]>("/customers", {
        token,
        businessId,
      });
      setCustomers(response.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load customers.");
    } finally {
      setLoading(false);
    }
  }, [token, businessId]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return customers;

    return customers.filter((customer) =>
      [
        customer.name,
        customer.phone,
        customer.email,
        customer.address,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [customers, search]);

  function updateField(field: keyof CustomerForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingCustomer(null);
  }

  function startEditing(customer: Customer) {
    setEditingCustomer(customer);
    setForm({
      name: customer.name,
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      address: customer.address ?? "",
      notes: customer.notes ?? "",
    });
    setError("");
    setMessage("");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!form.name.trim()) {
      setError("Enter the customer's name.");
      return;
    }

    if (form.name.trim().length > 150) {
      setError("Customer name must not exceed 150 characters.");
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
      if (editingCustomer) {
        const response = await apiRequest<Customer>(
          `/customers/${editingCustomer.id}`,
          {
            method: "PUT",
            token,
            businessId,
            body,
          }
        );

        if (response.data) {
          setCustomers((current) =>
            current.map((customer) =>
              customer.id === editingCustomer.id ? response.data! : customer
            )
          );
        }

        setMessage("Customer updated successfully.");
      } else {
        const response = await apiRequest<Customer>("/customers", {
          method: "POST",
          token,
          businessId,
          body,
        });

        if (response.data) {
          setCustomers((current) => [
            response.data!,
            ...current.filter((customer) => customer.id !== response.data!.id),
          ]);
        }

        setMessage("Customer registered successfully.");
      }

      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save customer.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(customer: Customer) {
    const confirmed = window.confirm(
      `Deactivate "${customer.name}"? Historical sales records will be preserved.`
    );

    if (!confirmed) return;

    setError("");
    setMessage("");
    setSaving(true);

    try {
      await apiRequest<Customer>(`/customers/${customer.id}`, {
        method: "DELETE",
        token,
        businessId,
      });

      setCustomers((current) =>
        current.filter((item) => item.id !== customer.id)
      );

      if (editingCustomer?.id === customer.id) {
        resetForm();
      }

      setMessage(`"${customer.name}" was deactivated successfully.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not deactivate customer.");
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
    <section className="customers-workspace" style={{ display: "grid", gap: 20 }}>
      <article className="panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>Customer directory</h2>
            <p>Manage customer records for your business</p>
          </div>
          <button
            type="button"
            className="button-secondary"
            onClick={() => void loadCustomers()}
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="customer-summary">
          <div>
            <span className="customer-summary-label">Active customers</span>
            <strong>{customers.length.toLocaleString("en-KE")}</strong>
          </div>
          <div>
            <span className="customer-summary-label">Search results</span>
            <strong>{filteredCustomers.length.toLocaleString("en-KE")}</strong>
          </div>
        </div>

        <label style={labelStyle} htmlFor="customer-search">
          Search customers
        </label>
        <input
          id="customer-search"
          style={fieldStyle}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, phone, email or address"
        />

        {error && (
          <p role="alert" className="customer-notice customer-error">
            {error}
          </p>
        )}

        {message && (
          <p role="status" className="customer-notice customer-success">
            {message}
          </p>
        )}

        <div className="table-scroll" style={{ marginTop: 18 }}>
          <table>
            <thead>
              <tr>
                <th>CUSTOMER</th>
                <th>PHONE</th>
                <th>EMAIL</th>
                <th>ADDRESS</th>
                <th>REGISTERED</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                filteredCustomers.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <strong>{customer.name}</strong>
                      {customer.notes && (
                        <div className="customer-secondary-text">
                          {customer.notes}
                        </div>
                      )}
                    </td>
                    <td>{customer.phone || "—"}</td>
                    <td>{customer.email || "—"}</td>
                    <td>{customer.address || "—"}</td>
                    <td>
                      {customer.createdAt
                        ? new Date(customer.createdAt).toLocaleDateString("en-KE")
                        : "—"}
                    </td>
                    <td>
                      <div className="customer-actions">
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => startEditing(customer)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="button-secondary customer-deactivate"
                          onClick={() => void handleDeactivate(customer)}
                          disabled={saving}
                        >
                          Deactivate
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

              {!loading && filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-row">
                    {customers.length === 0
                      ? "No customers have been registered for this business yet."
                      : "No customers match your search."}
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td colSpan={6}>Loading customers from PostgreSQL...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel customer-form-panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>{editingCustomer ? "Edit customer" : "Register a customer"}</h2>
            <p>
              {editingCustomer
                ? `Update the details for ${editingCustomer.name}`
                : "Add a customer to the selected business"}
            </p>
          </div>

          {editingCustomer && (
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
          <div className="customer-form-grid">
            <label style={labelStyle}>
              Customer name *
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
              placeholder="Additional customer information..."
            />
          </label>

          <div>
            <button className="button-primary" type="submit" disabled={saving}>
              {saving
                ? "Saving..."
                : editingCustomer
                  ? "Save customer changes"
                  : "Register customer"}
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}

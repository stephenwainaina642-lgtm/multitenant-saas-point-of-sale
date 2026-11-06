import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api/client";

type Expense = {
  id: string;
  category: string;
  description: string | null;
  amount: number | string;
  expenseDate: string;
  paymentMethod: string | null;
  reference: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

const today = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};

const emptyForm = {
  category: "",
  description: "",
  amount: "",
  expenseDate: today(),
  paymentMethod: "",
  reference: "",
  notes: "",
};

const money = (value: number | string) =>
  Number(value || 0).toLocaleString("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fieldStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 12px",
  border: "1px solid #dfe7e2",
  borderRadius: 8,
  font: "inherit",
  background: "#fff",
  color: "#24372e",
  minWidth: 0,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontSize: 12,
  fontWeight: 600,
  color: "#344b40",
};

export default function ExpensesWorkspace() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);

  const token = sessionStorage.getItem("pos_token") ?? "";
  const businessId = sessionStorage.getItem("pos_business_id") ?? "";

  const loadExpenses = useCallback(async () => {
    if (!token || !businessId) {
      setError("Your session or selected business is missing. Please sign in again.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await apiRequest<Expense[]>("/expenses", {
        token,
        businessId,
      });

      setExpenses(response.data ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load expense records."
      );
    } finally {
      setLoading(false);
    }
  }, [token, businessId]);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  const filteredExpenses = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return expenses;

    return expenses.filter((expense) =>
      [
        expense.category,
        expense.description,
        expense.paymentMethod,
        expense.reference,
        expense.notes,
        expense.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [expenses, search]);

  const totalExpenses = expenses.reduce(
    (sum, expense) => sum + Number(expense.amount || 0),
    0
  );

  const currentMonth = new Date();
  const monthlyExpenses = expenses.reduce((sum, expense) => {
    const date = new Date(expense.expenseDate);

    if (
      date.getMonth() === currentMonth.getMonth() &&
      date.getFullYear() === currentMonth.getFullYear()
    ) {
      return sum + Number(expense.amount || 0);
    }

    return sum;
  }, 0);

  const averageExpense =
    expenses.length > 0 ? totalExpenses / expenses.length : 0;

  function updateForm(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm({ ...emptyForm, expenseDate: today() });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const amount = Number(form.amount);

    if (!form.category.trim()) {
      setError("Enter an expense category.");
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter an expense amount greater than zero.");
      return;
    }

    if (!form.expenseDate) {
      setError("Select the date of the expense.");
      return;
    }

    const body = {
      category: form.category.trim(),
      description: form.description.trim(),
      amount,
      expenseDate: form.expenseDate,
      paymentMethod: form.paymentMethod,
      reference: form.reference.trim(),
      notes: form.notes.trim(),
    };

    setSaving(true);

    try {
      await apiRequest<Expense>("/expenses", {
        method: "POST",
        token,
        businessId,
        body,
      });

      setMessage("Expense recorded successfully.");
      resetForm();
      await loadExpenses();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not record this expense."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="suppliers-workspace"
      style={{ display: "grid", gap: 20 }}
    >
      <article className="panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>Expense overview</h2>
            <p>Monitor operating costs and keep track of business spending</p>
          </div>

          <button
            type="button"
            className="button-secondary"
            onClick={() => void loadExpenses()}
            disabled={loading || saving}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="supplier-summary">
          <div>
            <span className="supplier-summary-label">Total expenses</span>
            <strong>{money(totalExpenses)}</strong>
          </div>
          <div>
            <span className="supplier-summary-label">This month</span>
            <strong>{money(monthlyExpenses)}</strong>
          </div>
          <div>
            <span className="supplier-summary-label">Recorded expenses</span>
            <strong>{expenses.length.toLocaleString("en-KE")}</strong>
          </div>
          <div>
            <span className="supplier-summary-label">Average expense</span>
            <strong>{money(averageExpense)}</strong>
          </div>
        </div>

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

        <label style={labelStyle} htmlFor="expense-search">
          Search expense history
        </label>
        <input
          id="expense-search"
          style={fieldStyle}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search category, description, payment method or reference"
        />

        <div className="table-scroll" style={{ marginTop: 18 }}>
          <table>
            <thead>
              <tr>
                <th>REFERENCE</th>
                <th>CATEGORY</th>
                <th>DESCRIPTION</th>
                <th>DATE</th>
                <th>PAYMENT METHOD</th>
                <th>AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                filteredExpenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>
                      <strong>{expense.reference || `EXP-${expense.id}`}</strong>
                    </td>
                    <td>{expense.category}</td>
                    <td>{expense.description || "—"}</td>
                    <td>
                      {expense.expenseDate
                        ? new Date(expense.expenseDate).toLocaleDateString(
                            "en-KE"
                          )
                        : "—"}
                    </td>
                    <td>
                      {expense.paymentMethod
                        ? expense.paymentMethod.replace(/_/g, " ")
                        : "—"}
                    </td>
                    <td>
                      <strong>{money(expense.amount)}</strong>
                    </td>
                  </tr>
                ))}

              {!loading && filteredExpenses.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-row">
                    {expenses.length === 0
                      ? "No expenses have been recorded for this business yet."
                      : "No expenses match your search."}
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td colSpan={6}>Loading expenses from PostgreSQL...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel supplier-form-panel" style={{ padding: 24 }}>
        <div className="panel-heading">
          <div>
            <h2>Record an expense</h2>
            <p>Capture business costs, payment details and supporting references</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 18 }}>
          <div className="supplier-form-grid">
            <label style={labelStyle}>
              Category *
              <input
                style={{ ...fieldStyle, marginTop: 6 }}
                value={form.category}
                onChange={(event) => updateForm("category", event.target.value)}
                maxLength={100}
                placeholder="e.g. Rent, Transport, Utilities"
                required
              />
            </label>

            <label style={labelStyle}>
              Amount (KES) *
              <input
                style={{ ...fieldStyle, marginTop: 6 }}
                type="number"
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={(event) => updateForm("amount", event.target.value)}
                placeholder="0.00"
                required
              />
            </label>

            <label style={labelStyle}>
              Expense date *
              <input
                style={{ ...fieldStyle, marginTop: 6 }}
                type="date"
                value={form.expenseDate}
                onChange={(event) =>
                  updateForm("expenseDate", event.target.value)
                }
                required
              />
            </label>

            <label style={labelStyle}>
              Payment method
              <select
                style={{ ...fieldStyle, marginTop: 6 }}
                value={form.paymentMethod}
                onChange={(event) =>
                  updateForm("paymentMethod", event.target.value)
                }
              >
                <option value="">Select payment method</option>
                <option value="cash">Cash</option>
                <option value="mpesa">M-Pesa</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="card">Card</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label style={labelStyle}>
              Description
              <input
                style={{ ...fieldStyle, marginTop: 6 }}
                value={form.description}
                onChange={(event) =>
                  updateForm("description", event.target.value)
                }
                placeholder="What was this expense for?"
              />
            </label>

            <label style={labelStyle}>
              Reference
              <input
                style={{ ...fieldStyle, marginTop: 6 }}
                value={form.reference}
                onChange={(event) => updateForm("reference", event.target.value)}
                maxLength={100}
                placeholder="Receipt or transaction reference"
              />
            </label>
          </div>

          <label style={labelStyle}>
            Notes
            <textarea
              style={{
                ...fieldStyle,
                marginTop: 6,
                minHeight: 90,
                resize: "vertical",
              }}
              value={form.notes}
              onChange={(event) => updateForm("notes", event.target.value)}
              placeholder="Additional information about this expense"
            />
          </label>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="button-primary"
              type="submit"
              disabled={saving || loading}
            >
              {saving ? "Recording expense..." : "Record expense"}
            </button>

            <button
              type="button"
              className="button-secondary"
              onClick={resetForm}
              disabled={saving}
            >
              Clear form
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}

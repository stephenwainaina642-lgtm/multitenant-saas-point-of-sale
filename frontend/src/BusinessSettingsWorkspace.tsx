import { useEffect, useState } from "react";
import { apiRequest } from "./api/client";
import "./BusinessSettingsWorkspace.css";

type BusinessProfile = {
  id: string;
  name: string;
  businessType: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  currency: string;
  timezone: string;
};

const emptyProfile: BusinessProfile = {
  id: "",
  name: "",
  businessType: "retail",
  email: "",
  phone: "",
  address: "",
  currency: "KES",
  timezone: "Africa/Nairobi",
};

const businessTypes = [
  "retail",
  "wholesale",
  "hardware",
  "timber",
  "furniture",
  "building_materials",
  "other",
];

export default function BusinessSettingsWorkspace() {
  const [profile, setProfile] = useState<BusinessProfile>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const isOwner =
    sessionStorage.getItem("pos_business_role")?.toLowerCase() === "owner";

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      const token = sessionStorage.getItem("pos_token");
      const businessId = sessionStorage.getItem("pos_business_id");

      if (!token || !businessId) {
        setError("Your business session is missing. Please sign in again.");
        setLoading(false);
        return;
      }

      try {
        const response = await apiRequest<BusinessProfile>(
          "/businesses/current",
          { token, businessId }
        );

        if (active && response.data) {
          setProfile({
            ...emptyProfile,
            ...response.data,
          });
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load business settings."
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    loadProfile();

    return () => {
      active = false;
    };
  }, []);

  function updateField(
    field: keyof BusinessProfile,
    value: string
  ) {
    setProfile((current) => ({
      ...current,
      [field]: value,
    }));
    setSuccess("");
    setError("");
  }

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const token = sessionStorage.getItem("pos_token");
    const businessId = sessionStorage.getItem("pos_business_id");

    if (!token || !businessId) {
      setError("Your business session is missing. Please sign in again.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await apiRequest<BusinessProfile>(
        "/businesses/current",
        {
          method: "PUT",
          token,
          businessId,
          body: {
            name: profile.name.trim(),
            businessType: profile.businessType.trim(),
            email: profile.email?.trim() || null,
            phone: profile.phone?.trim() || null,
            address: profile.address?.trim() || null,
            currency: profile.currency.trim().toUpperCase(),
            timezone: profile.timezone.trim(),
          },
        }
      );

      if (response.data) {
        setProfile({
          ...emptyProfile,
          ...response.data,
        });
        sessionStorage.setItem("pos_business_name", response.data.name);
      }

      setSuccess("Business settings have been saved.");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save business settings."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="settings-loading">
        Loading business settings...
      </div>
    );
  }

  return (
    <div className="settings-workspace">
      <div className="settings-intro">
        <div>
          <span className="settings-eyebrow">BUSINESS CONFIGURATION</span>
          <h2>Business settings</h2>
          <p>
            Manage the business identity and regional preferences used
            throughout your POS workspace.
          </p>
        </div>
        <div className="settings-access">
          <span className="settings-access-label">ACCESS LEVEL</span>
          <strong>{isOwner ? "Business owner" : "Read only"}</strong>
        </div>
      </div>

      {error && <div className="settings-message settings-error">{error}</div>}
      {success && (
        <div className="settings-message settings-success">{success}</div>
      )}

      <form onSubmit={saveSettings}>
        <section className="settings-section">
          <div className="settings-section-heading">
            <div>
              <h3>Business information</h3>
              <p>Core details associated with this business account.</p>
            </div>
          </div>

          <div className="settings-fields">
            <label className="settings-field">
              <span>Business name</span>
              <input
                value={profile.name}
                onChange={(event) => updateField("name", event.target.value)}
                disabled={!isOwner}
                required
                maxLength={120}
              />
            </label>

            <label className="settings-field">
              <span>Business type</span>
              <select
                value={profile.businessType}
                onChange={(event) =>
                  updateField("businessType", event.target.value)
                }
                disabled={!isOwner}
                required
              >
                {!businessTypes.includes(profile.businessType) && (
                  <option value={profile.businessType}>
                    {profile.businessType}
                  </option>
                )}
                {businessTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ").replace(/\b\w/g, (letter) =>
                      letter.toUpperCase()
                    )}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-field">
              <span>Business email</span>
              <input
                type="email"
                value={profile.email ?? ""}
                onChange={(event) => updateField("email", event.target.value)}
                disabled={!isOwner}
                maxLength={160}
                placeholder="business@example.com"
              />
            </label>

            <label className="settings-field">
              <span>Business phone</span>
              <input
                type="tel"
                value={profile.phone ?? ""}
                onChange={(event) => updateField("phone", event.target.value)}
                disabled={!isOwner}
                maxLength={40}
                placeholder="+254..."
              />
            </label>

            <label className="settings-field settings-field-wide">
              <span>Business address</span>
              <textarea
                value={profile.address ?? ""}
                onChange={(event) => updateField("address", event.target.value)}
                disabled={!isOwner}
                rows={3}
                placeholder="Street, town, county"
              />
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <div>
              <h3>Regional preferences</h3>
              <p>Currency and time zone used for business records.</p>
            </div>
          </div>

          <div className="settings-fields">
            <label className="settings-field">
              <span>Currency code</span>
              <input
                value={profile.currency}
                onChange={(event) => updateField("currency", event.target.value)}
                disabled={!isOwner}
                required
                maxLength={3}
                minLength={3}
                placeholder="KES"
              />
              <small>Use a three-letter currency code, for example KES or USD.</small>
            </label>

            <label className="settings-field">
              <span>Time zone</span>
              <input
                value={profile.timezone}
                onChange={(event) => updateField("timezone", event.target.value)}
                disabled={!isOwner}
                required
                maxLength={80}
                placeholder="Africa/Nairobi"
              />
            </label>
          </div>
        </section>

        {isOwner && (
          <div className="settings-actions">
            <button
              className="settings-save-button"
              type="submit"
              disabled={saving}
            >
              {saving ? "Saving changes..." : "Save changes"}
            </button>
          </div>
        )}

        {!isOwner && (
          <p className="settings-readonly-note">
            Only the business owner can change these settings. Contact your
            business owner if any information needs updating.
          </p>
        )}
      </form>
    </div>
  );
}

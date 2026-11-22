import SettingsForm from "./SettingsForm";
import type { Integration } from "./types";

type P = Omit<Parameters<typeof SettingsForm>[0], "intro">;
export default function PesapalSettings(props: P & { item: Integration }) {
  const ipn = props.item.config.ipnStatus === "registered" ? "Registered" : "Not registered yet";
  return (
    <SettingsForm
      {...props}
      intro={
        <p className="int-intro">
          Use <strong>your own</strong> Pesapal merchant account (API 3.0). IPN status: <strong>{ipn}</strong>. IPN registration and payment notifications come
          in a later step; an IPN message alone will never be treated as proof of payment.
        </p>
      }
    />
  );
}

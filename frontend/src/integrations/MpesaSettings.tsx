import SettingsForm from "./SettingsForm";
import type { Integration } from "./types";

type P = Omit<Parameters<typeof SettingsForm>[0], "intro">;
export default function MpesaSettings(props: P & { item: Integration }) {
  return (
    <SettingsForm
      {...props}
      intro={
        <p className="int-intro">
          Use <strong>your own</strong> Safaricom Daraja app. Money goes straight to your shortcode; nexaPOS never holds it. “Test connection” checks your
          Consumer Key and Secret only. The shortcode and passkey are first proven by a real payment request, and payment callbacks are not part of this step yet.
        </p>
      }
    />
  );
}

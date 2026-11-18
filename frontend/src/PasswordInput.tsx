import { useState } from "react";
import type { InputHTMLAttributes } from "react";

/** A password field with a Show / Hide button, so people can check what they typed. */
export default function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  const { style, ...rest } = props;
  return (
    <span style={{ position: "relative", display: "block" }}>
      <input {...rest} type={visible ? "text" : "password"} style={{ ...style, paddingRight: 64, width: "100%", boxSizing: "border-box" }} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: 0, padding: "4px 6px", font: "inherit", fontSize: 12, fontWeight: 600, color: "#176b4d", cursor: "pointer" }}
      >
        {visible ? "Hide" : "Show"}
      </button>
    </span>
  );
}

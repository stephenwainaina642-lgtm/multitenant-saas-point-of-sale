import { Toaster } from "react-hot-toast";

export default function AppToaster() {
  return (
    <Toaster
      position="top-center"
      gutter={8}
      containerStyle={{ top: 64 }}
      toastOptions={{
        duration: 3500,
        style: { fontSize: 14, maxWidth: 440, padding: "10px 14px", borderRadius: 10, color: "#17301f", border: "1px solid #dfe8e1", boxShadow: "0 6px 24px rgba(10,40,25,.14)" },
        success: { iconTheme: { primary: "#1f7a4d", secondary: "#fff" } },
        error: { iconTheme: { primary: "#c0392b", secondary: "#fff" }, style: { fontSize: 14, maxWidth: 440, padding: "10px 14px", borderRadius: 10, color: "#6b1f17", background: "#fff6f5", border: "1px solid #f1c9c4" } },
      }}
    />
  );
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "404 — Page Not Found",
};

export default function NotFound() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: "var(--space-6)",
      textAlign: "center",
      padding: "var(--space-6)",
    }}>
      <div style={{
        fontFamily: "var(--font-display)",
        fontSize: "8rem",
        fontWeight: 900,
        background: "var(--grad-brand)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
        lineHeight: 1,
      }}>
        404
      </div>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "var(--space-2)" }}>Page not found</h1>
      <p style={{ color: "var(--clr-text-secondary)", maxWidth: 400 }}>
        The page you are looking for does not exist or has been moved.
      </p>
      <a href="/dashboard" className="btn btn-primary" style={{ marginTop: "var(--space-4)" }}>
        Go to Dashboard
      </a>
    </div>
  );
}

"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Application root error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 24, fontFamily: "system-ui, sans-serif", background: "#080b11", color: "#fff" }}>
        <main role="alert" style={{ maxWidth: 560, margin: "10vh auto", textAlign: "center" }}>
          <h1>Something went wrong</h1>
          <p>The application could not continue. Please try again.</p>
          <button type="button" onClick={() => unstable_retry()}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Application route error:", error);
  }, [error]);

  return (
    <main role="alert" style={{ maxWidth: 560, margin: "10vh auto", padding: 24, textAlign: "center" }}>
      <h1>Something went wrong</h1>
      <p>The page could not be loaded. Please try again.</p>
      <button type="button" onClick={() => unstable_retry()}>
        Try again
      </button>
    </main>
  );
}

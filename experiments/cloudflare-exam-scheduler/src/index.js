const CHECK_EXAMS_PATH = "/api/cron/check-exams";

export default {
  async scheduled(_controller, env) {
    await runExpiryCheck(env);
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ ok: true, service: "exam-expiry-scheduler" });
    }

    if (url.pathname !== "/run" || request.method !== "POST") {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    if (!isAuthorized(request, env.CRON_SECRET)) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    return runExpiryCheck(env);
  },
};

function isAuthorized(request, expectedSecret) {
  if (!expectedSecret) return false;
  const supplied = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  return supplied === expectedSecret;
}

async function runExpiryCheck(env) {
  if (!env.APP_BASE_URL || !env.CRON_SECRET) {
    throw new Error("APP_BASE_URL and CRON_SECRET must be configured");
  }

  const response = await fetch(`${env.APP_BASE_URL.replace(/\/$/, "")}${CHECK_EXAMS_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CRON_SECRET}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(55_000),
  });

  const body = await response.text();
  if (!response.ok) {
    console.error("Exam expiry check failed", response.status, body.slice(0, 500));
    throw new Error(`Exam expiry endpoint returned HTTP ${response.status}`);
  }

  console.log("Exam expiry check completed", body.slice(0, 1000));
  return Response.json({ ok: true, status: response.status });
}

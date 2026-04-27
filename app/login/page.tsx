"use client";

import { useEffect, useCallback, useState } from "react";
import { useRouter } from "next/navigation";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || "agridmu_bot";

declare global {
  interface Window {
    onTelegramAuth: (user: Record<string, string>) => void;
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: { user?: { id: number; first_name: string; username?: string } };
        ready: () => void;
        expand: () => void;
      };
    };
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [isDev, setIsDev] = useState(false);
  const [tab, setTab] = useState<"telegram" | "credentials">("telegram");
  const [credUser, setCredUser] = useState("");
  const [credPass, setCredPass] = useState("");
  const [credLoading, setCredLoading] = useState(false);
  const [credError, setCredError] = useState("");
  const [miniAppLoading, setMiniAppLoading] = useState(false);
  const [miniAppError, setMiniAppError] = useState("");

  useEffect(() => { setIsDev(process.env.NODE_ENV === "development"); }, []);

  // If already logged in, go straight to dashboard
  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(d => { if (d.user) router.replace("/dashboard"); })
      .catch(() => {});
  }, [router]);

  // Telegram Mini App auto-login
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (!tg?.initDataUnsafe?.user || !tg.initData) return;

    // Notify the Mini App SDK we are ready
    tg.ready();
    tg.expand();
    setMiniAppLoading(true);

    fetch("/api/auth/telegram-webapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData: tg.initData }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          router.replace("/dashboard");
        } else {
          setMiniAppLoading(false);
          setMiniAppError(d.error || "Mini App auth failed");
        }
      })
      .catch(() => {
        setMiniAppLoading(false);
        setMiniAppError("Network error during Mini App login");
      });
  }, [router]);

  const handleAuth = useCallback(async (user: Record<string, string>) => {
    const params = new URLSearchParams(user);
    try {
      const res = await fetch(`/api/auth/telegram?${params.toString()}`);
      const data = await res.json();
      if (data.ok) {
        router.push("/dashboard");
      } else {
        alert(data.error || "Authentication failed. Please try again.");
      }
    } catch {
      alert("Network error. Please try again.");
    }
  }, [router]);

  useEffect(() => {
    if (tab !== "telegram") return;
    window.onTelegramAuth = handleAuth;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?23";
    script.setAttribute("data-telegram-login", BOT_USERNAME);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "10");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    script.async = true;

    const container = document.getElementById("tg-widget");
    if (container) {
      container.innerHTML = "";
      container.appendChild(script);
    }

    return () => {
      if (container) container.innerHTML = "";
    };
  }, [handleAuth, tab]);

  const handleCredLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCredError("");
    setCredLoading(true);
    try {
      const res = await fetch("/api/auth/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: credUser, password: credPass }),
      });
      const data = await res.json();
      if (data.ok) {
        router.push("/dashboard");
      } else {
        setCredError(data.error || "Invalid credentials");
      }
    } catch {
      setCredError("Network error. Please try again.");
    } finally {
      setCredLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* Animated background */}
      <div className="login-bg">
        <div className="login-orb orb-1" />
        <div className="login-orb orb-2" />
        <div className="login-orb orb-3" />
        <div className="login-grid" />
      </div>

      {/* Card */}
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <div className="logo-mark" style={{ width: 56, height: 56, borderRadius: 14 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div>
            <div className="logo-text" style={{ fontSize: "1.75rem" }}>QuizForge</div>
            <p style={{ color: "var(--clr-text-muted)", fontSize: "0.8rem", marginTop: 2 }}>
              Telegram Quiz Dashboard
            </p>
          </div>
        </div>

        {/* Feature pills */}
        <div className="login-features">
          {[
            { icon: "🎯", label: "Multi-group quiz management" },
            { icon: "📊", label: "Real-time analytics & insights" },
            { icon: "⚡", label: "Instant Telegram delivery" },
            { icon: "👥", label: "Team admin collaboration" },
          ].map((f) => (
            <div key={f.label} className="login-feature">
              <span>{f.icon}</span>
              <span>{f.label}</span>
            </div>
          ))}
        </div>

        <div className="divider" />

        {/* Tab switcher */}
        <div className="login-tabs">
          <button
            className={`login-tab ${tab === "telegram" ? "active" : ""}`}
            onClick={() => setTab("telegram")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
            </svg>
            Telegram
          </button>
          <button
            className={`login-tab ${tab === "credentials" ? "active" : ""}`}
            onClick={() => setTab("credentials")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Instructor Login
          </button>
        </div>

        {/* Telegram Widget or Mini App Loading */}
        {tab === "telegram" && (
          <div style={{ textAlign: "center", marginTop: "var(--space-5)" }}>
            {miniAppLoading ? (
              <div style={{ padding: "var(--space-6)", color: "var(--clr-text-secondary)" }}>
                <div className="spinner" style={{ margin: "0 auto var(--space-4)" }} />
                <p style={{ fontSize: "0.9rem" }}>Authenticating via Telegram…</p>
              </div>
            ) : (
              <>
                {miniAppError && (
                  <div className="alert alert-error" style={{ marginBottom: "var(--space-4)", textAlign: "left" }}>
                    {miniAppError}
                  </div>
                )}
                <p style={{ color: "var(--clr-text-secondary)", marginBottom: "var(--space-5)", fontSize: "0.9rem" }}>
                  Sign in with your Telegram account to continue
                </p>
                <div id="tg-widget" className="tg-widget-container" />
                {isDev && (
                  <a
                    href="/api/auth/dev-redirect"
                    className="btn btn-secondary"
                    style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", marginTop: "var(--space-4)", gap: 8, textDecoration: "none" }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                    Developer Admin Login
                  </a>
                )}
                <p style={{ color: "var(--clr-text-muted)", fontSize: "0.75rem", marginTop: "var(--space-4)" }}>
                  Your identity is verified server-side via HMAC-SHA256 · No password needed
                </p>
              </>
            )}
          </div>
        )}

        {/* Credentials Form */}
        {tab === "credentials" && (
          <form onSubmit={handleCredLogin} style={{ marginTop: "var(--space-5)" }}>
            <p style={{ color: "var(--clr-text-secondary)", marginBottom: "var(--space-5)", fontSize: "0.9rem", textAlign: "center" }}>
              Sign in with your instructor credentials
            </p>

            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                type="text"
                className="form-input"
                placeholder="your.username"
                value={credUser}
                onChange={e => setCredUser(e.target.value)}
                required
                autoComplete="username"
                id="cred-username"
              />
            </div>

            <div className="form-group" style={{ marginTop: "var(--space-4)" }}>
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={credPass}
                onChange={e => setCredPass(e.target.value)}
                required
                autoComplete="current-password"
                id="cred-password"
              />
            </div>

            {credError && (
              <div style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                color: "#f87171",
                padding: "var(--space-3) var(--space-4)",
                borderRadius: "var(--radius-md)",
                fontSize: "0.875rem",
                marginTop: "var(--space-3)",
              }}>
                {credError}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={credLoading}
              style={{ width: "100%", marginTop: "var(--space-5)", justifyContent: "center" }}
              id="cred-login-btn"
            >
              {credLoading ? "Signing in…" : "Sign In"}
            </button>

            <p style={{ color: "var(--clr-text-muted)", fontSize: "0.75rem", marginTop: "var(--space-4)", textAlign: "center" }}>
              Contact your administrator if you don&apos;t have credentials
            </p>
          </form>
        )}
      </div>

      <style>{`
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--space-6);
          position: relative;
        }
        .login-bg {
          position: fixed;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          z-index: 0;
        }
        .login-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          opacity: 0.12;
          animation: float 20s ease-in-out infinite;
        }
        .orb-1 { width:600px;height:600px;background:radial-gradient(circle,#4f7fff,transparent);top:-200px;left:-200px; }
        .orb-2 { width:400px;height:400px;background:radial-gradient(circle,#a78bfa,transparent);bottom:-100px;right:-100px;animation-delay:-7s;animation-direction:reverse; }
        .orb-3 { width:300px;height:300px;background:radial-gradient(circle,#38bdf8,transparent);top:50%;right:20%;animation-delay:-14s; }
        @keyframes float { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-30px) scale(1.05)} }
        .login-grid {
          position:absolute;inset:0;
          background-image:linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px);
          background-size:40px 40px;
        }
        .login-card {
          width:100%;max-width:440px;
          background:rgba(20,25,38,0.9);
          backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
          border:1px solid rgba(255,255,255,0.1);
          border-radius:var(--radius-xl);
          padding:var(--space-10);
          box-shadow:0 24px 64px rgba(0,0,0,0.6),0 0 0 1px rgba(255,255,255,0.04),inset 0 1px 0 rgba(255,255,255,0.06);
          animation:fadeUp 0.5s var(--ease-out) both;
          position:relative;z-index:1;
        }
        .login-logo { display:flex;align-items:center;gap:var(--space-4);margin-bottom:var(--space-8); }
        .login-features { display:flex;flex-direction:column;gap:var(--space-2);margin-bottom:var(--space-6); }
        .login-feature {
          display:flex;align-items:center;gap:var(--space-3);
          font-size:0.875rem;color:var(--clr-text-secondary);
          padding:var(--space-2) var(--space-3);border-radius:var(--radius-md);
          transition:background var(--duration-fast);
        }
        .login-feature:hover { background:rgba(255,255,255,0.04); }
        .tg-widget-container { display:flex;justify-content:center;min-height:50px;align-items:center; }

        .login-tabs {
          display:flex;gap:var(--space-2);
          background:rgba(255,255,255,0.04);
          border-radius:var(--radius-md);
          padding:4px;
          margin-top:var(--space-5);
        }
        .login-tab {
          flex:1;display:flex;align-items:center;justify-content:center;gap:6px;
          padding:var(--space-2) var(--space-3);
          border-radius:calc(var(--radius-md) - 2px);
          border:none;background:transparent;
          color:var(--clr-text-muted);font-size:0.875rem;
          cursor:pointer;transition:all var(--duration-fast);font-weight:500;
        }
        .login-tab.active {
          background:rgba(255,255,255,0.1);
          color:var(--clr-text-primary);
          box-shadow:0 1px 3px rgba(0,0,0,0.3);
        }
        .login-tab:hover:not(.active) { color:var(--clr-text-secondary); }
      `}</style>
    </div>
  );
}

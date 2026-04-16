"use client";

import { useEffect, useCallback, useState } from "react";
import { useRouter } from "next/navigation";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || "agridmu_bot";

declare global {
  interface Window {
    onTelegramAuth: (user: Record<string, string>) => void;
  }
}

export default function LoginPage() {
  const router = useRouter();
  // Resolved client-side only to avoid SSR/Client hydration mismatch
  const [isDev, setIsDev] = useState(false);
  useEffect(() => { setIsDev(process.env.NODE_ENV === "development"); }, []);

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

  // Unused now — kept for reference. Login uses the anchor href approach instead.
  const handleDevLogin = useCallback(() => {}, []);

  useEffect(() => {
    window.onTelegramAuth = handleAuth;

    // Inject the Telegram widget script
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
  }, [handleAuth]);

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

        {/* CTA */}
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "var(--clr-text-secondary)", marginBottom: "var(--space-5)", fontSize: "0.9rem" }}>
            Sign in with your Telegram account to continue
          </p>

          {/* Telegram Widget */}
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
        </div>
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
        .orb-1 {
          width: 600px; height: 600px;
          background: radial-gradient(circle, #4f7fff, transparent);
          top: -200px; left: -200px;
        }
        .orb-2 {
          width: 400px; height: 400px;
          background: radial-gradient(circle, #a78bfa, transparent);
          bottom: -100px; right: -100px;
          animation-delay: -7s;
          animation-direction: reverse;
        }
        .orb-3 {
          width: 300px; height: 300px;
          background: radial-gradient(circle, #38bdf8, transparent);
          top: 50%; right: 20%;
          animation-delay: -14s;
        }
        @keyframes float {
          0%, 100% { transform: translateY(0) scale(1); }
          50%       { transform: translateY(-30px) scale(1.05); }
        }
        .login-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
          background-size: 40px 40px;
        }
        .login-card {
          width: 100%;
          max-width: 440px;
          background: rgba(20, 25, 38, 0.9);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: var(--radius-xl);
          padding: var(--space-10);
          box-shadow:
            0 24px 64px rgba(0,0,0,0.6),
            0 0 0 1px rgba(255,255,255,0.04),
            inset 0 1px 0 rgba(255,255,255,0.06);
          animation: fadeUp 0.5s var(--ease-out) both;
          position: relative;
          z-index: 1;
        }
        .login-logo {
          display: flex;
          align-items: center;
          gap: var(--space-4);
          margin-bottom: var(--space-8);
        }
        .login-features {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          margin-bottom: var(--space-6);
        }
        .login-feature {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          font-size: 0.875rem;
          color: var(--clr-text-secondary);
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md);
          transition: background var(--duration-fast);
        }
        .login-feature:hover {
          background: rgba(255,255,255,0.04);
        }
        .tg-widget-container {
          display: flex;
          justify-content: center;
          min-height: 50px;
          align-items: center;
        }
      `}</style>
    </div>
  );
}

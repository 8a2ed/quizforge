"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextValue {
  show: (params: { type: ToastType; title: string; message?: string; duration?: number }) => string;
  success: (title: string, message?: string, duration?: number) => string;
  error: (title: string, message?: string, duration?: number) => string;
  warning: (title: string, message?: string, duration?: number) => string;
  info: (title: string, message?: string, duration?: number) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idCounter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    ({ type, title, message, duration = 5000 }: { type: ToastType; title: string; message?: string; duration?: number }) => {
      const id = `toast-${++idCounter.current}-${Date.now()}`;
      setToasts((prev) => {
        // Limit to max 5 visible toasts, newest at top
        const next = [{ id, type, title, message, duration }, ...prev];
        return next.slice(0, 5);
      });
      return id;
    },
    []
  );

  const success = useCallback((title: string, message?: string, duration?: number) => show({ type: "success", title, message, duration }), [show]);
  const error = useCallback((title: string, message?: string, duration?: number) => show({ type: "error", title, message, duration }), [show]);
  const warning = useCallback((title: string, message?: string, duration?: number) => show({ type: "warning", title, message, duration }), [show]);
  const info = useCallback((title: string, message?: string, duration?: number) => show({ type: "info", title, message, duration }), [show]);

  return (
    <ToastContext.Provider value={{ show, success, error, warning, info, dismiss }}>
      {children}
      <div
        className="toast-stack-portal"
        role="log"
        aria-live="polite"
        aria-label="Notifications"
        style={{
          position: "fixed",
          top: "16px",
          right: "16px",
          zIndex: 10000,
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          width: "calc(100% - 32px)",
          maxWidth: "360px",
          pointerEvents: "none",
        }}
      >
        {toasts.map((toast) => (
          <ToastCardItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCardItem({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const duration = toast.duration || 5000;
  const [remaining, setRemaining] = useState(duration);
  const [paused, setPaused] = useState(false);
  const startTimeRef = useRef(Date.now());
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (paused) return;
    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onDismiss();
    }, remaining);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [paused, remaining, onDismiss]);

  const handleMouseEnter = () => {
    setPaused(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    const elapsed = Date.now() - startTimeRef.current;
    setRemaining((prev) => Math.max(0, prev - elapsed));
  };

  const handleMouseLeave = () => {
    setPaused(false);
  };

  const colorMap: Record<ToastType, string> = {
    success: "#00ff88",
    error: "#ff6b6b",
    warning: "#ffc700",
    info: "#00c4ff",
  };
  const accentColor = colorMap[toast.type];

  return (
    <div
      role="status"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "14px 16px 16px 14px",
        background: "rgba(22, 22, 22, 0.95)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: "10px",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 8px rgba(0, 0, 0, 0.2)",
        pointerEvents: "auto",
        overflow: "hidden",
        animation: "toastSlideIn 350ms cubic-bezier(0.21, 1.02, 0.73, 1) forwards",
      }}
    >
      {/* Icon */}
      <div style={{ color: accentColor, flexShrink: 0, marginTop: "1px", width: "18px", height: "18px" }}>
        {toast.type === "success" && (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
        )}
        {toast.type === "error" && (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
        )}
        {toast.type === "warning" && (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
        )}
        {toast.type === "info" && (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "#ffffff", marginBottom: "3px" }}>{toast.title}</div>
        {toast.message && <div style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.45 }}>{toast.message}</div>}
      </div>

      {/* Close button */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        style={{
          flexShrink: 0,
          background: "transparent",
          border: "none",
          color: "#64748b",
          cursor: "pointer",
          padding: "2px",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>

      {/* Progress Bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "2px",
          background: "rgba(255, 255, 255, 0.06)",
        }}
      >
        <div
          style={{
            height: "100%",
            background: accentColor,
            width: "100%",
            transformOrigin: "left",
            animation: paused ? "none" : `toastProgressShrink ${duration}ms linear forwards`,
          }}
        />
      </div>

      <style jsx>{`
        @keyframes toastSlideIn {
          from {
            opacity: 0;
            transform: translateX(100%) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
        }
        @keyframes toastProgressShrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
}

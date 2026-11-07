"use client";

import React, { useEffect, useRef } from "react";
import { useModal, UseModalOptions } from "@/lib/useModal";

export interface AccessibleModalProps extends UseModalOptions {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: number | string;
}

export function AccessibleModal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 440,
  closeOnBackdrop = true,
  closeOnEscape = true,
}: AccessibleModalProps) {
  const {
    open,
    openModal,
    closeModal,
    dialogRef,
    handleKeyDown,
    handleOverlayPointerDown,
  } = useModal({
    closeOnBackdrop,
    closeOnEscape,
    onClose,
  });

  // Sync external isOpen prop with internal useModal hook
  useEffect(() => {
    if (isOpen && !open) openModal();
    if (!isOpen && open) closeModal();
  }, [isOpen, open, openModal, closeModal]);

  if (!isOpen && !open) return null;

  const titleId = `modal-title-${Math.random().toString(36).substr(2, 9)}`;
  const descId = description ? `modal-desc-${Math.random().toString(36).substr(2, 9)}` : undefined;

  return (
    <div
      className="accessible-modal-overlay"
      onPointerDown={handleOverlayPointerDown}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        padding: "24px 16px",
        animation: "modalFadeIn 180ms ease-out forwards",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="accessible-modal-dialog"
        style={{
          width: "100%",
          maxWidth: typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth,
          maxHeight: "calc(100vh - 48px)",
          display: "flex",
          flexDirection: "column",
          background: "rgba(22, 22, 26, 0.98)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          borderRadius: "16px",
          boxShadow: "0 24px 70px rgba(0, 0, 0, 0.55)",
          padding: "24px",
          overflow: "hidden",
          animation: "modalScaleIn 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "16px",
          }}
        >
          <h2
            id={titleId}
            style={{
              fontSize: "1.15rem",
              fontWeight: 700,
              color: "#ffffff",
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="modal-close-button"
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              border: "none",
              background: "transparent",
              color: "#94a3b8",
              fontSize: "20px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s ease",
            }}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div
          id={descId}
          style={{
            flex: 1,
            overflowY: "auto",
            color: "#94a3b8",
            fontSize: "0.9rem",
            lineHeight: 1.55,
            paddingRight: "4px",
          }}
        >
          {description && <p style={{ marginBottom: "16px", color: "#cbd5e1" }}>{description}</p>}
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div
            style={{
              marginTop: "24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: "12px",
            }}
          >
            {footer}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes modalFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modalScaleIn {
          from {
            opacity: 0;
            transform: scale(0.97) translateY(8px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        .modal-close-button:hover {
          background: rgba(239, 68, 68, 0.15) !important;
          color: #ef4444 !important;
        }
        .modal-close-button:focus-visible {
          outline: 2px solid #00c4ff !important;
          outline-offset: 2px !important;
        }
      `}</style>
    </div>
  );
}

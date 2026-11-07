/**
 * useModal — lightweight React hook for accessible modal state management.
 * Handles scroll lock with ref-counting so nested modals don't unlock early.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Shared scroll-lock ref counter (module-level, not per-instance) ───────────
let _lockCount = 0;
let _savedOverflow = "";
let _savedPaddingRight = "";

function lockScroll() {
  if (_lockCount === 0) {
    _savedOverflow = document.documentElement.style.overflow;
    _savedPaddingRight = document.documentElement.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.documentElement.style.paddingRight = `${scrollbarWidth}px`;
    }
  }
  _lockCount++;
}

function unlockScroll() {
  _lockCount = Math.max(0, _lockCount - 1);
  if (_lockCount === 0) {
    document.documentElement.style.overflow = _savedOverflow;
    document.documentElement.style.paddingRight = _savedPaddingRight;
  }
}

// ── Global open-stack for Escape key (topmost closes first) ──────────────────
const _openStack: Array<() => void> = [];

function pushCloseHandler(fn: () => void) {
  _openStack.push(fn);
}
function popCloseHandler(fn: () => void) {
  const idx = _openStack.lastIndexOf(fn);
  if (idx !== -1) _openStack.splice(idx, 1);
}

// ── Escape key listener (single global, lazy init) ───────────────────────────
let _escListenerAdded = false;
function ensureEscListener() {
  if (_escListenerAdded) return;
  _escListenerAdded = true;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _openStack.length > 0) {
      e.preventDefault();
      _openStack[_openStack.length - 1]();
    }
  });
}

// ── Focus trap helpers ─────────────────────────────────────────────────────────
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest("[hidden]") && el.offsetParent !== null
  );
}

export interface UseModalOptions {
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}

export function useModal(opts: UseModalOptions = {}) {
  const { closeOnEscape = true, closeOnBackdrop = true, onOpen, onClose } = opts;
  const [open, setOpen] = useState(false);
  const returnFocusRef = useRef<Element | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<() => void>(() => {});

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  // Keep closeRef fresh so escape handler always has latest
  useEffect(() => { closeRef.current = close; }, [close]);

  // On open/close: scroll lock + focus management + escape stack
  useEffect(() => {
    if (open) {
      ensureEscListener();
      lockScroll();
      returnFocusRef.current = document.activeElement;
      onOpen?.();
      const handler = () => { if (closeOnEscape) closeRef.current(); };
      pushCloseHandler(handler);

      // Move focus into dialog after paint
      const raf = requestAnimationFrame(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const autofocus = dialog.querySelector<HTMLElement>("[autofocus]");
        const first = autofocus ?? getFocusable(dialog)[0] ?? dialog;
        if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
        (first as HTMLElement).focus({ preventScroll: true });
      });

      return () => {
        cancelAnimationFrame(raf);
        popCloseHandler(handler);
        unlockScroll();
        onClose?.();
        const target = returnFocusRef.current;
        if (target && "focus" in target) {
          requestAnimationFrame(() => (target as HTMLElement).focus({ preventScroll: true }));
        }
      };
    }
  }, [open, closeOnEscape, onOpen, onClose]);

  // Focus trap handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = getFocusable(dialog);
      if (focusable.length === 0) { e.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    []
  );

  // Backdrop click (pointerdown on overlay, NOT children)
  const handleOverlayPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (closeOnBackdrop && e.target === e.currentTarget) {
        close();
      }
    },
    [closeOnBackdrop, close]
  );

  return {
    open,
    openModal: () => setOpen(true),
    closeModal: close,
    dialogRef,
    handleKeyDown,
    handleOverlayPointerDown,
  };
}

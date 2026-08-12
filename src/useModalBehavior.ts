/**
 * Shared modal behavior: focus trap + Escape + scroll lock + background inert.
 *
 * Used by every modal dialog in the app (SlotPicker, self-pick setup,
 * custom-value dialog) so `aria-modal="true"` matches real interaction:
 * - focuses the first enabled control on open
 * - Tab / Shift+Tab cycle inside the dialog
 * - Escape closes (caller decides the close action)
 * - restores focus to the trigger element on close
 * - locks body scroll while open
 * - marks sibling content inert so screen readers and Tab cannot escape
 */
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

export function useModalBehavior(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusFirst = () => {
      const focusable = dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      focusable?.focus();
    };
    const animationFrame = window.requestAnimationFrame(focusFirst);

    // Body scroll lock (restore on cleanup).
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Background inert: the backdrop's siblings become inert for the duration.
    const backdrop = dialog.closest(".dialog-backdrop");
    const inertTargets: HTMLElement[] = [];
    if (backdrop?.parentElement) {
      for (const sibling of backdrop.parentElement.children) {
        if (sibling !== backdrop) {
          const element = sibling as HTMLElement;
          if (!element.inert) {
            element.inert = true;
            inertTargets.push(element);
          }
        }
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      for (const target of inertTargets) target.inert = false;
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
      previousFocusRef.current = null;
    };
  }, [open, dialogRef]);
}

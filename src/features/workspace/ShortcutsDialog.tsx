"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { easeOut } from "@/components/motion";

const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ["Run", "Ctrl ↵"],
  ["Run tests", "Ctrl Shift ↵"],
  ["Cancel run", "Esc"],
  ["Play / pause", "Space"],
  ["Step forward / back", "Alt → / Alt ←"],
  ["First / last step", "Alt Home / Alt End"],
  ["Search files", "Ctrl K"],
  ["Toggle bottom panel", "Ctrl `"],
  ["Toggle sidebar", "Ctrl B"],
  ["Show shortcuts", "?"],
];

/** Keyboard shortcut reference. Centered modal; scales in from 0.96, Escape closes. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-black/25 p-4 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={easeOut(0.22)}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-[0_0_0_1px_var(--border),0_30px_60px_-20px_var(--shadow-color)] outline-none"
          >
            <div className="flex items-center justify-between">
              <h2 id="shortcuts-title" className="text-[16px] font-semibold text-ink">
                Keyboard shortcuts
              </h2>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="press grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>
            <dl className="mt-4 divide-y divide-border">
              {SHORTCUTS.map(([action, keys]) => (
                <div key={action} className="flex items-center justify-between py-2.5 text-[13px]">
                  <dt className="text-text">{action}</dt>
                  <dd>
                    <kbd className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[12px] text-muted shadow-[inset_0_-1px_0_var(--border)]">
                      {keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

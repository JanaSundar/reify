"use client";

import { motion } from "motion/react";
import { useEffect, useRef } from "react";

interface InlineConfirmProps {
  readonly message: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * An in-place confirmation strip. Used instead of `window.confirm`, which some browsers and
 * embedded webviews suppress (the dialog never shows and the action silently fails).
 * Focuses the confirm button; Escape cancels.
 */
export function InlineConfirm({ message, confirmLabel, onConfirm, onCancel }: InlineConfirmProps) {
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => confirm.current?.focus(), []);
  return (
    <motion.div
      role="alertdialog"
      aria-label={message}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
      className="rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] shadow-[inset_0_0_0_1px_var(--border)]"
    >
      <p className="text-text">{message}</p>
      <div className="mt-2 flex gap-1.5">
        <button
          ref={confirm}
          type="button"
          onClick={onConfirm}
          className="press rounded-md bg-ink px-2.5 py-1 text-[12px] font-medium text-bg"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="press rounded-md px-2.5 py-1 text-[12px] text-muted hover:bg-surface-3 hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}

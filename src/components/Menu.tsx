"use client";

import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";
import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { easeOut } from "@/components/motion";

export interface MenuItem {
  readonly label: string;
  readonly icon?: ReactNode;
  readonly hint?: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

type MenuEntry = MenuItem | "separator";

/** Arrow keys move between the enabled items of an open menu. */
const moveFocus = (event: React.KeyboardEvent, list: HTMLElement | null): void => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const buttons = [...(list?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
};

const PANEL_CLASS =
  "z-50 min-w-48 rounded-xl bg-surface p-1 shadow-[0_0_0_1px_var(--border),0_16px_36px_-12px_var(--shadow-color)]";

/** The rows of a menu; `onSelect` runs after an item's own action (to close the menu). */
function MenuRows({ items, onDone }: { items: readonly MenuEntry[]; onDone: () => void }) {
  return items.map((item, index) =>
    item === "separator" ? (
      <div key={index} role="separator" className="my-1 h-px bg-border" />
    ) : (
      <button
        key={item.label}
        type="button"
        role="menuitem"
        disabled={item.disabled}
        onClick={() => {
          onDone();
          item.onSelect();
        }}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] outline-none transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 disabled:opacity-40 ${
          item.danger ? "text-danger" : "text-text"
        }`}
      >
        {item.icon && <span className="text-muted">{item.icon}</span>}
        <span className="flex-1">{item.label}</span>
        {item.hint && <kbd className="text-[11px] text-faint">{item.hint}</kbd>}
      </button>
    ),
  );
}

interface MenuProps {
  /** The trigger button; the menu adds its ARIA attributes and click handler. */
  readonly trigger: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
  readonly items: readonly (MenuItem | "separator")[];
  readonly align?: "start" | "end";
  readonly side?: "bottom" | "top";
  readonly label: string;
}

/**
 * A small dropdown menu. It scales in from its trigger's corner (150ms, ease-out), closes
 * on outside click, Escape or selection, and supports arrow-key navigation.
 */
export function Menu({ trigger, items, align = "start", side = "bottom", label }: MenuProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    list.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      return;
    }
    moveFocus(event, list.current);
  };

  const origin = `${side === "bottom" ? "top" : "bottom"} ${align === "start" ? "left" : "right"}`;

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      {cloneElement(trigger, {
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": id,
        onClick: () => setOpen((value) => !value),
      })}
      <AnimatePresence>
        {open && (
          <motion.div
            ref={list}
            id={id}
            role="menu"
            aria-label={label}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
            transition={easeOut(0.15)}
            style={{ transformOrigin: origin }}
            className={`absolute ${PANEL_CLASS} ${
              side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5"
            } ${align === "start" ? "left-0" : "right-0"}`}
          >
            <MenuRows items={items} onDone={() => setOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface ContextMenuProps {
  /** Where the pointer was; null keeps the menu closed. */
  readonly at: { readonly x: number; readonly y: number } | null;
  readonly items: readonly MenuEntry[];
  readonly label: string;
  readonly onClose: () => void;
}

/**
 * A menu opened at the pointer (right click). Same look as {@link Menu}; closes on outside
 * click, Escape, scroll, resize or selection, and keeps itself inside the viewport.
 */
export function ContextMenu({ at, items, label, onClose }: ContextMenuProps) {
  const list = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!at) return;
    const onPointer = (event: PointerEvent) => {
      if (!list.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    list.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [at, onClose]);

  // Measured after layout so a menu near the right or bottom edge opens inward.
  useEffect(() => {
    const panel = list.current;
    if (!at || !panel) return;
    const { width, height } = panel.getBoundingClientRect();
    setOffset({
      x: Math.min(0, window.innerWidth - 8 - (at.x + width)),
      y: Math.min(0, window.innerHeight - 8 - (at.y + height)),
    });
  }, [at]);

  // Portalled to the body: a toolbar ancestor may clip or mask its descendants.
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {at && (
        <motion.div
          ref={list}
          role="menu"
          aria-label={label}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.1 } }}
          transition={easeOut(0.15)}
          style={{ left: at.x + offset.x, top: at.y + offset.y, transformOrigin: "top left" }}
          className={`fixed ${PANEL_CLASS}`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onClose();
              return;
            }
            moveFocus(event, list.current);
          }}
        >
          <MenuRows items={items} onDone={onClose} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

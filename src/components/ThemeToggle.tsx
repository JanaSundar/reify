"use client";

import { Moon, Sun } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useSyncExternalStore } from "react";
import { applyTheme, readTheme, subscribeTheme, type Theme } from "./theme";
import { easeOut } from "@/components/motion";

/** Null on the server: the theme is only known in the browser. */
const useTheme = (): Theme | null => useSyncExternalStore(subscribeTheme, readTheme, () => null);

/** Light/dark switch: shows the current theme and flips to the other; the icon rotates in. */
export function ThemeToggle() {
  const theme = useTheme();
  const next: Theme = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Moon : Sun;
  return (
    <button
      type="button"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => applyTheme(next)}
      className="press grid size-9 place-items-center overflow-hidden rounded-full text-muted transition-colors hover:text-ink"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {theme && (
          <motion.span
            key={theme}
            initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
            transition={easeOut(0.22)}
            className="grid place-items-center"
          >
            <Icon size={17} strokeWidth={1.8} />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

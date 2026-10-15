"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useSyncExternalStore } from "react";
import { applyTheme, readTheme, subscribeTheme, type ThemePreference } from "./theme";

const NEXT: Record<ThemePreference, ThemePreference> = {
  system: "light",
  light: "dark",
  dark: "system",
};
const ICON = { light: Sun, dark: Moon, system: Monitor } as const;
const LABEL = { light: "Light theme", dark: "Dark theme", system: "System theme" } as const;

const useTheme = (): ThemePreference =>
  useSyncExternalStore(subscribeTheme, readTheme, () => "system");

/** Theme control: one icon button cycling light → dark → system; the icon rotates in. */
export function ThemeToggle() {
  const theme = useTheme();

  const Icon = ICON[theme];
  return (
    <button
      type="button"
      aria-label={`${LABEL[theme]} (switch theme)`}
      title={LABEL[theme]}
      onClick={() => applyTheme(NEXT[theme])}
      className="press grid size-9 place-items-center overflow-hidden rounded-full text-muted transition-colors hover:text-ink"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={theme}
          initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
          className="grid place-items-center"
        >
          <Icon size={17} strokeWidth={1.8} />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

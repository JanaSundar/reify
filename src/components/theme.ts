/** Theme preference: "system" follows the OS; the others pin `data-theme` on <html>. */
export type ThemePreference = "light" | "dark" | "system";

export const THEME_KEY = "reify:theme";
const CHANGE_EVENT = "reify:theme-change";

/** Inline script for <head>: applies the stored theme before first paint (no flash). */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export const readTheme = (): ThemePreference => {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
};

export const applyTheme = (theme: ThemePreference): void => {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

export const subscribeTheme = (listener: () => void): (() => void) => {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
};

/** The theme actually shown, resolving "system" against the OS preference. */
export const resolvedTheme = (theme: ThemePreference): "light" | "dark" =>
  theme !== "system"
    ? theme
    : window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";

/**
 * Theme: light or dark. Until the visitor picks one, the OS preference decides (and keeps
 * following it); once they toggle, the choice is saved and pins `data-theme` on <html>.
 */
export type Theme = "light" | "dark";

export const THEME_KEY = "reify:theme";
const CHANGE_EVENT = "reify:theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Inline script for <head>: applies a saved theme before first paint (no flash). */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

const savedTheme = (): Theme | null => {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
};

/** The theme currently shown: the saved choice, else the OS preference. */
export const readTheme = (): Theme =>
  savedTheme() ?? (window.matchMedia(DARK_QUERY).matches ? "dark" : "light");

export const applyTheme = (theme: Theme): void => {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

export const subscribeTheme = (listener: () => void): (() => void) => {
  const media = window.matchMedia(DARK_QUERY);
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  media.addEventListener("change", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
    media.removeEventListener("change", listener);
  };
};

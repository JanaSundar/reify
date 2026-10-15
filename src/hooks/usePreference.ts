"use client";

import { useSyncExternalStore } from "react";

const CHANGE_EVENT = "reify:preference-change";

const subscribe = (listener: () => void): (() => void) => {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
};

/** Values set this session; keeps preferences working when storage is unavailable. */
const session = new Map<string, string>();

const readRaw = (key: string): string | null => {
  const local = session.get(key);
  if (local !== undefined) return local;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * A UI preference remembered per browser (speed, last tab, panel state). Server rendering
 * and hydration use `initial`; the stored value applies right after, so markup never
 * mismatches. Invalid or unavailable storage falls back to `initial`.
 */
export function usePreference<T extends string | number | boolean>(
  key: string,
  initial: T,
  isValid: (value: unknown) => value is T = (value): value is T => typeof value === typeof initial,
): readonly [T, (value: T) => void] {
  const storageKey = `reify:pref:${key}`;
  // The raw string is the snapshot (stable between reads); it's parsed below.
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(storageKey),
    () => null,
  );
  let value = initial;
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isValid(parsed)) value = parsed;
    } catch {
      // Corrupt entry: keep the default.
    }
  }
  const update = (next: T) => {
    const text = JSON.stringify(next);
    session.set(storageKey, text);
    try {
      localStorage.setItem(storageKey, text);
    } catch {
      // Not remembered across visits; it still applies for this session.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
  return [value, update] as const;
}

/** Validator for a string union preference. */
export const oneOf =
  <T extends string>(options: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === "string" && (options as readonly string[]).includes(value);

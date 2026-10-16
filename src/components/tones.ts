/**
 * Surfaces shared by everything that draws data: a background plus a matching hairline
 * edge. `violet` marks what the current step touched, `blue` is a resting value cell.
 */
export const TONE = {
  neutral: "bg-surface-2 edge",
  blue: "bg-[var(--blue-cell)] edge-blue",
  violet: "bg-violet-soft edge-violet",
  changed: "bg-changed edge-violet",
} as const;

export type Tone = keyof typeof TONE;

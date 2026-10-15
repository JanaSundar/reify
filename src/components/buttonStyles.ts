/** Shared button styles, usable from server and client components. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-ink text-bg hover:bg-ink/85",
  secondary: "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--border-strong)] hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  danger: "bg-danger text-white hover:opacity-90",
};

export const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[13px] gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-12 px-6 text-[15px] gap-2.5",
};

const BASE = "inline-flex shrink-0 items-center justify-center rounded-lg font-medium";

export const buttonBase = (variant: ButtonVariant, size: ButtonSize): string =>
  `${BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]}`;

/** Class names for links styled as buttons (plain anchors keep prefetching and SEO). */
export const buttonClass = (
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
): string =>
  `${buttonBase(variant, size)} transition-[background-color,transform] active:scale-[0.97]`;

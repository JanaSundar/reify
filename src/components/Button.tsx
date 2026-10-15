"use client";

import { motion, type HTMLMotionProps } from "motion/react";
import { forwardRef } from "react";
import { buttonBase, type ButtonSize, type ButtonVariant } from "./buttonStyles";

export interface ButtonProps extends HTMLMotionProps<"button"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

/** The one button: flat fill, soft radius, a small press response (Motion `whileTap`). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className = "", type = "button", ...props },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type={type}
      whileTap={{ scale: 0.97 }}
      className={`${buttonBase(variant, size)} transition-colors disabled:pointer-events-none disabled:opacity-45 ${className}`}
      {...props}
    />
  );
});

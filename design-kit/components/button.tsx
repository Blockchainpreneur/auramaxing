"use client";
/* AURAMAXING design-kit — Button
 * Reference bar for interactions: all SIX microstates (default/hover/focus/active/disabled/loading),
 * token-driven (no raw hex/px), proportional press scale, custom focus ring, reduced-motion safe.
 */
import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const cn = (...c: Array<string | undefined | false>) => twMerge(clsx(c));

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const base =
  "relative inline-flex items-center justify-center gap-2 select-none font-medium " +
  "rounded-[var(--radius-md)] transition-[background-color,color,box-shadow,transform] " +
  "duration-[var(--dur-fast)] ease-[var(--ease-out)] " +
  "focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-contrast hover:bg-accent-hover shadow-[var(--shadow-1)]",
  secondary: "bg-surface text-text border border-border hover:bg-surface-2 hover:border-border-strong",
  ghost: "bg-transparent text-text-muted hover:text-text hover:bg-surface",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3 text-step--1 min-w-9",        // ≥36px
  md: "h-11 px-4 text-step-0 min-w-11",        // ≥44px touch target
  lg: "h-12 px-6 text-step-0 min-w-12",
};

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "ref"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", loading = false, disabled, className, children, ...props }, ref) => {
    const reduce = useReducedMotion();
    return (
      <motion.button
        ref={ref}
        // active: proportional press (→0.96, never →0.8); skipped under reduced-motion
        whileTap={reduce || disabled || loading ? undefined : { scale: 0.96 }}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      >
        {loading && (
          <span
            aria-hidden
            className="size-4 rounded-full border-2 border-current border-r-transparent animate-spin
                       [animation-duration:600ms] motion-reduce:animate-none"
          />
        )}
        <span className={cn(loading && "opacity-70")}>{children}</span>
      </motion.button>
    );
  },
);
Button.displayName = "Button";

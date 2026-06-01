"use client";
/* AURAMAXING design-kit — CinematicHero
 * Reference bar for heroes: shader-gradient background (paper shaders) + kinetic staggered
 * headline (Motion) + grain atmosphere. Token-driven, dark-first, reduced-motion safe.
 * Swap MeshGradient for an R3F scene when a true 3D hero earns its place (lazy-load below fold).
 */
import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { MeshGradient } from "@paper-design/shaders-react";
import { Button } from "./button";

interface CinematicHeroProps {
  eyebrow?: string;
  title: string;          // split into words for kinetic reveal
  subtitle?: string;
  ctaLabel?: string;
  onCta?: () => void;
}

const ease = [0.16, 1, 0.3, 1] as const;

export function CinematicHero({
  eyebrow = "AURAMAXING",
  title,
  subtitle,
  ctaLabel = "Get started",
  onCta,
}: CinematicHeroProps) {
  const reduce = useReducedMotion();
  const words = title.split(" ");

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.08, delayChildren: 0.1 } },
  };
  const word = {
    hidden: { y: reduce ? 0 : "0.9em", opacity: 0 },
    show: { y: 0, opacity: 1, transition: { duration: 0.7, ease } },
  };

  return (
    <section className="grain relative isolate flex min-h-[88svh] items-center overflow-hidden bg-bg">
      {/* shader-gradient atmosphere (transform/opacity-cheap; static fallback under reduced-motion) */}
      <div aria-hidden className="absolute inset-0 -z-10 opacity-70">
        <MeshGradient
          style={{ width: "100%", height: "100%" }}
          colors={["#0b0b0f", "#1a1430", "#0b0b0f", "oklch(0.88 0.21 125)"]}
          speed={reduce ? 0 : 0.3}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent" />
      </div>

      <div className="mx-auto w-full max-w-5xl px-6">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="flex flex-col items-start gap-6"
        >
          <motion.span
            variants={word}
            className="font-mono text-step--1 uppercase tracking-[0.2em] text-accent"
          >
            {eyebrow}
          </motion.span>

          <h1 className="text-step-5 font-display font-semibold leading-[1.02] tracking-[-0.03em] text-text">
            <span className="sr-only">{title}</span>
            <span aria-hidden className="flex flex-wrap gap-x-[0.3em]">
              {words.map((w, i) => (
                <span key={i} className="overflow-hidden py-[0.05em]">
                  <motion.span variants={word} className="inline-block">
                    {w}
                  </motion.span>
                </span>
              ))}
            </span>
          </h1>

          {subtitle && (
            <motion.p variants={word} className="max-w-[60ch] text-step-1 text-text-muted">
              {subtitle}
            </motion.p>
          )}

          <motion.div variants={word} className="mt-2">
            <Button size="lg" onClick={onCta}>
              {ctaLabel}
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

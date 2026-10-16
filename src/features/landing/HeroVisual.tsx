"use client";

import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import { easeOut } from "@/components/motion";
import { MarkShape } from "@/components/Mark";

/** The mark plus room on its left for the step trail (viewBox units). */
const VIEWBOX = "-28 7 114 96";

/** Fainter copies stepping back behind the front mark: each one is a past step. */
const TRAIL = [
  { x: -36, opacity: 0.1 },
  { x: -24, opacity: 0.22 },
  { x: -12, opacity: 0.45 },
] as const;

/**
 * The hero's mark: faint copies slide out behind it as a trail of steps, then the solid
 * mark settles in front. A slow float keeps it alive.
 */
export function HeroVisual() {
  const reduce = useReducedMotion();
  const id = useId();
  const maskId = `${id}-mark-mask`;
  const glassId = `${id}-glass`;
  const glintId = `${id}-glint`;
  return (
    <div className="relative aspect-[114/96] w-full max-w-[460px] select-none" aria-hidden>
      <div className="haze absolute -inset-10 opacity-90" />
      <div className="animate-float absolute inset-0">
        <svg viewBox={VIEWBOX} className="absolute inset-0 h-full w-full overflow-visible">
          {TRAIL.map((step, index) => (
            <motion.g
              key={step.x}
              style={{ color: "var(--ink)" }}
              initial={reduce ? false : { x: 0, opacity: 0 }}
              animate={{ x: step.x, opacity: step.opacity }}
              transition={easeOut(1, 0.5 + index * 0.12)}
            >
              <MarkShape />
            </motion.g>
          ))}
          <defs>
            {/* Glass: a soft bevel highlight lit from the top left, merged over the body. */}
            <filter
              id={glassId}
              x="-15%"
              y="-15%"
              width="130%"
              height="130%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur in="SourceAlpha" stdDeviation="2.4" result="blur" />
              <feSpecularLighting
                in="blur"
                surfaceScale="5"
                specularConstant="1"
                specularExponent="26"
                lightingColor="#ffffff"
                result="spec"
              >
                <feDistantLight azimuth="235" elevation="48" />
              </feSpecularLighting>
              <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn" />
              <feMerge>
                <feMergeNode in="SourceGraphic" />
                <feMergeNode in="specIn" />
              </feMerge>
            </filter>
            <linearGradient id={glintId} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.5" stopColor="var(--glint)" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <mask id={maskId} maskUnits="userSpaceOnUse" x="-28" y="7" width="114" height="96">
              <g style={{ color: "#fff" }}>
                <MarkShape />
              </g>
            </mask>
          </defs>
          {/* The front mark is solid, with a soft glass bevel highlight; only the trail is see-through. */}
          <motion.g
            style={{ color: "var(--ink)" }}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={easeOut(0.9, 0.2)}
          >
            <g filter={`url(#${glassId})`}>
              <MarkShape />
            </g>
          </motion.g>
          {/* A thin reflection glides across the glass and back. */}
          {!reduce && (
            <g mask={`url(#${maskId})`}>
              <g transform="skewX(-20)">
                <motion.rect
                  y={0}
                  width={12}
                  height={110}
                  fill={`url(#${glintId})`}
                  initial={{ x: -20 }}
                  animate={{ x: [-20, 130] }}
                  transition={{
                    duration: 1.8,
                    ease: [0.45, 0, 0.55, 1],
                    delay: 1.6,
                    repeat: Infinity,
                    repeatType: "reverse",
                    repeatDelay: 1.4,
                  }}
                />
              </g>
            </g>
          )}
        </svg>
      </div>
      <motion.p
        className="absolute -right-2 -bottom-[14%] rotate-[-9deg] font-hand text-[30px] leading-none text-muted"
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={easeOut(0.8, 1.6)}
      >
        Code,
        <br />
        <span className="ml-6">made visible.</span>
      </motion.p>
    </div>
  );
}

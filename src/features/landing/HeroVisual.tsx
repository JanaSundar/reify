"use client";

import { motion, useReducedMotion } from "motion/react";

const R_PATH =
  "M582.58 380.96A54.50 54.50 0 0 1 637.08 435.46L637.08 469.21A51.88 51.88 0 0 1 585.19 521.10L585.18 521.10L661.58 610.90A4.60 4.60 0 0 1 658.07 618.48L606.18 618.48A34.60 34.60 0 0 1 579.83 606.30L509.42 523.53A7.50 7.50 0 0 0 496.20 528.39L496.20 605.80L471.30 589.11A11.70 11.70 0 0 1 466.12 579.39L466.12 386.96A6.00 6.00 0 0 1 472.12 380.96L582.58 380.96Z";
const VIEWBOX = "456 370 216 260";
const EASE = [0.23, 1, 0.32, 1] as const;

/** Back-to-front translucent layers behind the solid R (offset, depth, opacity). */
const LAYERS = [
  { x: -150, z: -120, opacity: 0.32 },
  { x: -112, z: -90, opacity: 0.42 },
  { x: -74, z: -60, opacity: 0.55 },
  { x: -37, z: -30, opacity: 0.7 },
] as const;

function Glyph({ id, outline = false }: { id: string; outline?: boolean }) {
  return (
    <svg viewBox={VIEWBOX} className="absolute inset-0 h-full w-full overflow-visible">
      <defs>
        <linearGradient
          id={`${id}-fill`}
          x1="470"
          y1="380"
          x2="660"
          y2="620"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#f6f2ff" stopOpacity="0.95" />
          <stop offset="0.4" stopColor="#c7b5ff" stopOpacity="0.9" />
          <stop offset="0.75" stopColor="#8fa8ff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#efbfe4" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <path
        d={R_PATH}
        fill={outline ? "none" : `url(#${id}-fill)`}
        stroke="#ffffff"
        strokeOpacity={outline ? 0.9 : 0.7}
        strokeWidth={outline ? 1.4 : 1}
        strokeLinejoin="round"
        pathLength={1}
      />
    </svg>
  );
}

/**
 * The hero's R: translucent layers slide in from the left and settle in 3D, the front
 * glyph's outline draws itself, then a light sweep and a slow float keep it alive.
 */
export function HeroVisual() {
  const reduce = useReducedMotion();
  return (
    <div className="relative aspect-[5/6] w-full max-w-[460px] select-none" aria-hidden>
      <div className="haze absolute -inset-10 opacity-90" />
      {/* Static glow under the glyph (a filter on the moving glyph would repaint every frame). */}
      <div className="absolute inset-x-[20%] top-[30%] bottom-[5%] rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--violet)_30%,transparent),transparent)]" />
      <div className="animate-float absolute inset-0 [perspective:1400px]">
        <motion.div
          className="absolute inset-[6%_4%_6%_22%] [transform-style:preserve-3d]"
          initial={reduce ? false : { rotateY: -48, rotateX: 14 }}
          animate={{ rotateY: -26, rotateX: 8 }}
          transition={{ duration: 1.4, ease: EASE, delay: 0.2 }}
        >
          {LAYERS.map((layer, index) => (
            <motion.div
              key={index}
              className="absolute inset-0"
              style={{ opacity: layer.opacity }}
              initial={reduce ? false : { x: layer.x - 120, z: layer.z, opacity: 0 }}
              animate={{ x: layer.x, z: layer.z, opacity: layer.opacity }}
              transition={{ duration: 1.1, ease: EASE, delay: 0.35 + index * 0.08 }}
            >
              <Glyph id={`hero-layer-${index}`} />
            </motion.div>
          ))}
          <motion.div
            className="absolute inset-0"
            initial={reduce ? false : { opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, ease: EASE, delay: 0.75 }}
          >
            <Glyph id="hero-front" />
            <div className="light-sweep [mask-image:url('/reify-r-mask.svg')] [mask-size:100%_100%]" />
          </motion.div>
          {/* The outline draws itself once, on top of the front glyph. */}
          <svg viewBox={VIEWBOX} className="absolute inset-0 h-full w-full overflow-visible">
            <motion.path
              d={R_PATH}
              fill="none"
              stroke="#ffffff"
              strokeWidth={1.6}
              strokeLinejoin="round"
              initial={reduce ? false : { pathLength: 0, opacity: 1 }}
              animate={{ pathLength: 1, opacity: 0.85 }}
              transition={{ duration: 1.8, ease: [0.77, 0, 0.175, 1], delay: 0.5 }}
            />
          </svg>
        </motion.div>
      </div>
      <motion.p
        className="absolute -right-2 bottom-[2%] rotate-[-9deg] font-hand text-[30px] leading-none text-muted"
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: EASE, delay: 1.6 }}
      >
        Code,
        <br />
        <span className="ml-6">made visible.</span>
      </motion.p>
    </div>
  );
}

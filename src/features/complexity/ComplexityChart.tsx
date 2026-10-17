"use client";

import { motion } from "motion/react";
import { useState } from "react";
import {
  formatComplexity,
  growth,
  type EmpiricalEstimate,
  type Sample,
} from "@/engine/core/analysis/complexity";
import { compact, niceMax } from "./chartScale";

const WIDTH = 360;
const HEIGHT = 200;
const PAD = { left: 48, right: 12, top: 12, bottom: 32 };
const CURVE_SAMPLES = 48;

/**
 * Operations against input size: one series (measured cases) plus the fitted curve as a
 * neutral reference. Hover a point for its exact values; the test list is the table view.
 */
export function ComplexityChart({
  estimate,
}: {
  estimate: Extract<EmpiricalEstimate, { kind: "estimate" }>;
}) {
  const [hovered, setHovered] = useState<Sample | null>(null);
  const { points } = estimate;
  const maxN = niceMax(Math.max(...points.map((p) => p.n)));
  const maxSteps = niceMax(Math.max(...points.map((p) => p.steps)) * 1.05);
  const x = (n: number) => PAD.left + (n / maxN) * (WIDTH - PAD.left - PAD.right);
  const y = (steps: number) =>
    HEIGHT - PAD.bottom - (steps / maxSteps) * (HEIGHT - PAD.top - PAD.bottom);

  const curve = Array.from({ length: CURVE_SAMPLES + 1 }, (_, i) => {
    const n = (maxN * i) / CURVE_SAMPLES;
    const steps = Math.min(
      maxSteps * 1.2,
      Math.max(0, estimate.intercept + estimate.scale * growth(estimate.complexity, n)),
    );
    return `${i === 0 ? "M" : "L"}${x(n).toFixed(1)},${y(steps).toFixed(1)}`;
  }).join(" ");
  const ticks = [0, 0.5, 1];

  return (
    <figure className="relative max-w-[420px]">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full overflow-visible"
        role="img"
        aria-label={`Operations grow like ${formatComplexity(estimate.complexity)} across ${points.length} input sizes`}
      >
        <defs>
          <clipPath id="plot-area">
            <rect
              x={PAD.left}
              y={PAD.top}
              width={WIDTH - PAD.left - PAD.right}
              height={HEIGHT - PAD.top - PAD.bottom}
            />
          </clipPath>
        </defs>
        {ticks.map((t) => (
          <g key={t} className="text-[10px]" fill="var(--faint)">
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(maxSteps * t)}
              y2={y(maxSteps * t)}
              stroke="var(--surface-3)"
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={y(maxSteps * t) + 3} textAnchor="end">
              {compact(maxSteps * t)}
            </text>
            <text x={x(maxN * t)} y={HEIGHT - PAD.bottom + 16} textAnchor="middle">
              {compact(maxN * t)}
            </text>
          </g>
        ))}
        <text
          x={WIDTH - PAD.right}
          y={HEIGHT - 2}
          textAnchor="end"
          className="text-[10px]"
          fill="var(--muted)"
        >
          input size n
        </text>
        <motion.path
          d={curve}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={2}
          strokeDasharray="5 4"
          clipPath="url(#plot-area)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.15 }}
        />
        {points.map((p) => (
          <g
            key={p.n}
            onMouseEnter={() => setHovered(p)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(p)}
            onBlur={() => setHovered(null)}
            tabIndex={0}
          >
            <circle cx={x(p.n)} cy={y(p.steps)} r={14} fill="transparent" />
            <motion.circle
              cx={x(p.n)}
              cy={y(p.steps)}
              initial={{ r: 0 }}
              animate={{ r: hovered === p ? 6.5 : 5 }}
              fill="var(--accent)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          </g>
        ))}
      </svg>
      {hovered && (
        <div
          role="status"
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-md bg-ink px-2 py-1 shadow-float text-xs whitespace-nowrap text-bg"
          style={{
            left: `${(x(hovered.n) / WIDTH) * 100}%`,
            top: `${(y(hovered.steps) / HEIGHT) * 100 - 4}%`,
          }}
        >
          n = {hovered.n.toLocaleString("en-US")} ·{" "}
          {Math.round(hovered.steps).toLocaleString("en-US")} operations
        </div>
      )}
      <figcaption className="mt-2 flex items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-accent" /> measured cases
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0 w-4 border-t-2 border-dashed border-muted" />{" "}
          {formatComplexity(estimate.complexity)} fit
        </span>
      </figcaption>
    </figure>
  );
}

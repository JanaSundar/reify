"use client";

import { motion } from "motion/react";
import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { compact, niceMax } from "./chartScale";
import type { GrowthModel } from "./growthModel";

const WIDTH = 420;
const HEIGHT = 210;
const PAD = { left: 48, right: 76, top: 12, bottom: 32 };
const LABEL_GAP = 12;
const SERIES_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)"] as const;

/** End-label heights pushed apart so neighbouring labels never overlap. */
const spreadLabels = (ys: readonly number[]): number[] => {
  const order = ys.map((y, i) => ({ y, i })).toSorted((a, b) => a.y - b.y);
  const placed: number[] = [];
  for (const { y } of order) placed.push(Math.max(y, (placed.at(-1) ?? -Infinity) + LABEL_GAP));
  const out = Array.from<number>({ length: ys.length });
  order.forEach(({ i }, k) => (out[i] = placed[k]!));
  return out;
};

/**
 * How each part of the program grows with the input (every size taken as n): one line per
 * part, the dominant ones decide the overall complexity. A crosshair reads all lines at once.
 */
export function GrowthChart({ model }: { model: GrowthModel }) {
  const { sizes, series } = model;
  const [index, setIndex] = useState<number | null>(null);
  const maxN = sizes.at(-1)!;
  const maxY = niceMax(Math.max(...series.flatMap((s) => s.values)) * 1.05);
  const x = (n: number) => PAD.left + ((n - 1) / (maxN - 1)) * (WIDTH - PAD.left - PAD.right);
  const y = (v: number) =>
    HEIGHT - PAD.bottom - (Math.min(v, maxY) / maxY) * (HEIGHT - PAD.top - PAD.bottom);
  const path = (values: readonly number[]) =>
    values
      .map((v, i) => `${i === 0 ? "M" : "L"}${x(sizes[i]!).toFixed(1)},${y(v).toFixed(1)}`)
      .join(" ");
  const ends = spreadLabels(series.map((s) => y(s.values.at(-1)!)));
  const ticks = [0, 0.5, 1];

  const pick = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const plotX = ((event.clientX - box.left) / box.width) * (WIDTH - PAD.left - PAD.right);
    const step = (WIDTH - PAD.left - PAD.right) / (maxN - 1);
    setIndex(Math.max(0, Math.min(sizes.length - 1, Math.round(plotX / step))));
  };
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    setIndex((i) => Math.max(0, Math.min(sizes.length - 1, (i ?? sizes.length - 1) + delta)));
  };

  return (
    <figure className="relative mt-4 max-w-[480px]">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full overflow-visible outline-none"
        role="img"
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setIndex(null)}
        aria-label={`Growth of each part with input size n: ${series
          .map((s) => `${s.label} from ${s.source}`)
          .join("; ")}`}
      >
        {ticks.map((t) => (
          <g key={t} className="text-[10px]" fill="var(--faint)">
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(maxY * t)}
              y2={y(maxY * t)}
              stroke="var(--surface-3)"
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={y(maxY * t) + 3} textAnchor="end">
              {compact(maxY * t)}
            </text>
          </g>
        ))}
        {[1, Math.round((maxN + 1) / 2), maxN].map((n) => (
          <text
            key={n}
            x={x(n)}
            y={HEIGHT - PAD.bottom + 16}
            textAnchor="middle"
            className="text-[10px]"
            fill="var(--faint)"
          >
            {n}
          </text>
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
        {series.map((s, i) => (
          <g key={s.label} opacity={s.dominant ? 1 : 0.6}>
            <motion.path
              d={path(s.values)}
              fill="none"
              stroke={SERIES_COLORS[i]}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1], delay: i * 0.08 }}
            />
            <text
              x={WIDTH - PAD.right + 6}
              y={ends[i]! + 3}
              className="font-mono text-[10px]"
              fill="var(--text)"
            >
              {s.label}
            </text>
          </g>
        ))}
        {index !== null && (
          <g pointerEvents="none">
            <line
              x1={x(sizes[index]!)}
              x2={x(sizes[index]!)}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
            {series.map((s, i) => (
              <circle
                key={s.label}
                cx={x(sizes[index]!)}
                cy={y(s.values[index]!)}
                r={4}
                fill={SERIES_COLORS[i]}
                stroke="var(--surface)"
                strokeWidth={2}
              />
            ))}
          </g>
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={WIDTH - PAD.left - PAD.right}
          height={HEIGHT - PAD.top - PAD.bottom}
          fill="transparent"
          onPointerMove={pick}
          onPointerLeave={() => setIndex(null)}
        />
      </svg>
      {index !== null && (
        <div
          role="status"
          className="pointer-events-none absolute rounded-md bg-ink px-2.5 py-1.5 text-xs whitespace-nowrap text-bg shadow-float"
          // Beside the crosshair, inside the plot; flipped to its left past the middle.
          style={{
            left: `${(x(sizes[index]!) / WIDTH) * 100}%`,
            top: `${(PAD.top / HEIGHT) * 100}%`,
            transform:
              index > sizes.length / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
          }}
        >
          <p className="opacity-70">n = {sizes[index]}</p>
          {series.map((s, i) => (
            <p key={s.label} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-0.5 w-3 rounded"
                style={{ background: SERIES_COLORS[i] }}
              />
              <span className="font-semibold tabular-nums">
                {Math.round(s.values[index]!).toLocaleString("en-US")}
              </span>
              <span className="font-mono opacity-70">{s.label}</span>
            </p>
          ))}
        </div>
      )}
      <figcaption className="mt-2 space-y-1 text-xs text-muted">
        {series.map((s, i) => (
          <p key={s.label} className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="h-0.5 w-4 shrink-0 rounded"
              style={{ background: SERIES_COLORS[i] }}
            />
            <span className="shrink-0 font-mono text-text">{s.label}</span>
            <span className="truncate font-mono">{s.source}</span>
            {s.dominant && (
              <span className="shrink-0 rounded-full bg-surface-3 px-1.5 text-[10px] uppercase tracking-wide">
                dominant
              </span>
            )}
          </p>
        ))}
        {model.hidden > 0 && (
          <p>
            {model.hidden} slower-growing {model.hidden === 1 ? "part" : "parts"} not shown.
          </p>
        )}
        <p className="text-faint">
          Operations with every input size set to n, constant factors dropped.
        </p>
      </figcaption>
    </figure>
  );
}

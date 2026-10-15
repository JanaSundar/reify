"use client";

import {
  estimateComplexity,
  formatComplexity,
  sameClass,
  type StaticComplexity,
} from "@/engine/core/analysis/complexity";
import type { TestResult } from "@/engine/core/protocol/testing";
import type { TraceMetrics } from "@/engine/core/trace/TraceStore";
import { samplesOf } from "@/features/tests/suite";
import { ComplexityChart } from "./ComplexityChart";

interface ComplexityPanelProps {
  readonly analysis: StaticComplexity | null;
  readonly operations: number | null;
  readonly metrics: TraceMetrics | null;
  readonly testResults: readonly TestResult[];
  readonly onOpenTests: () => void;
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-medium tabular-nums">{value}</dd>
    </div>
  );
}

const CONFIDENCE_TEXT = {
  high: "high confidence",
  medium: "medium confidence",
  low: "low confidence",
} as const;

/** Static estimate from the code, measured growth from test runs, and last-run counts. */
export function ComplexityPanel({
  analysis,
  operations,
  metrics,
  testResults,
  onOpenTests,
}: ComplexityPanelProps) {
  const estimate = estimateComplexity(samplesOf(testResults));
  const agrees =
    analysis && estimate.kind === "estimate" ? sameClass(analysis.time, estimate.complexity) : null;

  return (
    <div className="flex flex-col gap-6 p-4">
      <section aria-labelledby="static-heading">
        <h3 id="static-heading" className="text-sm font-medium text-muted">
          From the code
        </h3>
        {analysis ? (
          <>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">
              {formatComplexity(analysis.time)}
            </p>
            <ul className="mt-2 space-y-1 text-sm text-text">
              {analysis.notes.length === 0 && (
                <li>No loops or recursion that depend on the input.</li>
              )}
              {analysis.notes.map((note) => (
                <li key={note}>{note.replaceAll("`", "")}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">
              An estimate from the shape of the code, assuming each loop runs over the input.
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">Run your code to estimate its time complexity.</p>
        )}
      </section>

      <section aria-labelledby="measured-heading">
        <h3 id="measured-heading" className="text-sm font-medium text-muted">
          Measured from tests
        </h3>
        {estimate.kind === "estimate" ? (
          <>
            <p className="mt-1 flex items-baseline gap-3">
              <span className="text-3xl font-semibold tracking-tight text-ink">
                {formatComplexity(estimate.complexity)}
              </span>
              <span className="text-sm text-muted">{CONFIDENCE_TEXT[estimate.confidence]}</span>
            </p>
            {agrees !== null && (
              <p className={`mt-1 text-sm ${agrees ? "text-success" : "text-warning"}`}>
                {agrees
                  ? "Matches the estimate from the code."
                  : "Differs from the estimate from the code: inputs may not exercise the worst case."}
              </p>
            )}
            <div className="mt-4">
              <ComplexityChart estimate={estimate} />
            </div>
          </>
        ) : (
          <div className="mt-1 text-sm text-text">
            <p>
              {testResults.length === 0
                ? "Run your test cases to measure how the work grows."
                : estimate.reason}
            </p>
            <button
              type="button"
              onClick={onOpenTests}
              className="mt-2 text-accent underline-offset-4 hover:underline"
            >
              Open tests
            </button>
          </div>
        )}
      </section>

      {operations !== null && metrics && (
        <section aria-labelledby="last-run-heading">
          <h3 id="last-run-heading" className="text-sm font-medium text-muted">
            Last traced run
          </h3>
          <dl className="mt-2 grid grid-cols-3 gap-1.5">
            <Figure label="Operations" value={operations.toLocaleString("en-US")} />
            <Figure label="Deepest stack" value={String(metrics.maxDepth)} />
            <Figure label="Objects" value={metrics.objects.toLocaleString("en-US")} />
          </dl>
          <p className="mt-2 text-xs text-muted">
            Operations count executed statements, loop checks and calls. Stack depth and objects
            indicate space.
          </p>
        </section>
      )}
    </div>
  );
}

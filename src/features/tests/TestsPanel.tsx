"use client";

import { Download, Footprints, Play, Plus, Trash2, Upload } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { Button } from "@/components/Button";
import { InlineConfirm } from "@/components/InlineConfirm";
import { Segmented } from "@/components/Segmented";
import type {
  TestCase,
  TestResult,
  TestStatus,
  TestSuite,
  TestTarget,
} from "@/engine/core/protocol/testing";
import { downloadText } from "@/lib/download";
import { addCase, removeCase, summarize, updateCase } from "./suite";
import { MAX_SUITE_FILE_CHARS, parseSuiteFile, suiteTemplate } from "./suiteFile";

interface TestsPanelProps {
  readonly suite: TestSuite;
  readonly functionNames: readonly string[];
  readonly results: readonly TestResult[];
  readonly running: boolean;
  /** When set, running is unavailable and this says why. */
  readonly blockedReason?: string | null;
  readonly onChange: (suite: TestSuite) => void;
  readonly onRun: () => void;
  readonly onTrace: (testCase: TestCase) => void;
}

const STATUS_STYLE: Record<TestStatus, { label: string; className: string }> = {
  pass: { label: "Passed", className: "bg-success/12 text-success" },
  fail: { label: "Failed", className: "bg-danger/12 text-danger" },
  error: { label: "Error", className: "bg-danger/12 text-danger" },
  limit: { label: "Stopped", className: "bg-warning/14 text-warning" },
};

const TARGETS: ReadonlyArray<{ value: TestTarget; label: string }> = [
  { value: "return", label: "Return value" },
  { value: "first-argument", label: "First argument" },
];

const codeInput =
  "w-full min-w-0 rounded-md bg-surface px-2.5 py-1.5 font-mono text-[13px] text-text outline-none ring-1 ring-transparent transition-shadow placeholder:text-faint focus:ring-accent/60";

function CaseRow({
  testCase,
  index,
  result,
  onChange,
  onRemove,
  onTrace,
}: {
  testCase: TestCase;
  index: number;
  result: TestResult | undefined;
  onChange: (patch: Partial<Omit<TestCase, "id">>) => void;
  onRemove: () => void;
  onTrace: () => void;
}) {
  const status = result ? STATUS_STYLE[result.status] : null;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
      className="rounded-xl bg-surface-2 p-3"
    >
      <div className="flex items-center justify-between gap-2 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium">Case {index + 1}</span>
          <AnimatePresence mode="wait">
            {status && (
              <motion.span
                key={result?.status}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.className}`}
              >
                {status.label}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="flex items-center">
          <Button variant="ghost" size="sm" onClick={onTrace} title="Trace this case step by step">
            <Footprints size={14} /> Trace
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            aria-label={`Remove case ${index + 1}`}
            className="w-7 px-0"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
        <label htmlFor={`${testCase.id}-args`} className="text-xs text-muted">
          Arguments
        </label>
        <input
          id={`${testCase.id}-args`}
          value={testCase.args}
          placeholder="[2, 7, 11, 15], 9"
          spellCheck={false}
          onChange={(event) => onChange({ args: event.target.value })}
          className={codeInput}
        />
        <label htmlFor={`${testCase.id}-expected`} className="text-xs text-muted">
          Expected
        </label>
        <input
          id={`${testCase.id}-expected`}
          value={testCase.expected}
          placeholder="[0, 1]"
          spellCheck={false}
          onChange={(event) => onChange({ expected: event.target.value })}
          className={codeInput}
        />
      </div>
      <AnimatePresence initial={false}>
        {result && (
          <motion.div
            key={result.status + result.steps}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-0.5 pt-2 text-xs">
              {result.status === "fail" && (
                <p className="text-danger">
                  Got <code className="font-mono">{result.actual}</code>, expected{" "}
                  <code className="font-mono">{result.expected}</code>
                </p>
              )}
              {result.message && (
                <p className={result.status === "limit" ? "text-warning" : "text-danger"}>
                  {result.message}
                </p>
              )}
              {(result.status === "pass" || result.status === "fail") && (
                <p className="text-muted tabular-nums">
                  {result.steps.toLocaleString("en-US")} operations · n = {result.inputSize ?? "?"}{" "}
                  · stack depth {result.maxDepth}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

/** Test cases for one function: edit, run all, or trace any single case. */
export function TestsPanel({
  suite,
  functionNames,
  results,
  running,
  blockedReason,
  onChange,
  onRun,
  onTrace,
}: TestsPanelProps) {
  const summary = summarize(results);
  const resultFor = (id: string) => results.find((r) => r.caseId === id);
  const names =
    functionNames.includes(suite.entry) || !suite.entry
      ? functionNames
      : [suite.entry, ...functionNames];
  const progress = summary.total === 0 ? 0 : summary.passed / summary.total;

  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** A parsed upload waiting for the user to confirm replacing their existing cases. */
  const [pending, setPending] = useState<TestSuite | null>(null);

  const readFile = async (file: File) => {
    setUploadError(null);
    setPending(null);
    if (file.size > MAX_SUITE_FILE_CHARS * 4) {
      setUploadError("That file is too large for a test suite.");
      return;
    }
    const parsed = parseSuiteFile(await file.text());
    if (!parsed.ok) setUploadError(parsed.error);
    else if (suite.cases.length > 0) setPending(parsed.suite);
    else onChange(parsed.suite);
  };

  const downloadTemplate = () =>
    downloadText(
      "reify-tests-template.json",
      suiteTemplate(suite.entry || functionNames[0] || ""),
      "application/json",
    );

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Function
          <select
            value={suite.entry}
            onChange={(event) => onChange({ ...suite, entry: event.target.value })}
            className="h-8 min-w-36 rounded-lg bg-surface-2 px-2 font-mono text-[13px] text-text"
          >
            {names.length === 0 && <option value="">No functions found</option>}
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1.5 text-xs text-muted">
          Compare
          <Segmented
            label="What to compare"
            size="sm"
            value={suite.target}
            options={TARGETS}
            onChange={(target) => onChange({ ...suite, target })}
          />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="Upload a test suite JSON file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void readFile(file);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInput.current?.click()}
            title="Load test cases from a JSON file"
          >
            <Upload size={14} /> Upload JSON
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={downloadTemplate}
            title="Download a starter JSON file to edit and upload"
          >
            <Download size={14} /> Template
          </Button>
        </div>
      </div>

      {uploadError && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
          {uploadError}
        </p>
      )}
      {pending && (
        <InlineConfirm
          message={`Replace your ${suite.cases.length} ${suite.cases.length === 1 ? "case" : "cases"} with the ${pending.cases.length} from the file?`}
          confirmLabel="Replace"
          onConfirm={() => {
            onChange(pending);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}

      <AnimatePresence initial={false}>
        {results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div role="status" className="flex items-center gap-3 text-[13px] font-medium">
              <span className={summary.failed === 0 ? "text-success" : "text-danger"}>
                {summary.passed} of {summary.total} passed
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                <motion.span
                  className={`block h-full rounded-full ${summary.failed === 0 ? "bg-success" : "bg-danger"}`}
                  initial={false}
                  animate={{ width: `${progress * 100}%` }}
                />
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ol className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {suite.cases.map((testCase, index) => (
            <CaseRow
              key={testCase.id}
              testCase={testCase}
              index={index}
              result={resultFor(testCase.id)}
              onChange={(patch) => onChange(updateCase(suite, testCase.id, patch))}
              onRemove={() => onChange(removeCase(suite, testCase.id))}
              onTrace={() => onTrace(testCase)}
            />
          ))}
        </AnimatePresence>
      </ol>

      <motion.div layout className="flex items-center gap-2">
        <Button onClick={() => onChange(addCase(suite))}>
          <Plus size={15} /> Add case
        </Button>
        <Button
          variant="primary"
          onClick={onRun}
          disabled={running || suite.cases.length === 0 || !suite.entry || Boolean(blockedReason)}
          title={blockedReason ?? undefined}
        >
          <Play size={13} fill="currentColor" /> Run tests
        </Button>
        <kbd className="ml-auto text-[11px] text-faint">Ctrl ⇧ ↵</kbd>
      </motion.div>
      <p className="text-xs leading-relaxed text-muted">
        Arguments and expected values are JavaScript expressions and may use helpers from your code.
        Each case runs in a fresh copy of your program. Give cases different input sizes to measure
        complexity.
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { Diagnostic } from "@/engine/core/protocol/program";
import { LANGUAGES } from "@/engine/languages/catalog";
import { ConsolePanel } from "@/features/console/ConsolePanel";
import { CodeEditor, type EditorDiagnostic } from "@/features/editor/CodeEditor";
import type { ExecutionMark } from "@/features/editor/executionLine";
import { StepFacts } from "@/features/explain/StepFacts";
import { VariablesPanel } from "@/features/inspector/VariablesPanel";
import { CallStack } from "@/features/stack/CallStack";
import { Timeline } from "@/features/timeline/Timeline";
import {
  useExecutionContext,
  useExecutionSession,
  useExecutionStatus,
  useTraceSnapshot,
} from "@/hooks/useExecutionSession";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { ExecutionStatus } from "@/machine/executionMachine";
import { loadDraft, saveDraft } from "./draft";
import { bannerFor, RunBanner } from "./RunBanner";

const STATUS_TEXT: Record<ExecutionStatus, string> = {
  idle: "Ready",
  running: "Running…",
  cancelling: "Cancelling…",
  completed: "Finished",
  failed: "Failed",
  cancelled: "Cancelled",
};

const SAVE_DELAY_MS = 400;

function PanelTitle({ children, aside }: { children: string; aside?: React.ReactNode }) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
      <h2 className="text-xs font-medium tracking-wide text-muted uppercase">{children}</h2>
      {aside}
    </div>
  );
}

export default function Workspace() {
  const { store, actor } = useExecutionSession();
  const trace = useTraceSnapshot(store);
  const status = useExecutionStatus(actor);
  const context = useExecutionContext(actor);
  const wide = useMediaQuery("(min-width: 900px)");

  const [draft] = useState(loadDraft);
  const [languageId, setLanguageId] = useState(draft.languageId);
  const source = useRef(draft.source);
  /** Debounced copy of the editor text: drives persistence and "changed since run". */
  const [settledSource, setSettledSource] = useState(draft.source);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const busy = status === "running" || status === "cancelling";
  const view = trace.view;

  const run = () => actor.send({ type: "RUN", source: source.current, languageId });
  const cancel = (): boolean => {
    if (status !== "running") return false;
    actor.send({ type: "CANCEL" });
    return true;
  };

  const onChange = (value: string) => {
    source.current = value;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSettledSource(value);
      saveDraft({ languageId, source: value });
    }, SAVE_DELAY_MS);
  };

  const changeLanguage = (id: string) => {
    setLanguageId(id);
    saveDraft({ languageId: id, source: source.current });
  };

  // Global shortcuts: run, cancel and step through history from anywhere on the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The editor handles its own shortcuts and marks them as handled.
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && actor.getSnapshot().matches({ active: "running" })) {
        actor.send({ type: "CANCEL" });
      } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        actor.send({ type: "RUN", source: source.current, languageId });
      } else if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        store.stepBy(1);
      } else if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        store.stepBy(-1);
      } else if (event.altKey && event.key === "Home") {
        store.seek(0);
      } else if (event.altKey && event.key === "End") {
        store.seek(Number.MAX_SAFE_INTEGER);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actor, store, languageId]);

  const execution = useMemo<ExecutionMark | null>(
    () =>
      view?.loc
        ? {
            line: view.loc.line,
            endLine: view.loc.role === "call" ? view.loc.line : view.loc.endLine,
            kind: view.kind === "call" ? "call" : "statement",
          }
        : null,
    [view],
  );

  const diagnostics = useMemo<EditorDiagnostic[]>(() => {
    const fromCompile: readonly Diagnostic[] =
      context.failure?.kind === "compile" ? context.failure.diagnostics : [];
    const warnings = trace.program?.warnings ?? [];
    const thrown: EditorDiagnostic[] = [];
    if (trace.outcome?.kind === "exception" && trace.outcome.loc !== null) {
      const loc = trace.program?.locs[trace.outcome.loc];
      if (loc)
        thrown.push({
          severity: "error",
          message: `Uncaught ${trace.outcome.message}`,
          range: loc,
        });
    }
    return [...fromCompile, ...warnings, ...thrown];
  }, [context.failure, trace.program, trace.outcome]);

  const sourceChanged = trace.status !== "empty" && settledSource !== trace.source;
  const banner = bannerFor(context.failure, trace.outcome, trace.program, sourceChanged);

  const editorPane = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <CodeEditor
          initialValue={draft.source}
          typescript={languageId === "typescript"}
          execution={execution}
          diagnostics={diagnostics}
          onChange={onChange}
          onRun={run}
          onCancel={cancel}
        />
      </div>
      <Timeline store={store} position={trace.position} total={trace.totalSteps} />
    </div>
  );

  const inspectorPane = (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <RunBanner message={banner} />
      <PanelTitle
        aside={
          view && (
            <span className="font-mono text-xs text-faint">
              {view.loc ? `line ${view.loc.line}` : "start"}
            </span>
          )
        }
      >
        This step
      </PanelTitle>
      <div className="max-h-[35%] shrink-0 overflow-y-auto px-3 py-2">
        {view ? <StepFacts view={view} /> : <EmptyState status={status} />}
      </div>
      <PanelTitle aside={view && <CallStack view={view} />}>Variables</PanelTitle>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {view && <VariablesPanel view={view} />}
      </div>
    </div>
  );

  const consolePane = (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <PanelTitle>Console</PanelTitle>
      <div className="min-h-0 flex-1 overflow-auto">
        <ConsolePanel
          lines={trace.console}
          visibleCount={view?.consoleCount ?? trace.console.length}
        />
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Link href="/" className="mr-2 font-semibold tracking-tight">
          LearnCode
        </Link>
        <select
          aria-label="Language"
          value={languageId}
          onChange={(event) => changeLanguage(event.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
        >
          {LANGUAGES.map((language) => (
            <option key={language.id} value={language.id}>
              {language.label}
            </option>
          ))}
        </select>
        {busy ? (
          <button
            type="button"
            onClick={cancel}
            disabled={status === "cancelling"}
            className="press rounded-md bg-danger px-3 py-1 text-sm font-medium text-white disabled:opacity-60"
          >
            Cancel <kbd className="ml-1 text-xs opacity-75">Esc</kbd>
          </button>
        ) : (
          <button
            type="button"
            onClick={run}
            className="press rounded-md bg-accent px-3 py-1 text-sm font-medium text-accent-fg hover:bg-accent-strong"
          >
            Run <kbd className="ml-1 text-xs opacity-75">Ctrl ↵</kbd>
          </button>
        )}
        <button
          type="button"
          onClick={() => actor.send({ type: "RESET" })}
          disabled={status === "idle"}
          className="press rounded-md border border-border px-3 py-1 text-sm text-muted hover:text-text disabled:opacity-40"
        >
          Reset
        </button>
        <p role="status" aria-live="polite" className="ml-auto truncate text-xs text-muted">
          {STATUS_TEXT[status]}
          {busy &&
            context.phase === "executing" &&
            ` · ${context.steps.toLocaleString("en-US")} steps`}
          {busy && context.phase === "compiling" && " · compiling"}
          {status === "completed" &&
            trace.stats &&
            ` · ${trace.totalSteps.toLocaleString("en-US")} steps in ${Math.round(trace.stats.executeMs)} ms`}
        </p>
      </header>
      <main className="min-h-0 flex-1">
        <Group orientation={wide ? "horizontal" : "vertical"} className="h-full">
          <Panel defaultSize="55" minSize="25">
            {editorPane}
          </Panel>
          <Separator className={wide ? "w-px" : "h-px"} />
          <Panel defaultSize="45" minSize="20">
            <Group orientation="vertical" className="h-full">
              <Panel defaultSize="70" minSize="20">
                {inspectorPane}
              </Panel>
              <Separator className="h-px" />
              <Panel defaultSize="30" minSize="10">
                {consolePane}
              </Panel>
            </Group>
          </Panel>
        </Group>
      </main>
    </div>
  );
}

function EmptyState({ status }: { status: ExecutionStatus }) {
  if (status === "running") return <p className="text-sm text-muted">Recording execution…</p>;
  return (
    <p className="text-sm text-muted">
      Press <kbd className="rounded border border-border px-1 font-mono text-xs">Ctrl ↵</kbd> to run
      your code and record its execution. Then step through it with{" "}
      <kbd className="rounded border border-border px-1 font-mono text-xs">Alt ←/→</kbd>.
    </p>
  );
}

"use client";

import {
  ChevronDown,
  ChevronLeft,
  Copy,
  Download,
  EllipsisVertical,
  Flag,
  Maximize2,
  Minimize2,
  PanelLeft,
  ScanSearch,
  Play,
  Plus,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createPortal } from "react-dom";
import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { posthog } from "posthog-js";
import {
  Group,
  Panel,
  Separator,
  usePanelRef,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import { ContextMenu, Menu, type MenuItem } from "@/components/Menu";
import { SiteHeader } from "@/components/SiteHeader";
import { UnderlineTabs } from "@/components/UnderlineTabs";
import { findExample } from "@/content/examples";
import {
  LANGUAGES,
  languageById,
  languageOfFile,
  type LanguageId,
} from "@/engine/languages/catalog";
import { basename, normalizePath } from "@/engine/core/project/paths";
import type { Diagnostic } from "@/engine/core/protocol/program";
import type { TestCase, TestSuite } from "@/engine/core/protocol/testing";
import { BreakpointsPanel } from "@/features/breakpoints/BreakpointsPanel";
import { ComplexityPanel } from "@/features/complexity/ComplexityPanel";
import { ConsolePanel } from "@/features/console/ConsolePanel";
import { CodeEditor, type EditorDiagnostic, type EditorReveal } from "@/features/editor/CodeEditor";
import { languageServiceFor } from "@/features/editor/languageServices";
import type { ExecutionMark } from "@/features/editor/executionLine";
import { ExecutionFlow } from "@/features/flow/ExecutionFlow";
import { Inspector } from "@/features/inspector/Inspector";
import { ExecutionLog, logAsText } from "@/features/log/ExecutionLog";
import { detectFunctionNames, summarize, traceSourceFor } from "@/features/tests/suite";
import { TestsPanel } from "@/features/tests/TestsPanel";
import { Timeline } from "@/features/timeline/Timeline";
import {
  useExecutionContext,
  useExecutionSession,
  useExecutionStatus,
  useTraceSnapshot,
} from "@/hooks/useExecutionSession";
import { edgeFadeMask, useHorizontalScroll } from "@/hooks/useHorizontalScroll";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { oneOf, usePreference } from "@/hooks/usePreference";
import type { ExecutionStatus } from "@/machine/executionMachine";
import {
  BLANK_DOC,
  canSwitchLanguage,
  docKey,
  loadWorkspace,
  validateFilePath,
  MAX_FILE_CHARS,
  MAX_FILES,
  newFileId,
  refOfKey,
  resolveDoc,
  saveWorkspace,
  workspaceReducer,
  type CloseScope,
  type DocRef,
  type WorkspaceAction,
} from "./files";
import { tabLabel } from "./fileTree";
import {
  docKeyOfFile,
  lonelyRun,
  planRun,
  sourcesChanged,
  tracedRunOf,
  type TracedRun,
} from "./runPlan";
import { bannerFor, RunBanner, type BannerMessage, type Navigate } from "./RunBanner";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Sidebar } from "./Sidebar";
import { easeOut, FADE_UP, SWAP_Y } from "@/components/motion";
import { copyText, downloadText } from "@/lib/download";

const VIEW_MODES = ["visual", "split", "code"] as const;
type ViewMode = (typeof VIEW_MODES)[number];
const DRAWER_TABS = ["log", "console", "breakpoints", "tests", "complexity"] as const;
type DrawerTab = (typeof DRAWER_TABS)[number];

const STATUS_TEXT: Record<ExecutionStatus, string> = {
  idle: "Ready",
  running: "Running",
  cancelling: "Cancelling",
  completed: "Finished",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Badge colours in the language menu (each language's own brand colour). */
const LANGUAGE_BADGE_CLASS: Record<LanguageId, string> = {
  javascript: "bg-[#f7df1e] text-black",
  typescript: "bg-[#3178c6] text-white",
  python: "bg-[#3776ab] text-[#ffd43b]",
};

const SAVE_DELAY_MS = 400;
/** Height of the bottom drawer's tab bar; the drawer collapses down to it. */
const DRAWER_BAR_PX = 46;
const TOGGLE_ANIMATION_MS = 340;
const NOTICE_MS = 6000;

const card = "rounded-2xl bg-surface edge";
const outlineButton =
  "press flex h-10 items-center gap-2 rounded-xl px-3.5 text-[13px] text-ink edge transition-colors hover:bg-surface-2";

const capture = (event: string, properties?: Record<string, string | number>) => {
  if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN || !process.env.NEXT_PUBLIC_POSTHOG_HOST)
    return;
  posthog.capture(event, properties);
};

const posthogLog = (body: string, attributes?: Record<string, string | number>) => {
  if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN || !process.env.NEXT_PUBLIC_POSTHOG_HOST)
    return;
  posthog.logger.info(body, attributes);
};

/** Reads `?example=…&autorun=trace|tests&step=N&tab=…` once (examples, demos, shared links). */
const readLaunchOptions = () => {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  return {
    example: findExample(params.get("example"))?.id ?? null,
    autorun: params.get("autorun"),
    step: Number(params.get("step") ?? Number.NaN),
    tab: (DRAWER_TABS as readonly string[]).includes(tab ?? "") ? (tab as DrawerTab) : null,
  };
};

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  Boolean(target.closest("input, textarea, select, [contenteditable='true'], .cm-editor"));

export default function Workspace() {
  const { store, actor, prewarm, serviceCall } = useExecutionSession();
  const trace = useTraceSnapshot(store);
  const status = useExecutionStatus(actor);
  const context = useExecutionContext(actor);
  const wide = useMediaQuery("(min-width: 1024px)");

  const [launch] = useState(readLaunchOptions);
  const [workspace, dispatch] = useReducer(workspaceReducer, undefined, () => {
    const loaded = loadWorkspace();
    return launch.example
      ? workspaceReducer(loaded, { type: "open", ref: { kind: "example", id: launch.example } })
      : loaded;
  });
  // With every tab closed there is no document; a blank stand-in keeps the views below simple.
  const empty = workspace.active === null;
  const doc = resolveDoc(workspace, workspace.active) ?? BLANK_DOC;
  const switchable = doc.ref.kind === "file" && canSwitchLanguage(doc);
  const breakpoints = workspace.breakpoints[doc.key] ?? [];

  const [viewMode, setViewMode] = usePreference<ViewMode>("view-mode", "visual", oneOf(VIEW_MODES));
  const [drawerTab, setDrawerTab] = usePreference<DrawerTab>(
    "drawer-tab",
    "log",
    oneOf(DRAWER_TABS),
  );
  const [sidebarOpen, setSidebarOpen] = usePreference<boolean>("sidebar", true);
  const [inspectorOpen, setInspectorOpen] = usePreference<boolean>("inspector", true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  /** Bumped by "Reset workspace" and language switches so the editor reloads even when the
   * same document stays open. */
  const [generation, setGeneration] = useState(0);

  const source = useRef(doc.source);
  /** Editor text when the current trace was started (a traced test case appends a call). */
  const [traced, setTraced] = useState<TracedRun | null>(null);
  /** A location to show in the editor (from a diagnostic, the call stack or an import). */
  const [reveal, setReveal] = useState<EditorReveal | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingStep = useRef<number | null>(Number.isInteger(launch.step) ? launch.step : null);
  const searchInput = useRef<HTMLInputElement>(null);
  const tabStrip = useRef<HTMLDivElement>(null);
  const tabEdges = useHorizontalScroll(tabStrip);

  const drawerPanel = usePanelRef();
  const inspectorPanel = usePanelRef();
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [animating, setAnimating] = useState(false);
  const animationTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** True while a toggle animation runs, so its in-between sizes are not mistaken for a drag. */
  const toggling = useRef(false);

  const busy = status === "running" || status === "cancelling";
  const testMode = Boolean(context.request?.suite);
  const view = trace.view;
  const languageId = doc.languageId;
  const suite = doc.suite;
  const functionNames = useMemo(
    () => detectFunctionNames(doc.source, languageId),
    [doc.source, languageId],
  );
  const [errorCount, setErrorCount] = useState(0);
  // Keep a runtime for the open document's language loading before the user presses Run.
  useEffect(() => prewarm(languageId), [prewarm, languageId]);

  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => setSaveFailed(!saveWorkspace(workspace)), [workspace]);

  /** A short-lived notice for the result of an action (refused limits, export outcomes). */
  const [notice, setNotice] = useState<BannerMessage | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = (title: string, detail?: string, tone: BannerMessage["tone"] = "warning") => {
    setNotice({ tone, title, details: detail ? [detail] : [] });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  };
  const storageNotice: BannerMessage | null = saveFailed
    ? {
        tone: "danger",
        title: "Your files aren't being saved",
        details: ["Browser storage is full or unavailable. Copy anything you want to keep."],
      }
    : null;

  /** Adds or duplicates a file unless the workspace is full. */
  const addFile = (action: Extract<WorkspaceAction, { type: "create" | "duplicate" }>) => {
    if (workspace.files.length >= MAX_FILES) {
      notify(
        `You can keep up to ${MAX_FILES} files`,
        "Delete a file you don't need to make room for a new one.",
      );
      return;
    }
    flushEdit();
    dispatch(action);
    capture(action.type === "create" ? "workspace_file_created" : "workspace_file_duplicated");
  };
  useEffect(() => {
    if (launch.tab) setDrawerTab(launch.tab);
    // Launch options apply once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Writes any pending editor text into the active document right away. */
  const flushEdit = () => {
    if (saveTimer.current === undefined) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    dispatch({ type: "edit", source: source.current });
  };

  const openDoc = (ref: DocRef) => {
    flushEdit();
    dispatch({ type: "open", ref });
    setFocus(null);
  };
  // Keep the run buffer in step with the document shown (switching tabs, deletes, reset).
  useEffect(() => {
    source.current = doc.source;
    // Only a different document replaces the buffer; edits of this one flow the other way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.key, generation]);

  // Bring the active tab into view in the tab strip (new tabs open at its right end).
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      tabStrip.current
        ?.querySelector('[role="tab"][aria-selected="true"]')
        ?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [doc.key, workspace.tabs.length]);

  /** Why Run is unavailable: editor errors (syntax, types) stop a run like syntax errors do. */
  const runBlockedReason =
    errorCount === 0 ? null : `Fix ${errorCount} ${errorCount === 1 ? "error" : "errors"} to run`;
  const blockedByTypes = (): boolean => {
    if (runBlockedReason) notify(runBlockedReason, undefined, "danger");
    return runBlockedReason !== null;
  };

  /** The tab a right click opened the tab menu on, and where. */
  const [tabMenu, setTabMenu] = useState<{ ref: DocRef; x: number; y: number } | null>(null);
  const closeTabMenu = useCallback(() => setTabMenu(null), []);
  /** Closes one tab, or (with a scope) the tabs around it, saving the open edit first. */
  const closeTab = (ref: DocRef, scope?: CloseScope) => {
    flushEdit();
    dispatch(scope ? { type: "closeTabs", scope, ref } : { type: "close", ref });
  };
  const tabMenuItems = (ref: DocRef): MenuItem[] => {
    const index = workspace.tabs.findIndex((tab) => docKey(tab) === docKey(ref));
    const only = workspace.tabs.length === 1;
    return [
      {
        label: "Close",
        onSelect: () => closeTab(ref),
      },
      { label: "Close others", disabled: only, onSelect: () => closeTab(ref, "others") },
      {
        label: "Close to the right",
        disabled: index < 0 || index === workspace.tabs.length - 1,
        onSelect: () => closeTab(ref, "right"),
      },
      { label: "Close all", onSelect: () => closeTab(ref, "all") },
    ];
  };

  const run = () => {
    if (empty || blockedByTypes()) return;
    flushEdit();
    const plan = planRun(workspace, source.current);
    if (!plan) return;
    setTraced(tracedRunOf(plan));
    capture("code_run_started", {
      language: plan.languageId,
      document_kind: doc.ref.kind,
      project_files: plan.project?.files.length ?? 1,
    });
    posthogLog("workspace execution started", {
      language: plan.languageId,
      document_kind: doc.ref.kind,
    });
    actor.send({
      type: "RUN",
      source: plan.source,
      languageId: plan.languageId,
      project: plan.project,
    });
  };
  const runTests = () => {
    if (empty || blockedByTypes()) return;
    flushEdit();
    setDrawerTab("tests");
    if (!drawerOpen) toggleDrawer();
    capture("test_suite_run_started", {
      language: languageId,
      test_case_count: suite.cases.length,
    });
    posthogLog("workspace test suite started", {
      language: languageId,
      test_case_count: suite.cases.length,
    });
    actor.send({ type: "RUN", source: source.current, languageId, suite });
  };
  const traceCase = (testCase: TestCase) => {
    if (empty || blockedByTypes()) return;
    setTraced(lonelyRun(doc.key, doc.path, source.current));
    capture("test_case_trace_started", { language: languageId });
    actor.send({
      type: "RUN",
      source: traceSourceFor(source.current, suite, testCase, languageId),
      languageId,
    });
  };
  const cancel = (): boolean => {
    if (status !== "running") return false;
    capture("execution_cancelled");
    posthogLog("workspace execution cancelled");
    actor.send({ type: "CANCEL" });
    return true;
  };

  /** Runs `resize` with the panel sizes animated (never while dragging). */
  const animateResize = (resize: () => void) => {
    toggling.current = true;
    setAnimating(true);
    clearTimeout(animationTimer.current);
    animationTimer.current = setTimeout(() => {
      toggling.current = false;
      setAnimating(false);
    }, TOGGLE_ANIMATION_MS);
    resize();
  };

  /** Collapses or expands a panel with an animated resize. */
  const togglePanel = (panel: PanelImperativeHandle | null) => {
    if (!panel) return;
    animateResize(() => (panel.isCollapsed() ? panel.expand() : panel.collapse()));
  };

  const toggleDrawer = () => togglePanel(drawerPanel.current);

  const toggleInspector = () => {
    setInspectorOpen(!inspectorOpen);
    togglePanel(inspectorPanel.current);
  };

  const onChange = (value: string) => {
    source.current = value;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = undefined;
      dispatch({ type: "edit", source: value });
    }, SAVE_DELAY_MS);
  };

  const changeSuite = (next: TestSuite) => dispatch({ type: "suite", suite: next });

  /**
   * Expands the visualization over the whole window. An in-page overlay rather than the
   * Fullscreen API, which embedded browsers and iframes often block.
   */
  const toggleFullscreen = () => setFullscreen((value) => !value);
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setFullscreen(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [fullscreen]);

  // Launch options for demos: run automatically.
  useEffect(() => {
    if (launch.autorun === "trace") {
      setTraced(lonelyRun(doc.key, doc.path, source.current));
      actor.send({ type: "RUN", source: source.current, languageId });
    } else if (launch.autorun === "tests") {
      actor.send({ type: "RUN", source: source.current, languageId, suite });
    }
    // Launch options apply once, to the document open at load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, launch]);

  useEffect(() => {
    if (trace.status !== "complete" || pendingStep.current === null) return;
    store.seek(pendingStep.current);
    pendingStep.current = null;
  }, [trace.status, store]);

  // Global shortcuts.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.key === "Escape" && actor.getSnapshot().can({ type: "CANCEL" })) {
        cancel();
      } else if (mod && event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        runTests();
      } else if (mod && event.key === "Enter") {
        event.preventDefault();
        run();
      } else if (mod && key === "k") {
        event.preventDefault();
        setSidebarOpen(true);
        requestAnimationFrame(() => searchInput.current?.focus());
      } else if (mod && key === "b") {
        event.preventDefault();
        setSidebarOpen(!sidebarOpen);
      } else if (mod && event.key === "`") {
        event.preventDefault();
        toggleDrawer();
      } else if (event.key === "?" && !isEditable(event.target)) {
        event.preventDefault();
        setShortcutsOpen(true);
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
  });

  const currentSource = (key: string): string | undefined =>
    key === doc.key ? doc.source : resolveDoc(workspace, refOfKey(key))?.source;
  const entryFile = workspace.files.find((file) => file.id === workspace.entry);
  const entryLabel = entryFile ? basename(entryFile.path) : "Open file";
  const entryChoices = workspace.files.filter((file) => languageOfFile(file.path).projects);
  const openPaths = workspace.tabs.flatMap((ref) => resolveDoc(workspace, ref)?.path ?? []);
  const sourceChanged =
    trace.status !== "empty" && traced !== null && sourcesChanged(traced, currentSource);
  const editorLines = doc.source.split("\n").length;
  const programFiles = trace.program?.files ?? [];
  /** The document the current step runs in (a project's step can be in any of its files). */
  const executingKey = view?.loc ? docKeyOfFile(traced, programFiles, view.loc.file) : null;
  // Marked while running or once stepping has moved off the first step; a finished run resting
  // at its start (or code edited since) leaves the editor unmarked.
  const marked = busy || (trace.position > 0 && !sourceChanged);
  const execution = useMemo<ExecutionMark | null>(() => {
    if (!marked || !view?.loc || executingKey !== doc.key || view.loc.line > editorLines)
      return null;
    return {
      line: view.loc.line,
      endLine: view.loc.role === "call" ? view.loc.line : view.loc.endLine,
      kind: view.kind === "call" ? "call" : "statement",
    };
  }, [marked, view, editorLines, executingKey, doc.key]);

  // Stepping into another file shows that file; the user may then look elsewhere until the
  // next step crosses into a different file.
  /** Following only starts once the user steps: a run resting at its start stays where it is. */
  const stepping = !busy && trace.position > 0 && !sourceChanged;
  const followed = useRef<string | null>(null);
  useEffect(() => {
    if (!stepping || !executingKey || executingKey === followed.current) return;
    followed.current = executingKey;
    if (executingKey !== doc.key) openDoc(refOfKey(executingKey));
    // Only the executing file changing moves the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executingKey, stepping]);
  useEffect(() => {
    if (!stepping) followed.current = null;
  }, [stepping]);

  /** Whether a diagnostic from a run belongs to the open document. */
  const isHere = (path: string | undefined): boolean =>
    path === undefined ? traced?.entryKey === doc.key : path === doc.path;
  const diagnostics = useMemo<EditorDiagnostic[]>(() => {
    const fromCompile: readonly Diagnostic[] =
      context.failure?.kind === "compile" ? context.failure.diagnostics : [];
    const warnings = trace.program?.warnings ?? [];
    const thrown: EditorDiagnostic[] = [];
    if (trace.outcome?.kind === "exception" && trace.outcome.loc !== null) {
      const loc = trace.program?.locs[trace.outcome.loc];
      if (
        loc &&
        loc.line <= editorLines &&
        docKeyOfFile(traced, programFiles, loc.file) === doc.key
      ) {
        thrown.push({
          severity: "error",
          message: `Uncaught ${trace.outcome.message}`,
          range: loc,
        });
      }
    }
    return [...[...fromCompile, ...warnings].filter((d) => isHere(d.path)), ...thrown];
    // `isHere` and `programFiles` derive from the dependencies listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.failure, trace.program, trace.outcome, editorLines, traced, doc.key, doc.path]);

  /** Opens a file of the project and shows a location in it. */
  const navigate: Navigate = ({ path, line, column }) => {
    const target = workspace.files.find((file) => file.path === path);
    if (!target) return;
    const ref: DocRef = { kind: "file", id: target.id };
    if (docKey(ref) !== doc.key) openDoc(ref);
    setReveal({ docKey: docKey(ref), line, column, nonce: Date.now() });
  };

  /** Playback pauses at a place that has a breakpoint in the document it belongs to. */
  const isBreakpoint = useCallback(
    ({ file, line }: { file: number; line: number }): boolean => {
      const key = docKeyOfFile(traced, trace.program?.files ?? [], file);
      return key !== null && (workspace.breakpoints[key] ?? []).includes(line);
    },
    [traced, trace.program, workspace.breakpoints],
  );

  /** Shows a place of the traced code: the file it is in, at that line. */
  const showTraceLocation = ({
    file,
    line,
    column,
  }: {
    file: number;
    line: number;
    column: number;
  }) => {
    const key = docKeyOfFile(traced, programFiles, file);
    if (!key) return;
    if (key !== doc.key) openDoc(refOfKey(key));
    setReveal({ docKey: key, line, column, nonce: Date.now() });
  };

  const banner = bannerFor(
    context.failure,
    testMode ? null : trace.outcome,
    trace.program,
    sourceChanged,
  );
  const summary = summarize(context.testResults);

  const statusText = (() => {
    if (busy && context.phase === "compiling") return "Compiling";
    if (busy && context.phase === "loading") return `Loading ${languageById(languageId).label}`;
    if (busy && testMode)
      return `Testing ${context.testResults.length} of ${context.request?.suite?.cases.length ?? 0}`;
    if (busy) return `${STATUS_TEXT[status]} · ${context.steps.toLocaleString("en-US")} steps`;
    if (status === "completed" && testMode)
      return `${summary.passed} of ${summary.total} tests passed`;
    if (status === "completed" && trace.stats) {
      return `${trace.totalSteps.toLocaleString("en-US")} steps · ${Math.round(trace.stats.executeMs)} ms`;
    }
    return STATUS_TEXT[status];
  })();

  const visibleOutput = view?.consoleCount ?? trace.console.length;

  // ---------------------------------------------------------------- panes

  const editorPane = (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden ${card}`}>
      <div className="min-h-0 flex-1 pt-2">
        <CodeEditor
          key={`${doc.key}:${generation}`}
          reveal={reveal?.docKey === doc.key ? reveal : null}
          initialValue={doc.source}
          languageId={languageId}
          execution={execution}
          diagnostics={diagnostics}
          breakpoints={breakpoints}
          onToggleBreakpoint={(line) => dispatch({ type: "toggleBreakpoint", line })}
          onChange={onChange}
          serviceFor={(id) => languageServiceFor(id, serviceCall)}
          onServiceErrors={setErrorCount}
          maxLength={MAX_FILE_CHARS}
          onLimit={() =>
            notify(
              "This file is at its size limit",
              `Files can hold up to ${MAX_FILE_CHARS / 1000} KB of code.`,
            )
          }
          onRun={run}
          onCancel={cancel}
        />
      </div>
    </div>
  );

  const flowMenu: MenuItem[] = [
    {
      label: "Copy step as JSON",
      icon: <Copy size={14} />,
      disabled: !view,
      onSelect: () =>
        void navigator.clipboard.writeText(
          JSON.stringify(
            {
              step: trace.position + 1,
              line: view?.loc?.line ?? null,
              facts: view?.facts.map((fact) => fact.text.replaceAll("`", "")),
            },
            null,
            2,
          ),
        ),
    },
    {
      label: fullscreen ? "Exit fullscreen" : "Fullscreen",
      icon: fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />,
      onSelect: toggleFullscreen,
    },
  ];

  const flowPane = (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden bg-surface ${card}`}>
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">Execution Flow</h2>
          <div
            role="status"
            aria-live="polite"
            className="mt-0.5 flex items-center gap-2 text-[12px] text-muted"
          >
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${
                busy
                  ? "animate-pulse bg-accent"
                  : status === "failed"
                    ? "bg-danger"
                    : status === "completed"
                      ? "bg-success"
                      : "bg-faint"
              }`}
            />
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={statusText}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.14 }}
                className="tabular-nums"
              >
                {statusText}
              </motion.span>
            </AnimatePresence>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Menu
            label="Visualization options"
            align="end"
            trigger={
              <button
                type="button"
                aria-label="Visualization options"
                className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <EllipsisVertical size={16} />
              </button>
            }
            items={flowMenu}
          />
          <button
            type="button"
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={toggleFullscreen}
            className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>
      <RunBanner message={banner} onNavigate={navigate} />
      <div className="thin-scroll min-h-0 flex-1 overflow-auto">
        {view ? (
          <ExecutionFlow
            view={view}
            languageBadge={languageById(languageId).badge}
            focus={focus}
            onFocus={setFocus}
          />
        ) : (
          <div className="grid h-full place-items-center p-8 text-center">
            <div>
              <p className="text-[15px] font-medium text-ink">
                {status === "running"
                  ? "Recording execution…"
                  : "Run your code to see it come alive."}
              </p>
              <p className="mt-1.5 text-[13px] text-muted">
                Press <kbd className="rounded bg-surface-2 px-1.5 text-[12px]">Ctrl ↵</kbd>, then
                step through every change.
              </p>
              {status !== "running" && (
                <button
                  type="button"
                  onClick={run}
                  disabled={runBlockedReason !== null}
                  title={runBlockedReason ?? undefined}
                  className="press disabled:opacity-40 mx-auto mt-5 flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-[13px] font-medium text-bg"
                >
                  <Play size={13} fill="currentColor" /> Run
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  /** In the layout the pane keeps its place; expanded, it renders over everything instead. */
  const flowSlot = fullscreen ? (
    <div className={`grid h-full place-items-center text-[13px] text-faint ${card}`}>
      Visualization expanded — press Esc to return
    </div>
  ) : (
    flowPane
  );

  const inspectorPane = (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden ${card}`}>
      <Inspector
        view={view}
        focus={focus}
        onFocus={setFocus}
        files={programFiles}
        onJumpTo={showTraceLocation}
      />
    </div>
  );

  const panes: Record<
    ViewMode,
    ReadonlyArray<{ id: string; size: string; min: string; node: React.ReactNode }>
  > = {
    visual: [
      { id: "editor", size: "34", min: "20", node: editorPane },
      { id: "flow", size: "42", min: "25", node: flowSlot },
      { id: "inspector", size: "24", min: "16", node: inspectorPane },
    ],
    split: [
      { id: "editor", size: "50", min: "25", node: editorPane },
      { id: "flow", size: "50", min: "25", node: flowSlot },
    ],
    code: [
      { id: "editor", size: "72", min: "40", node: editorPane },
      { id: "inspector", size: "28", min: "18", node: inspectorPane },
    ],
  };

  const hasInspector = panes[viewMode].some((pane) => pane.id === "inspector");
  /**
   * Starting sizes: a hidden inspector starts collapsed and the others share its space. Read
   * once per layout, never from live state — changing `defaultSize` would re-apply the layout.
   */
  const startedOpen = useMemo(() => inspectorOpen, [viewMode, wide]); // eslint-disable-line react-hooks/exhaustive-deps
  const startSize = (pane: { id: string; size: string }): string => {
    if (!hasInspector || startedOpen) return pane.size;
    if (pane.id === "inspector") return "0";
    const rest = panes[viewMode].reduce(
      (sum, other) => (other.id === "inspector" ? sum : sum + Number(other.size)),
      0,
    );
    return String((Number(pane.size) / rest) * 100);
  };

  const exportItems: MenuItem[] = [
    {
      label: "Copy logs",
      icon: <Copy size={14} />,
      hint: trace.totalSteps === 0 ? "Run first" : undefined,
      disabled: trace.totalSteps === 0,
      onSelect: () =>
        void copyText(logAsText(store, trace.totalSteps)).then((copied) =>
          copied
            ? notify("Logs copied", undefined, "muted")
            : notify("Couldn't copy the logs", "Your browser blocked clipboard access."),
        ),
    },
    {
      label: "Download JSON",
      icon: <Download size={14} />,
      hint: trace.totalSteps === 0 ? "Run first" : undefined,
      disabled: trace.totalSteps === 0,
      onSelect: () => {
        downloadText(
          `${doc.path.replace(/\.[^.]+$/, "")}-trace.json`,
          JSON.stringify(
            {
              file: doc.path,
              source: traced?.sources ?? null,
              steps: store.summaries(0, trace.totalSteps),
              console: trace.console,
              outcome: trace.outcome,
            },
            null,
            2,
          ),
          "application/json",
        );
        notify("Trace downloaded", undefined, "muted");
      },
    },
  ];

  const drawer = (
    <div className={`flex h-full min-h-0 flex-col overflow-hidden ${card}`}>
      <div
        className="flex shrink-0 items-center gap-3 border-b border-border pr-3 pl-5"
        style={{ height: DRAWER_BAR_PX }}
      >
        <UnderlineTabs<DrawerTab>
          label="Bottom panel"
          value={drawerTab}
          onChange={(tab) => {
            setDrawerTab(tab);
            if (!drawerOpen) toggleDrawer();
          }}
          className="min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
          options={[
            { value: "log", label: "Execution Log" },
            {
              value: "console",
              label: "Console Output",
              badge:
                trace.console.length > 0
                  ? String(Math.min(visibleOutput, trace.console.length))
                  : undefined,
            },
            {
              value: "breakpoints",
              label: "Breakpoints",
              badge: breakpoints.length > 0 ? String(breakpoints.length) : undefined,
            },
            {
              value: "tests",
              label: "Tests",
              badge:
                context.testResults.length > 0
                  ? `${summary.passed}/${summary.total}`
                  : suite.cases.length > 0
                    ? String(suite.cases.length)
                    : undefined,
            },
            { value: "complexity", label: "Complexity" },
          ]}
        />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => actor.send({ type: "RESET" })}
            disabled={status === "idle" && trace.status === "empty"}
            className="press rounded-lg px-2.5 py-1.5 text-[13px] text-text transition-colors hover:bg-surface-2 disabled:opacity-40"
          >
            Clear
          </button>
          <Menu
            label="Export"
            align="end"
            side="top"
            trigger={
              <button
                type="button"
                className="press flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] text-text transition-colors hover:bg-surface-2"
              >
                Export <ChevronDown size={13} className="text-faint" />
              </button>
            }
            items={exportItems}
          />
          <button
            type="button"
            onClick={toggleDrawer}
            aria-expanded={drawerOpen}
            aria-label={
              drawerOpen ? "Collapse bottom panel (Ctrl+`)" : "Expand bottom panel (Ctrl+`)"
            }
            title={drawerOpen ? "Collapse (Ctrl+`)" : "Expand (Ctrl+`)"}
            className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <ChevronLeft
              size={16}
              className={`transition-transform duration-300 ${drawerOpen ? "-rotate-90" : "rotate-90"}`}
            />
          </button>
        </div>
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-auto">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={drawerTab}
            {...FADE_UP}
            transition={easeOut(0.15)}
            className="min-h-full"
          >
            {drawerTab === "log" && (
              <ExecutionLog
                store={store}
                position={trace.position}
                total={trace.totalSteps}
                runId={trace.runId}
              />
            )}
            {drawerTab === "console" && (
              <div className="py-2">
                <ConsolePanel lines={trace.console} visibleCount={visibleOutput} />
              </div>
            )}
            {drawerTab === "breakpoints" && (
              <BreakpointsPanel
                lines={breakpoints}
                source={doc.source}
                onRemove={(line) => dispatch({ type: "toggleBreakpoint", line })}
                onClear={() => dispatch({ type: "clearBreakpoints" })}
              />
            )}
            {drawerTab === "tests" && (
              <TestsPanel
                suite={suite}
                functionNames={functionNames}
                results={context.testResults}
                running={busy}
                blockedReason={runBlockedReason}
                onChange={changeSuite}
                onRun={runTests}
                onTrace={traceCase}
              />
            )}
            {drawerTab === "complexity" && (
              <ComplexityPanel
                analysis={context.analysis}
                operations={trace.status === "complete" ? (trace.stats?.steps ?? null) : null}
                metrics={trace.status === "complete" ? trace.metrics : null}
                testResults={context.testResults}
                onOpenTests={() => setDrawerTab("tests")}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );

  // ---------------------------------------------------------------- layout

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <SiteHeader variant="app" />

      <div className="flex min-h-0 flex-1">
        <motion.aside
          aria-label="Sidebar"
          initial={false}
          animate={{ width: sidebarOpen && wide ? 232 : 0, opacity: sidebarOpen && wide ? 1 : 0 }}
          transition={easeOut(0.25)}
          className="shrink-0 overflow-hidden border-r border-border"
          inert={!(sidebarOpen && wide)}
        >
          <Sidebar
            ref={searchInput}
            files={workspace.files}
            entry={workspace.entry}
            active={workspace.active}
            onOpen={openDoc}
            onSetEntry={(id) => dispatch({ type: "entry", id })}
            onNewFile={(name, text) =>
              addFile({ type: "create", id: newFileId(), name, source: text })
            }
            onRename={(id, name) => {
              const checked = validateFilePath(name);
              if (checked.ok) dispatch({ type: "rename", id, name: checked.path });
              else notify("Can't rename the file", checked.message, "danger");
            }}
            onRenameFolder={(from, to) => {
              const checked = normalizePath(to);
              if (!checked.ok) return notify("Can't rename the folder", checked.message, "danger");
              const before = workspace.files.length;
              dispatch({ type: "renameFolder", from, to: checked.path });
              capture("workspace_folder_renamed", { files: before });
            }}
            onDeleteFolder={(path) => dispatch({ type: "deleteFolder", path })}
            onDuplicate={(id) => addFile({ type: "duplicate", id, newId: newFileId() })}
            onDelete={(id) => {
              dispatch({ type: "delete", id });
              capture("workspace_file_deleted");
            }}
            onResetWorkspace={() => {
              clearTimeout(saveTimer.current);
              saveTimer.current = undefined;
              dispatch({ type: "reset" });
              setGeneration((n) => n + 1);
              capture("workspace_reset");
            }}
          />
        </motion.aside>

        <main className="flex min-w-0 flex-1 flex-col gap-3 p-3">
          {/* Toolbar */}
          <div className="flex shrink-0 flex-wrap items-center gap-3 lg:flex-nowrap">
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label={sidebarOpen ? "Collapse sidebar (Ctrl+B)" : "Expand sidebar (Ctrl+B)"}
              title={sidebarOpen ? "Collapse sidebar (Ctrl+B)" : "Expand sidebar (Ctrl+B)"}
              className="press hidden size-10 place-items-center rounded-xl text-muted edge hover:text-ink lg:grid"
            >
              <motion.span animate={{ rotate: sidebarOpen ? 0 : 180 }} transition={easeOut(0.25)}>
                <PanelLeft size={16} />
              </motion.span>
            </button>

            <div
              ref={tabStrip}
              role="tablist"
              aria-label="Open files"
              style={{ maskImage: edgeFadeMask(tabEdges) }}
              // The only toolbar item that shrinks (min-w-0): many or long tabs scroll here
              // instead of pushing the view and run controls onto a new line.
              className="flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
            >
              <AnimatePresence initial={false}>
                {workspace.tabs.map((ref) => {
                  const tab = resolveDoc(workspace, ref);
                  if (!tab) return null;
                  const active = docKey(ref) === doc.key;
                  return (
                    <motion.div
                      key={docKey(ref)}
                      layout
                      onContextMenu={(event: React.MouseEvent) => {
                        event.preventDefault();
                        setTabMenu({ ref, x: event.clientX, y: event.clientY });
                      }}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={easeOut(0.18)}
                      className={`group flex h-10 shrink-0 items-center gap-2 rounded-xl pr-2 pl-3 text-[13px] transition-colors ${
                        active ? `${card} text-ink` : "text-muted hover:bg-surface-2 hover:text-ink"
                      }`}
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => openDoc(ref)}
                        title={tab.path}
                        className="flex min-w-0 items-center gap-2"
                      >
                        <span className="max-w-40 truncate font-mono">
                          {tabLabel(tab.path, openPaths)}
                        </span>
                        {ref.kind === "file" && ref.id === workspace.entry && (
                          <Flag size={11} className="text-accent" aria-label="Entry point" />
                        )}
                        {active && (
                          <span className="size-1.5 rounded-full bg-ink" aria-label="active file" />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={`Close ${tab.path}`}
                        onClick={() => closeTab(ref)}
                        className="grid size-5 place-items-center rounded text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-3 hover:text-ink focus-visible:opacity-100"
                      >
                        <X size={12} />
                      </button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              <ContextMenu
                at={tabMenu}
                items={tabMenu ? tabMenuItems(tabMenu.ref) : []}
                label="Tab actions"
                onClose={closeTabMenu}
              />
              <button
                type="button"
                aria-label="New file"
                title="New file"
                onClick={() => {
                  addFile({ type: "create", id: newFileId() });
                }}
                className="press grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
              >
                <Plus size={16} />
              </button>
            </div>

            {empty ? (
              <div className="mx-auto" />
            ) : (
              <div
                role="radiogroup"
                aria-label="View mode"
                className="mx-auto flex rounded-xl p-1 edge"
              >
                {VIEW_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={viewMode === mode}
                    onClick={() => setViewMode(mode)}
                    className={`relative h-8 rounded-lg px-5 text-[13px] font-medium capitalize transition-colors ${
                      viewMode === mode ? "text-accent" : "text-muted hover:text-ink"
                    }`}
                  >
                    {viewMode === mode && (
                      <motion.span
                        layoutId="view-mode"
                        className="absolute inset-0 rounded-lg bg-surface shadow-[0_0_0_1px_var(--border),0_1px_2px_rgb(0_0_0/0.06)]"
                        transition={{ type: "spring", duration: 0.3, bounce: 0.12 }}
                      />
                    )}
                    <span className="relative">{mode}</span>
                  </button>
                ))}
              </div>
            )}

            {hasInspector && !empty && (
              <button
                type="button"
                aria-pressed={inspectorOpen}
                aria-label={inspectorOpen ? "Hide inspector" : "Show inspector"}
                title={inspectorOpen ? "Hide inspector" : "Show inspector"}
                onClick={toggleInspector}
                className={`press grid size-10 shrink-0 place-items-center rounded-xl edge transition-colors hover:bg-surface-2 ${
                  inspectorOpen ? "text-accent" : "text-muted hover:text-ink"
                }`}
              >
                <ScanSearch size={16} />
              </button>
            )}

            {!empty && (
              <>
                <Menu
                  label="Entry point"
                  align="end"
                  trigger={
                    <button
                      type="button"
                      title="The file Run starts from"
                      className={`${outlineButton} max-w-48 justify-between`}
                    >
                      <Flag size={14} className="shrink-0 text-muted" />
                      <span className="truncate font-mono">{entryLabel}</span>
                      <ChevronDown size={15} className="shrink-0 text-muted" />
                    </button>
                  }
                  items={[
                    {
                      label: "Open file",
                      hint: workspace.entry === null ? "✓" : undefined,
                      onSelect: () => dispatch({ type: "entry", id: null }),
                    },
                    "separator",
                    ...entryChoices.map((file) => ({
                      label: file.path,
                      hint: workspace.entry === file.id ? "✓" : undefined,
                      onSelect: () => dispatch({ type: "entry", id: file.id }),
                    })),
                  ]}
                />

                <Menu
                  label="Language"
                  align="end"
                  trigger={
                    <button type="button" className={`${outlineButton} w-44 justify-between`}>
                      {languageById(languageId).label}
                      <ChevronDown size={15} className="text-muted" />
                    </button>
                  }
                  items={LANGUAGES.map((language) => ({
                    label: language.label,
                    icon: (
                      <span
                        className={`rounded px-1 text-[10px] font-bold ${LANGUAGE_BADGE_CLASS[language.id]}`}
                      >
                        {language.badge}
                      </span>
                    ),
                    hint: language.id === languageId ? "✓" : undefined,
                    // Examples keep their language, and a file with code keeps the language its
                    // code is written in: switching renames the file, it never translates code.
                    disabled: language.id !== languageId && !switchable,
                    onSelect: () => {
                      dispatch({ type: "language", languageId: language.id });
                      // The editor holds its own text: reload it with the rewritten starter.
                      setGeneration((g) => g + 1);
                      capture("language_changed", { language: language.id });
                    },
                  }))}
                />

                <div className="flex h-10 items-stretch rounded-xl bg-ink text-bg">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.button
                      key={busy ? "stop" : "run"}
                      type="button"
                      onClick={busy ? cancel : run}
                      disabled={status === "cancelling" || (!busy && runBlockedReason !== null)}
                      {...SWAP_Y}
                      transition={easeOut(0.15)}
                      whileTap={{ scale: 0.97 }}
                      title={busy ? "Stop (Esc)" : (runBlockedReason ?? "Run (Ctrl+Enter)")}
                      className="flex items-center gap-2 px-4 text-[13px] font-medium disabled:opacity-50"
                    >
                      {busy ? (
                        <Square size={12} fill="currentColor" />
                      ) : (
                        <Play size={13} fill="currentColor" />
                      )}
                      {busy ? "Stop" : "Run"}
                    </motion.button>
                  </AnimatePresence>
                  <span className="my-2 w-px bg-bg/20" />
                  <Menu
                    label="Run options"
                    align="end"
                    trigger={
                      <button
                        type="button"
                        aria-label="Run options"
                        className="grid h-full w-9 place-items-center rounded-r-xl hover:bg-bg/10"
                      >
                        <ChevronDown size={15} />
                      </button>
                    }
                    items={[
                      {
                        label: "Run",
                        hint: "Ctrl ↵",
                        icon: <Play size={13} />,
                        disabled: busy || runBlockedReason !== null,
                        onSelect: run,
                      },
                      {
                        label: "Run tests",
                        hint: "Ctrl ⇧ ↵",
                        disabled: busy || suite.cases.length === 0 || runBlockedReason !== null,
                        onSelect: runTests,
                      },
                      "separator",
                      {
                        label: "Reset trace",
                        icon: <RotateCcw size={13} />,
                        disabled: status === "idle",
                        onSelect: () => actor.send({ type: "RESET" }),
                      },
                    ]}
                  />
                </div>
              </>
            )}
          </div>

          <RunBanner message={storageNotice ?? notice} />
          {empty ? (
            <div
              className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-4 text-center ${card}`}
            >
              <div>
                <p className="text-[15px] font-medium text-ink">No file open</p>
                <p className="mt-1 text-[13px] text-muted">
                  Pick a file from the sidebar, or start a new one.
                </p>
              </div>
              <button
                type="button"
                onClick={() => addFile({ type: "create", id: newFileId() })}
                className="press flex h-10 items-center gap-2 rounded-xl bg-ink px-4 text-[13px] font-medium text-bg"
              >
                <Plus size={14} /> New file
              </button>
            </div>
          ) : (
            <>
              <Group orientation="vertical" className="min-h-0 flex-1" data-animating={animating}>
                <Panel id="main" minSize="35">
                  <div className="flex h-full min-h-0 flex-col gap-3">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={`${viewMode}-${wide}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.16 }}
                        className="min-h-0 flex-1"
                      >
                        <Group
                          orientation={wide ? "horizontal" : "vertical"}
                          className="h-full"
                          data-animating={animating}
                        >
                          {panes[viewMode].map((pane, index) => {
                            const isInspector = pane.id === "inspector";
                            const hidden = isInspector && !inspectorOpen;
                            return (
                              <Fragment key={pane.id}>
                                {index > 0 && (
                                  <Separator
                                    className={`transition-[width,height] duration-300 ${
                                      hidden
                                        ? `pointer-events-none ${wide ? "w-0" : "h-0"}`
                                        : wide
                                          ? "w-3"
                                          : "h-3"
                                    }`}
                                  />
                                )}
                                <Panel
                                  id={pane.id}
                                  panelRef={isInspector ? inspectorPanel : undefined}
                                  defaultSize={startSize(pane)}
                                  minSize={pane.min}
                                  collapsible={isInspector}
                                  collapsedSize={0}
                                  onResize={
                                    isInspector
                                      ? () => {
                                          if (toggling.current) return;
                                          setInspectorOpen(
                                            !(inspectorPanel.current?.isCollapsed() ?? false),
                                          );
                                        }
                                      : undefined
                                  }
                                >
                                  {isInspector ? (
                                    <div className="h-full" inert={hidden}>
                                      {pane.node}
                                    </div>
                                  ) : (
                                    pane.node
                                  )}
                                </Panel>
                              </Fragment>
                            );
                          })}
                        </Group>
                      </motion.div>
                    </AnimatePresence>
                    <div className={`shrink-0 ${card}`}>
                      <Timeline
                        store={store}
                        position={trace.position}
                        total={trace.totalSteps}
                        isBreakpoint={isBreakpoint}
                        onShowShortcuts={() => setShortcutsOpen(true)}
                      />
                    </div>
                  </div>
                </Panel>
                <Separator className="h-3" />
                <Panel
                  id="drawer"
                  panelRef={drawerPanel}
                  defaultSize="26"
                  minSize={140}
                  collapsible
                  collapsedSize={DRAWER_BAR_PX}
                  onResize={() => setDrawerOpen(!(drawerPanel.current?.isCollapsed() ?? false))}
                >
                  {drawer}
                </Panel>
              </Group>
            </>
          )}
        </main>
      </div>
      {createPortal(
        <AnimatePresence>
          {fullscreen && (
            <motion.div
              key="flow-fullscreen"
              initial={{ opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.985 }}
              transition={easeOut(0.2)}
              className="fixed inset-0 z-40 bg-bg p-3"
              role="dialog"
              aria-modal="true"
              aria-label="Execution Flow, expanded"
            >
              {flowPane}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

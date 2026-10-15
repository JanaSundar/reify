"use client";

import { ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Menu } from "@/components/Menu";
import { UnderlineTabs } from "@/components/UnderlineTabs";
import { previewValue } from "@/engine/core/trace/describe";
import type { StepView } from "@/engine/core/trace/stepView";
import { flowVariables, type FlowVariable, type ValueShape } from "@/features/flow/flowModel";
import { oneOf, usePreference } from "@/hooks/usePreference";
import { InspectorProvider } from "./InspectorContext";
import { ValueView } from "./ValueView";

const TABS = ["variables", "stack", "memory"] as const;
type InspectorTab = (typeof TABS)[number];

const FILTERS: ReadonlyArray<{ value: ValueShape | "all"; label: string }> = [
  { value: "all", label: "All types" },
  { value: "array", label: "Arrays" },
  { value: "object", label: "Objects" },
  { value: "primitive", label: "Primitives" },
];

const EASE = [0.23, 1, 0.32, 1] as const;

interface InspectorProps {
  readonly view: StepView | null;
  readonly focus: string | null;
  readonly onFocus: (name: string | null) => void;
  readonly onJumpToLine?: (line: number) => void;
}

function VariableItem({
  item,
  focused,
  onFocus,
}: {
  item: FlowVariable;
  focused: boolean;
  onFocus: (name: string | null) => void;
}) {
  const [open, setOpen] = useState(item.shape === "array");
  const changed = item.variable.changed || item.changedCells.length > 0;
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className={`rounded-xl px-2.5 py-2 transition-colors ${focused ? "bg-violet-soft" : "hover:bg-surface-2"}`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? `Collapse ${item.name}` : `Expand ${item.name}`}
          onClick={() => setOpen(!open)}
          className="grid size-4 place-items-center text-ink"
        >
          {item.shape === "primitive" ? (
            <span className={`size-1.5 rounded-full ${changed ? "bg-violet" : "bg-ink"}`} />
          ) : (
            <ChevronRight
              size={13}
              className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}
              fill="currentColor"
            />
          )}
        </button>
        <button
          type="button"
          onClick={() => onFocus(focused ? null : item.name)}
          title={`${item.name}: ${item.type} — click to highlight`}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
        >
          <span className="truncate font-mono text-[13px] font-medium text-ink">{item.name}</span>
          <span className="shrink-0 font-mono text-[11px] text-faint">{item.type}</span>
          {changed && (
            <span
              className="ml-auto size-1.5 shrink-0 rounded-full bg-violet"
              aria-label="changed"
            />
          )}
        </button>
      </div>
      <div className="mt-1.5 pl-6">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.code
            key={item.preview}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="inline-block max-w-full truncate rounded-lg bg-surface px-2.5 py-1 font-mono text-[12px] text-text shadow-[inset_0_0_0_1px_var(--border)]"
          >
            {item.preview}
          </motion.code>
        </AnimatePresence>
        {open && item.shape !== "primitive" && (
          <div className="mt-2 overflow-x-auto">
            <ValueView value={item.variable.value} />
          </div>
        )}
      </div>
    </motion.li>
  );
}

function VariablesTab({ view, focus, onFocus }: InspectorProps & { view: StepView }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ValueShape | "all">("all");
  const frames = view.frames.toReversed();
  const groups = frames
    .map((frame) => ({
      frame,
      items: flowVariables(view, frame).filter(
        (item) =>
          (filter === "all" || item.shape === filter) &&
          item.name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    }))
    .filter((group) => group.items.length > 0);
  const filtering = query !== "" || filter !== "all";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 shadow-[inset_0_0_0_1px_var(--border)] focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
          <Search size={14} className="shrink-0 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search variables..."
            aria-label="Search variables"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={13} className="text-faint hover:text-ink" />
            </button>
          )}
        </label>
        <Menu
          label="Filter by type"
          align="end"
          trigger={
            <button
              type="button"
              aria-label="Filter by type"
              className={`press grid size-9 place-items-center rounded-lg shadow-[inset_0_0_0_1px_var(--border)] ${
                filter !== "all" ? "text-accent" : "text-muted hover:text-ink"
              }`}
            >
              <SlidersHorizontal size={14} />
            </button>
          }
          items={[
            ...FILTERS.map((option) => ({
              label: option.label,
              hint: filter === option.value ? "✓" : undefined,
              onSelect: () => setFilter(option.value),
            })),
            "separator" as const,
            {
              label: "Clear filters",
              disabled: !filtering,
              onSelect: () => {
                setFilter("all");
                setQuery("");
              },
            },
          ]}
        />
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.map(({ frame, items }) => (
          <section key={frame.id} aria-label={`Scope ${frame.name}`} className="mb-2">
            {frames.length > 1 && (
              <h3 className="px-2.5 pt-1 pb-1 font-mono text-[11px] text-faint">
                {frame.name === "global" ? "global" : `${frame.name}()`}
              </h3>
            )}
            <ul className="flex flex-col gap-0.5">
              <AnimatePresence initial={false}>
                {items.map((item) => (
                  <VariableItem
                    key={item.key}
                    item={item}
                    focused={focus === item.name}
                    onFocus={onFocus}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </section>
        ))}
        {groups.length === 0 && (
          <p className="px-3 py-2 text-[13px] text-faint">
            {filtering ? "No variables match." : "No variables yet."}
          </p>
        )}
      </div>
    </div>
  );
}

function StackTab({
  view,
  onJumpToLine,
}: {
  view: StepView;
  onJumpToLine?: (line: number) => void;
}) {
  const frames = view.frames.toReversed();
  return (
    <ol className="thin-scroll relative flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4 pl-8">
      <span aria-hidden className="absolute top-6 bottom-6 left-[19px] w-px bg-accent/30" />
      <AnimatePresence initial={false}>
        {frames.map((frame, index) => (
          <motion.li
            key={frame.id}
            layout
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="relative"
          >
            <span
              aria-hidden
              className={`absolute top-3.5 -left-[17px] size-2.5 rounded-full border-2 border-accent ${index === 0 ? "bg-accent" : "bg-surface"}`}
            />
            <button
              type="button"
              disabled={!frame.callLoc}
              onClick={() => frame.callLoc && onJumpToLine?.(frame.callLoc.line)}
              className={`w-full rounded-lg px-3 py-2 text-left font-mono text-[12.5px] ${
                index === 0
                  ? "bg-violet-soft text-violet shadow-[inset_0_0_0_1px_var(--violet-line)]"
                  : "text-text shadow-[inset_0_0_0_1px_var(--border)] hover:bg-surface-2"
              }`}
            >
              {frame.name === "global" ? "global" : `${frame.name}()`}
              <span className="block text-[11px] text-muted">
                {frame.callLoc ? `called on line ${frame.callLoc.line}` : "program"} ·{" "}
                {frame.variables.length} variable{frame.variables.length === 1 ? "" : "s"}
              </span>
            </button>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

function MemoryTab({ view }: { view: StepView }) {
  const owners = new Map<number, string[]>();
  for (const frame of view.frames) {
    for (const variable of frame.variables) {
      if (variable.value.kind === "ref")
        owners.set(variable.value.id, [...(owners.get(variable.value.id) ?? []), variable.name]);
    }
  }
  const objects = [...view.heap.values()].filter(
    (object) => object.kind !== "callable" && owners.has(object.id),
  );
  return (
    <ul className="thin-scroll flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
      {objects.map((object) => {
        const names = owners.get(object.id)!;
        return (
          <li
            key={object.id}
            className="rounded-xl px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--border)]"
          >
            <div className="flex items-center gap-2 font-mono text-[12px]">
              <span className="text-ink">
                {object.typeName}#{object.id}
              </span>
              {view.heapChanges.has(object.id) && (
                <span className="size-1.5 rounded-full bg-violet" />
              )}
              <span className="ml-auto truncate text-muted">← {names.join(", ")}</span>
            </div>
            <p className="mt-1 truncate font-mono text-[12px] text-text">
              {previewValue({ kind: "ref", id: object.id }, view.heap)}
            </p>
            {names.length > 1 && (
              <p className="mt-1.5 w-fit rounded-md bg-accent-soft px-2 py-0.5 text-[11px] text-accent">
                Same reference in memory
              </p>
            )}
          </li>
        );
      })}
      {objects.length === 0 && (
        <p className="px-1 py-1 text-[13px] text-faint">No objects referenced yet.</p>
      )}
    </ul>
  );
}

/** Right-hand inspector: variables (searchable), call stack and memory. Remembers its tab. */
export function Inspector({ view, focus, onFocus, onJumpToLine }: InspectorProps) {
  const [tab, setTab] = usePreference<InspectorTab>("inspector-tab", "variables", oneOf(TABS));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <UnderlineTabs<InspectorTab>
        label="Inspector"
        value={tab}
        onChange={setTab}
        className="border-b border-border px-4"
        options={[
          { value: "variables", label: "Variables" },
          { value: "stack", label: "Call Stack" },
          { value: "memory", label: "Memory" },
        ]}
      />
      {view ? (
        <InspectorProvider view={view}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: EASE }}
              className="flex min-h-0 flex-1 flex-col"
            >
              {tab === "variables" && <VariablesTab view={view} focus={focus} onFocus={onFocus} />}
              {tab === "stack" && <StackTab view={view} onJumpToLine={onJumpToLine} />}
              {tab === "memory" && <MemoryTab view={view} />}
            </motion.div>
          </AnimatePresence>
        </InspectorProvider>
      ) : (
        <p className="p-4 text-[13px] leading-relaxed text-muted">
          Run your code to inspect variables, the call stack and memory at every step.
        </p>
      )}
    </div>
  );
}

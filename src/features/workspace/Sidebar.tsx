"use client";

import {
  ArrowRight,
  ChevronDown,
  Copy,
  EllipsisVertical,
  FileCode2,
  Hexagon,
  PencilLine,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { forwardRef, useState } from "react";
import { InlineConfirm } from "@/components/InlineConfirm";
import { Menu, type MenuItem } from "@/components/Menu";
import { EXAMPLES } from "@/content/examples";
import type { DocRef, WorkspaceFile } from "./files";

interface SidebarProps {
  readonly files: readonly WorkspaceFile[];
  readonly active: DocRef;
  readonly onOpen: (ref: DocRef) => void;
  readonly onNewFile: (name?: string, source?: string) => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onDuplicate: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onResetWorkspace: () => void;
}

const EASE = [0.23, 1, 0.32, 1] as const;

function ItemButton({
  active,
  icon,
  label,
  onClick,
  index,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  index: number;
}) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, ease: EASE, delay: index * 0.03 }}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors ${
        active ? "text-ink" : "text-text hover:bg-surface-2"
      }`}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          className="absolute inset-0 rounded-lg bg-accent-soft"
          transition={{ type: "spring", duration: 0.3, bounce: 0.1 }}
        />
      )}
      <span className={`relative ${active ? "text-accent" : "text-muted"}`}>{icon}</span>
      <span className="relative truncate">{label}</span>
    </motion.button>
  );
}

function FileRow({
  file,
  active,
  index,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
}: {
  file: WorkspaceFile;
  active: boolean;
  index: number;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  if (confirmingDelete) {
    return (
      <div className="px-1 py-0.5">
        <InlineConfirm
          message={`Delete ${file.name}? This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={() => {
            setConfirmingDelete(false);
            onDelete();
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      </div>
    );
  }
  if (renaming) {
    return (
      <form
        className="px-1 py-0.5"
        onSubmit={(event) => {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem("name") as HTMLInputElement;
          onRename(input.value);
          setRenaming(false);
        }}
      >
        <input
          name="name"
          defaultValue={file.name}
          aria-label={`Rename ${file.name}`}
          autoFocus
          onFocus={(event) => event.currentTarget.setSelectionRange(0, file.name.lastIndexOf("."))}
          onBlur={(event) => {
            onRename(event.currentTarget.value);
            setRenaming(false);
          }}
          onKeyDown={(event) => event.key === "Escape" && setRenaming(false)}
          className="h-8 w-full rounded-lg bg-surface px-2.5 font-mono text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--accent)] outline-none"
        />
      </form>
    );
  }
  const actions: MenuItem[] = [
    { label: "Rename", icon: <PencilLine size={14} />, onSelect: () => setRenaming(true) },
    { label: "Duplicate", icon: <Copy size={14} />, onSelect: onDuplicate },
    {
      label: "Delete",
      icon: <Trash2 size={14} />,
      danger: true,
      onSelect: () => setConfirmingDelete(true),
    },
  ];
  return (
    <div className="group relative flex items-center">
      <ItemButton
        active={active}
        index={index}
        icon={<FileCode2 size={16} strokeWidth={1.7} />}
        label={file.name}
        onClick={onOpen}
      />
      <div className="absolute right-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Menu
          label={`${file.name} actions`}
          align="end"
          trigger={
            <button
              type="button"
              aria-label={`Actions for ${file.name}`}
              className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-ink"
            >
              <EllipsisVertical size={14} />
            </button>
          }
          items={actions}
        />
      </div>
    </div>
  );
}

/** Left sidebar: file search, the built-in examples and the user's own files. */
export const Sidebar = forwardRef<HTMLInputElement, SidebarProps>(function Sidebar(
  { files, active, onOpen, onNewFile, onRename, onDuplicate, onDelete, onResetWorkspace },
  searchRef,
) {
  const [query, setQuery] = useState("");
  const [confirmingReset, setConfirmingReset] = useState(false);
  const match = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase());
  const examples = EXAMPLES.filter((example) => match(example.fileName) || match(example.title));
  const myFiles = files.filter((file) => match(file.name));

  const newFileItems: (MenuItem | "separator")[] = [
    { label: "Empty JavaScript file", onSelect: () => onNewFile("untitled.js") },
    { label: "Empty TypeScript file", onSelect: () => onNewFile("untitled.ts") },
    "separator",
    ...EXAMPLES.map((example) => ({
      label: `From ${example.title}`,
      onSelect: () => onNewFile(example.fileName, example.source),
    })),
  ];

  return (
    <div className="flex h-full w-[232px] flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <Menu
          label="Playground"
          trigger={
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg px-1 py-1 text-[17px] font-semibold tracking-tight text-ink"
            >
              Playground <ChevronDown size={16} className="text-muted" />
            </button>
          }
          items={[
            {
              label: "Reset workspace",
              icon: <RotateCcw size={14} />,
              danger: true,
              onSelect: () => setConfirmingReset(true),
            },
          ]}
        />
        <Menu
          label="New file"
          align="end"
          trigger={
            <button
              type="button"
              aria-label="New file"
              title="New file"
              className="press grid size-8 place-items-center rounded-lg text-ink shadow-[inset_0_0_0_1px_var(--border)] transition-[transform,background-color] hover:bg-surface-2 hover:scale-105"
            >
              <Plus size={16} />
            </button>
          }
          items={newFileItems}
        />
      </div>

      {confirmingReset && (
        <div className="mx-4 mt-3">
          <InlineConfirm
            message="Reset all files to the starter workspace?"
            confirmLabel="Reset"
            onConfirm={() => {
              setConfirmingReset(false);
              onResetWorkspace();
            }}
            onCancel={() => setConfirmingReset(false)}
          />
        </div>
      )}

      <label className="mx-4 mt-4 flex h-9 items-center gap-2 rounded-lg px-2.5 shadow-[inset_0_0_0_1px_var(--border)] focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
        <Search size={14} className="text-faint" />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && setQuery("")}
          placeholder="Search files..."
          aria-label="Search files"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
        />
        <kbd className="text-[11px] text-faint">⌘K</kbd>
      </label>

      <nav aria-label="Files" className="thin-scroll mt-5 min-h-0 flex-1 overflow-y-auto px-3">
        <h2 className="px-2 pb-1.5 text-[13px] font-semibold text-ink">Examples</h2>
        <div className="flex flex-col gap-0.5">
          {examples.map((example, index) => (
            <ItemButton
              key={example.id}
              index={index}
              active={active.kind === "example" && active.id === example.id}
              icon={<Hexagon size={16} strokeWidth={1.7} />}
              label={example.id === "getting-started" ? example.title : example.fileName}
              onClick={() => onOpen({ kind: "example", id: example.id })}
            />
          ))}
          {examples.length === 0 && <p className="px-3 py-1 text-[12px] text-faint">No matches</p>}
        </div>

        <h2 className="mt-6 px-2 pb-1.5 text-[13px] font-semibold text-ink">My Files</h2>
        <div className="flex flex-col gap-0.5">
          <AnimatePresence initial={false}>
            {myFiles.map((file, index) => (
              <motion.div
                key={file.id}
                layout
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18, ease: EASE }}
              >
                <FileRow
                  file={file}
                  index={index}
                  active={active.kind === "file" && active.id === file.id}
                  onOpen={() => onOpen({ kind: "file", id: file.id })}
                  onRename={(name) => onRename(file.id, name)}
                  onDuplicate={() => onDuplicate(file.id)}
                  onDelete={() => onDelete(file.id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
          {myFiles.length === 0 && (
            <p className="px-3 py-1 text-[12px] text-faint">
              {query ? "No matches" : "No files yet"}
            </p>
          )}
        </div>
      </nav>

      <div className="p-4">
        <button
          type="button"
          onClick={() => onNewFile()}
          className="press group flex h-11 w-full items-center gap-2.5 rounded-xl px-3.5 text-[13.5px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:bg-surface-2"
        >
          <Plus size={16} /> New File
          <ArrowRight
            size={15}
            className="ml-auto text-muted transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </button>
      </div>
    </div>
  );
});

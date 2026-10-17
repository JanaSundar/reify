"use client";

import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Copy,
  EllipsisVertical,
  FileCode2,
  Flag,
  Folder,
  Hexagon,
  PencilLine,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { motion } from "motion/react";
import { forwardRef, useCallback, useState } from "react";
import { InlineConfirm } from "@/components/InlineConfirm";
import { ContextMenu, Menu, type MenuItem } from "@/components/Menu";
import { EXAMPLES, type Example } from "@/content/examples";
import { LANGUAGES } from "@/engine/languages/catalog";
import { basename } from "@/engine/core/project/paths";
import type { DocRef, WorkspaceFile } from "./files";
import { buildTree, type TreeNode } from "./fileTree";
import { easeOut } from "@/components/motion";

interface SidebarProps {
  readonly files: readonly WorkspaceFile[];
  /** The file runs start from, when one is pinned. */
  readonly entry: string | null;
  readonly active: DocRef | null;
  readonly onSetEntry: (id: string | null) => void;
  readonly onRenameFolder: (from: string, to: string) => void;
  readonly onDeleteFolder: (path: string) => void;
  readonly onOpen: (ref: DocRef) => void;
  readonly onNewFile: (name?: string, source?: string) => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onDuplicate: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onResetWorkspace: () => void;
}

function ItemButton({
  active,
  icon,
  label,
  onClick,
  onContextMenu,
  index,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  index: number;
}) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={easeOut(0.25, index * 0.03)}
      onClick={onClick}
      onContextMenu={onContextMenu}
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

type FileMode = "rename" | "delete";

/** What a file's actions do; shared by its row menu and its right-click menu. */
const fileMenuItems = ({
  onMode,
  onDuplicate,
  onOpen,
  isEntry,
  onSetEntry,
}: {
  onMode: (mode: FileMode) => void;
  onDuplicate: () => void;
  onOpen?: () => void;
  isEntry: boolean;
  onSetEntry: () => void;
}): MenuItem[] => [
  ...(onOpen ? [{ label: "Open", icon: <FileCode2 size={14} />, onSelect: onOpen }] : []),
  {
    label: isEntry ? "Clear entry point" : "Set as entry point",
    icon: <Flag size={14} />,
    onSelect: onSetEntry,
  },
  { label: "Rename", icon: <PencilLine size={14} />, onSelect: () => onMode("rename") },
  { label: "Duplicate", icon: <Copy size={14} />, onSelect: onDuplicate },
  { label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: () => onMode("delete") },
];

/** What a right click landed on. */
type ContextTarget =
  | { readonly kind: "file"; readonly file: WorkspaceFile }
  | { readonly kind: "folder"; readonly path: string }
  | { readonly kind: "example"; readonly example: Example }
  | { readonly kind: "background" };

function FileRow({
  file,
  active,
  isEntry,
  depth,
  index,
  mode,
  onMode,
  onOpen,
  onContextMenu,
  onRename,
  onDuplicate,
  onDelete,
  onSetEntry,
}: {
  file: WorkspaceFile;
  active: boolean;
  isEntry: boolean;
  depth: number;
  onSetEntry: () => void;
  index: number;
  /** Whether the row is being renamed or asking to confirm a delete (owned by the sidebar). */
  mode: FileMode | null;
  onMode: (mode: FileMode | null) => void;
  onOpen: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const renaming = mode === "rename";
  const confirmingDelete = mode === "delete";
  if (confirmingDelete) {
    return (
      <div className="px-1 py-0.5">
        <InlineConfirm
          message={`Delete ${file.path}? This can't be undone.`}
          confirmLabel="Delete"
          onConfirm={() => {
            onMode(null);
            onDelete();
          }}
          onCancel={() => onMode(null)}
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
          onMode(null);
        }}
      >
        <input
          name="name"
          defaultValue={file.path}
          aria-label={`Rename ${file.path}`}
          autoFocus
          onFocus={(event) =>
            event.currentTarget.setSelectionRange(
              file.path.lastIndexOf("/") + 1,
              file.path.lastIndexOf("."),
            )
          }
          onBlur={(event) => {
            onRename(event.currentTarget.value);
            onMode(null);
          }}
          onKeyDown={(event) => event.key === "Escape" && onMode(null)}
          className="h-8 w-full rounded-lg bg-surface px-2.5 font-mono text-[13px] text-ink edge-accent outline-none"
        />
      </form>
    );
  }
  const actions = fileMenuItems({ onMode, onDuplicate, isEntry, onSetEntry });
  return (
    <div className="group relative flex items-center" style={{ paddingLeft: depth * 12 }}>
      <ItemButton
        active={active}
        index={index}
        icon={
          isEntry ? (
            <Flag size={15} strokeWidth={1.7} aria-label="Entry point" />
          ) : (
            <FileCode2 size={16} strokeWidth={1.7} />
          )
        }
        label={basename(file.path)}
        onClick={onOpen}
        onContextMenu={onContextMenu}
      />
      <div className="absolute right-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <Menu
          label={`${file.path} actions`}
          align="end"
          trigger={
            <button
              type="button"
              aria-label={`Actions for ${file.path}`}
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
  {
    files,
    entry,
    active,
    onOpen,
    onNewFile,
    onRename,
    onDuplicate,
    onDelete,
    onSetEntry,
    onRenameFolder,
    onDeleteFolder,
    onResetWorkspace,
  },
  searchRef,
) {
  const [query, setQuery] = useState("");
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [editing, setEditing] = useState<{ id: string; mode: FileMode } | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [folderEdit, setFolderEdit] = useState<{ path: string; mode: FileMode } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    target: ContextTarget;
    x: number;
    y: number;
  } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const openContextMenu = (target: ContextTarget) => (event: React.MouseEvent) => {
    event.preventDefault();
    // A row's menu wins over the one for the empty list behind it.
    event.stopPropagation();
    setContextMenu({ target, x: event.clientX, y: event.clientY });
  };
  const match = (name: string) => name.toLowerCase().includes(query.trim().toLowerCase());
  const examples = EXAMPLES.filter((example) => match(example.fileName) || match(example.title));
  const myFiles = files.filter((file) => match(file.path));
  const searching = query.trim() !== "";
  const tree = buildTree(myFiles);
  const toggleFolder = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  const copyExample = (example: Example) => onNewFile(example.fileName, example.source);

  const newFileItems: (MenuItem | "separator")[] = [
    ...LANGUAGES.map((language) => ({
      label: `Empty ${language.label} file`,
      onSelect: () => onNewFile(`untitled.${language.extensions[0]}`),
    })),
    "separator",
    ...EXAMPLES.map((example) => ({
      label: `From ${example.title}`,
      onSelect: () => copyExample(example),
    })),
  ];

  const contextItems = (target: ContextTarget): readonly (MenuItem | "separator")[] => {
    if (target.kind === "file") {
      const { file } = target;
      return fileMenuItems({
        onOpen: () => onOpen({ kind: "file", id: file.id }),
        onMode: (mode) => setEditing({ id: file.id, mode }),
        onDuplicate: () => onDuplicate(file.id),
        isEntry: entry === file.id,
        onSetEntry: () => onSetEntry(entry === file.id ? null : file.id),
      });
    }
    if (target.kind === "folder") {
      const { path } = target;
      return [
        {
          label: "New file here",
          icon: <Plus size={14} />,
          onSelect: () => onNewFile(`${path}/untitled.js`),
        },
        {
          label: "Rename folder",
          icon: <PencilLine size={14} />,
          onSelect: () => setFolderEdit({ path, mode: "rename" }),
        },
        {
          label: "Delete folder",
          icon: <Trash2 size={14} />,
          danger: true,
          onSelect: () => setFolderEdit({ path, mode: "delete" }),
        },
      ];
    }
    if (target.kind === "example") {
      const { example } = target;
      return [
        {
          label: "Open",
          icon: <Hexagon size={14} />,
          onSelect: () => onOpen({ kind: "example", id: example.id }),
        },
        {
          label: "Copy to my files",
          icon: <Copy size={14} />,
          onSelect: () => copyExample(example),
        },
      ];
    }
    return newFileItems;
  };

  const renderRows = (nodes: readonly TreeNode[], depth: number): React.ReactNode =>
    nodes.map((node, index) => {
      if (node.kind === "file") {
        const { file } = node;
        return (
          <FileRow
            key={file.id}
            file={file}
            depth={depth}
            index={index}
            isEntry={entry === file.id}
            active={active?.kind === "file" && active.id === file.id}
            mode={editing?.id === file.id ? editing.mode : null}
            onMode={(mode) => setEditing(mode ? { id: file.id, mode } : null)}
            onOpen={() => onOpen({ kind: "file", id: file.id })}
            onContextMenu={openContextMenu({ kind: "file", file })}
            onRename={(name) => onRename(file.id, name)}
            onDuplicate={() => onDuplicate(file.id)}
            onDelete={() => onDelete(file.id)}
            onSetEntry={() => onSetEntry(entry === file.id ? null : file.id)}
          />
        );
      }
      const open = searching || !collapsed.has(node.path);
      const editingFolder = folderEdit?.path === node.path ? folderEdit.mode : null;
      return (
        <div key={node.path}>
          {editingFolder === "delete" ? (
            <div className="px-1 py-0.5" style={{ paddingLeft: depth * 12 + 4 }}>
              <InlineConfirm
                message={`Delete ${node.path} and its files? This can't be undone.`}
                confirmLabel="Delete"
                onConfirm={() => {
                  setFolderEdit(null);
                  onDeleteFolder(node.path);
                }}
                onCancel={() => setFolderEdit(null)}
              />
            </div>
          ) : editingFolder === "rename" ? (
            <form
              className="px-1 py-0.5"
              onSubmit={(event) => {
                event.preventDefault();
                const input = event.currentTarget.elements.namedItem("name") as HTMLInputElement;
                onRenameFolder(node.path, input.value);
                setFolderEdit(null);
              }}
            >
              <input
                name="name"
                defaultValue={node.path}
                aria-label={`Rename folder ${node.path}`}
                autoFocus
                onBlur={() => setFolderEdit(null)}
                onKeyDown={(event) => event.key === "Escape" && setFolderEdit(null)}
                className="h-8 w-full rounded-lg bg-surface px-2.5 font-mono text-[13px] text-ink edge-accent outline-none"
              />
            </form>
          ) : (
            <button
              type="button"
              onClick={() => toggleFolder(node.path)}
              onContextMenu={openContextMenu({ kind: "folder", path: node.path })}
              aria-expanded={open}
              style={{ paddingLeft: depth * 12 + 12 }}
              className="flex w-full items-center gap-2 rounded-lg py-1.5 pr-3 text-left text-[13.5px] text-text transition-colors hover:bg-surface-2"
            >
              <ChevronRight
                size={14}
                className={`text-muted transition-transform ${open ? "rotate-90" : ""}`}
              />
              <Folder size={15} strokeWidth={1.7} className="text-muted" />
              <span className="truncate">{node.name}</span>
            </button>
          )}
          {open && renderRows(node.children, depth + 1)}
        </div>
      );
    });

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
              className="press grid size-8 place-items-center rounded-lg text-ink edge transition-[transform,background-color] hover:bg-surface-2 hover:scale-105"
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

      <label className="mx-4 mt-4 flex h-9 items-center gap-2 rounded-lg px-2.5 edge">
        <Search size={14} className="text-faint" />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && setQuery("")}
          placeholder="Search files..."
          aria-label="Search files"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none! placeholder:text-faint"
        />
        <kbd className="text-[11px] text-faint">⌘K</kbd>
      </label>

      <nav
        aria-label="Files"
        onContextMenu={openContextMenu({ kind: "background" })}
        className="thin-scroll mt-5 min-h-0 flex-1 overflow-y-auto px-3"
      >
        <h2 className="px-2 pb-1.5 text-[13px] font-semibold text-ink">Examples</h2>
        <div className="flex flex-col gap-0.5">
          {examples.map((example, index) => (
            <ItemButton
              key={example.id}
              index={index}
              active={active?.kind === "example" && active.id === example.id}
              icon={<Hexagon size={16} strokeWidth={1.7} />}
              label={example.id === "getting-started" ? example.title : example.fileName}
              onClick={() => onOpen({ kind: "example", id: example.id })}
              onContextMenu={openContextMenu({ kind: "example", example })}
            />
          ))}
          {examples.length === 0 && <p className="px-3 py-1 text-[12px] text-faint">No matches</p>}
        </div>

        <h2 className="mt-6 px-2 pb-1.5 text-[13px] font-semibold text-ink">My Files</h2>
        <div className="flex flex-col gap-0.5">
          {renderRows(tree, 0)}
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
          className="press group flex h-11 w-full items-center gap-2.5 rounded-xl px-3.5 text-[13.5px] font-medium text-ink edge transition-colors hover:bg-surface-2"
        >
          <Plus size={16} /> New File
          <ArrowRight
            size={15}
            className="ml-auto text-muted transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </button>
      </div>
      <ContextMenu
        at={contextMenu}
        items={contextMenu ? contextItems(contextMenu.target) : []}
        label={contextMenu?.target.kind === "background" ? "New file" : "File actions"}
        onClose={closeContextMenu}
      />
    </div>
  );
});

import { basename } from "@/engine/core/project/paths";
import type { WorkspaceFile } from "./files";

export type TreeNode =
  | {
      readonly kind: "folder";
      readonly name: string;
      readonly path: string;
      readonly children: readonly TreeNode[];
    }
  | { readonly kind: "file"; readonly name: string; readonly file: WorkspaceFile };

interface MutableFolder {
  readonly name: string;
  readonly path: string;
  readonly folders: Map<string, MutableFolder>;
  readonly files: TreeNode[];
}

const freeze = (folder: MutableFolder): TreeNode[] => [
  ...[...folder.folders.values()]
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((f): TreeNode => ({ kind: "folder", name: f.name, path: f.path, children: freeze(f) })),
  ...folder.files.toSorted((a, b) => a.name.localeCompare(b.name)),
];

/** Nests files by folder (folders first, then files, each by name). Folders are path prefixes. */
export const buildTree = (
  files: readonly WorkspaceFile[],
  /** Folders to show even when empty. */
  emptyFolders: readonly string[] = [],
): readonly TreeNode[] => {
  const root: MutableFolder = { name: "", path: "", folders: new Map(), files: [] };
  const folderAt = (parts: readonly string[]): MutableFolder => {
    let folder = root;
    for (const part of parts) {
      const path = folder.path ? `${folder.path}/${part}` : part;
      if (!folder.folders.has(part))
        folder.folders.set(part, { name: part, path, folders: new Map(), files: [] });
      folder = folder.folders.get(part)!;
    }
    return folder;
  };
  for (const path of emptyFolders) folderAt(path.split("/"));
  for (const file of files)
    folderAt(file.path.split("/").slice(0, -1)).files.push({
      kind: "file",
      name: basename(file.path),
      file,
    });
  return freeze(root);
};

/** A tab's label: the file name, with its folder when another open tab shares the name. */
export const tabLabel = (path: string, openPaths: readonly string[]): string => {
  const name = basename(path);
  const clash = openPaths.some((other) => other !== path && basename(other) === name);
  const dir = path.slice(0, Math.max(0, path.length - name.length - 1));
  return clash && dir ? `${name} · ${dir}` : name;
};

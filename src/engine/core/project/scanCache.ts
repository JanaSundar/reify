import type { ModuleScan, ProjectFile, ProjectLanguage } from "./types";

/**
 * Remembers each file's scan until its source changes. A scan depends only on the file's own
 * text, so editing one file never invalidates another file's entry; which modules are
 * affected by an edit is a question for the graph (`dependentsOf`).
 */
export class ScanCache {
  private readonly entries = new Map<string, { source: string; scan: ModuleScan }>();

  get(file: ProjectFile, compute: (file: ProjectFile) => ModuleScan): ModuleScan {
    const hit = this.entries.get(file.path);
    if (hit?.source === file.source) return hit.scan;
    const scan = compute(file);
    this.entries.set(file.path, { source: file.source, scan });
    return scan;
  }

  /** Drops entries for files no longer in the project (deleted or renamed). */
  retain(paths: ReadonlySet<string>): void {
    for (const path of this.entries.keys()) if (!paths.has(path)) this.entries.delete(path);
  }
}

/** A language whose scans are served from `cache` while the source is unchanged. */
export const cachedLanguage = (language: ProjectLanguage, cache: ScanCache): ProjectLanguage => ({
  ...language,
  scan: (file) => cache.get(file, (f) => language.scan(f)),
});

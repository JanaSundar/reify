/**
 * Remembers one value per project path until the key it was computed for changes. A key says
 * what the value depends on (a file's source; its source plus where its ids start), so editing
 * one file leaves every other file's entry valid.
 */
export class KeyedCache<T> {
  private readonly entries = new Map<string, { key: string; value: T }>();

  get(path: string, key: string, compute: () => T): T {
    const hit = this.entries.get(path);
    if (hit?.key === key) return hit.value;
    const value = compute();
    this.entries.set(path, { key, value });
    return value;
  }

  /** Drops entries for files no longer in the project (deleted, renamed or unreachable). */
  retain(paths: ReadonlySet<string>): void {
    for (const path of this.entries.keys()) if (!paths.has(path)) this.entries.delete(path);
  }
}

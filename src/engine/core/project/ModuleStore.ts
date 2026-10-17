import { MODULE_CACHE, namespaceRoot } from "./moduleServer";

/** The part of the Cache API the store uses (an in-memory fake implements it in tests). */
export interface ModuleCache {
  put(url: string, response: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
  keys(): Promise<readonly { readonly url: string }[]>;
}

export interface PublishedModule {
  readonly url: string;
  readonly code: string;
}

/** Publishes compiled modules where the service worker serves them from. */
export interface ModulePublisher {
  /** Replaces everything `namespace` published before with `modules`. */
  publish(namespace: string, modules: readonly PublishedModule[]): Promise<void>;
}

const pathOf = (url: string): string => new URL(url, "http://reify.invalid").pathname;

/** Keeps only a namespace's latest modules; files that were deleted stop resolving. */
export class ModuleStore implements ModulePublisher {
  constructor(private readonly cache: ModuleCache) {}

  async publish(namespace: string, modules: readonly PublishedModule[]): Promise<void> {
    const root = namespaceRoot(namespace);
    const published = new Set(modules.map((m) => pathOf(m.url)));
    const stale = (await this.cache.keys())
      .map((request) => pathOf(request.url))
      .filter((path) => path.startsWith(root) && !published.has(path));
    await Promise.all(stale.map((path) => this.cache.delete(path)));
    await Promise.all(
      modules.map((module) =>
        this.cache.put(
          pathOf(module.url),
          new Response(module.code, { headers: { "content-type": "text/javascript" } }),
        ),
      ),
    );
  }
}

/** The store over the browser's Cache API (available in dedicated workers). */
export const browserModuleStore: ModulePublisher = {
  publish: async (namespace, modules) =>
    new ModuleStore(await caches.open(MODULE_CACHE)).publish(namespace, modules),
};

/**
 * Where a project's compiled modules are served from. Modules import each other by url, and
 * a cycle cannot be expressed with one-off (blob) urls, so each module has a stable url
 * under `MODULE_ROOT`. A service worker answers those requests from the Cache API; nothing
 * else is ever served, and nothing is fetched from the network.
 *
 * Urls are stable across runs (a run's runtime worker is new, so it never sees a stale
 * module), which lets compiled modules be cached. They are namespaced per compiler worker,
 * so two open playgrounds never overwrite each other's modules.
 */
export const MODULE_ROOT = "/__reify/";
export const MODULE_CACHE = "reify-modules";
export const SERVICE_WORKER_PATH = "/reify-sw.js";

const encodePath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

/** The url prefix of everything one namespace serves. */
export const namespaceRoot = (namespace: string): string => `${MODULE_ROOT}${namespace}/`;

/** The url a project file's compiled module is served from. */
export const moduleUrl = (namespace: string, path: string): string =>
  `${namespaceRoot(namespace)}${encodePath(path)}`;

const ROOT_PATTERN = new RegExp(`${MODULE_ROOT}[^/]+/`, "g");

/** Shows an engine message (`… "/__reify/<namespace>/a.js" …`) with project paths. */
export const stripModuleRoot = (message: string): string => message.replace(ROOT_PATTERN, "");

/**
 * The service worker's script. It lives here, beside the constants it shares with the
 * runtime, and is served by the `/reify-sw.js` route.
 */
export const serviceWorkerSource = (): string => `
// Serves compiled project modules from the Cache API (generated; see moduleServer.ts).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(${JSON.stringify(MODULE_ROOT)})) return;
  event.respondWith(
    caches
      .open(${JSON.stringify(MODULE_CACHE)})
      .then((cache) => cache.match(url.pathname))
      .then((hit) => hit ?? new Response("Module not found", { status: 404 })),
  );
});
`;

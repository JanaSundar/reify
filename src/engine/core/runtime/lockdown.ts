/**
 * Best-effort removal of privileged capabilities from a worker global scope before user
 * code runs. This is defense in depth, NOT a security sandbox: see docs/security.md.
 */
export const BLOCKED_GLOBALS = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "WebSocketStream",
  "EventSource",
  "WebTransport",
  "importScripts",
  "indexedDB",
  "caches",
  "navigator",
  "postMessage",
  "close",
  "Worker",
  "SharedWorker",
  "BroadcastChannel",
  "MessageChannel",
  "Request",
  "Response",
  "setTimeout",
  "setInterval",
  "queueMicrotask",
  "requestAnimationFrame",
  "localStorage",
  "sessionStorage",
  "cookieStore",
  "crypto",
] as const;

/** Removes each blocked name from the global object and every prototype in its chain. */
export const lockdownGlobals = (scope: object = globalThis): void => {
  for (
    let target: object | null = scope;
    target && target !== Object.prototype;
    target = Object.getPrototypeOf(target)
  ) {
    for (const name of BLOCKED_GLOBALS) {
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      if (!descriptor) continue;
      if (descriptor.configurable) {
        delete (target as Record<string, unknown>)[name];
      } else if (descriptor.writable) {
        (target as Record<string, unknown>)[name] = undefined;
      }
    }
  }
};

import { SERVICE_WORKER_PATH } from "@/engine/core/project/moduleServer";

let starting: Promise<void> | null = null;

/**
 * Registers the service worker that serves compiled project modules and waits until it is
 * active. Runtime workers created afterwards fetch their modules through it. Safe to call
 * repeatedly; a failed start is retried next time.
 */
export const startModuleServer = (): Promise<void> => {
  if (!starting) {
    starting = (async () => {
      if (!("serviceWorker" in navigator))
        throw new Error("this browser does not support service workers.");
      await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: "/" });
      await navigator.serviceWorker.ready;
    })();
    starting.catch(() => (starting = null));
  }
  return starting;
};

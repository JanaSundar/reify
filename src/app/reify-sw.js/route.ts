import { serviceWorkerSource } from "@/engine/core/project/moduleServer";

/** The service worker that serves compiled project modules (see docs/multi-file-projects.md). */
export function GET() {
  return new Response(serviceWorkerSource(), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      // The browser re-checks the script on every load, so a new version is picked up at once.
      "Cache-Control": "no-cache",
    },
  });
}

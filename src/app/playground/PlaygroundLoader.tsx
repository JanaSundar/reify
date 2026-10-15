"use client";

import dynamic from "next/dynamic";

/** The workspace is browser-only (workers, CodeMirror); it is split out of the page bundle. */
const Workspace = dynamic(() => import("@/features/workspace/Workspace"), {
  ssr: false,
  loading: () => (
    <div className="grid h-dvh place-items-center text-sm text-muted" aria-busy="true">
      Loading the editor…
    </div>
  ),
});

export function PlaygroundLoader() {
  return <Workspace />;
}

import type { Metadata } from "next";
import { PyodideSpike } from "./PyodideSpike";

/** Pyodide spike page. Throwaway; not linked and not indexed. */
export const metadata: Metadata = {
  title: "Pyodide spike",
  robots: { index: false, follow: false },
};

export default function PyodideSpikePage() {
  return <PyodideSpike />;
}

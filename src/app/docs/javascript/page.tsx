import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SUPPORTED } from "@/content/supportedJavascript";

export const metadata: Metadata = {
  title: "Supported JavaScript and TypeScript",
  description:
    "Which JavaScript and TypeScript features the execution visualizer traces, which are executed but only partially traced, and which are rejected.",
  alternates: { canonical: "/docs/javascript" },
};

export default function SupportedJavaScriptPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-14 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight">
          Supported JavaScript and TypeScript
        </h1>
        <p className="mt-4 text-muted">
          The visualizer traces a deliberate subset of the language commonly used in data structure
          and algorithm solutions. Anything it cannot trace faithfully is either reported as only
          partially traced or rejected before running, never silently misrepresented.
        </p>
        {SUPPORTED.map((section) => (
          <section key={section.title} className="mt-10">
            <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted marker:text-faint">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
        <section className="mt-10">
          <h2 className="text-xl font-semibold tracking-tight">Replay versus re-execution</h2>
          <p className="mt-3 text-muted">
            Stepping backward and forward replays the recorded trace. Your program is not run again,
            so values from <code>Math.random()</code> or <code>Date.now()</code> stay exactly as
            they were during the run. Running again records a new trace.
          </p>
        </section>
        <Link
          href="/playground"
          className="press mt-12 inline-block rounded-lg bg-accent px-5 py-2.5 font-medium text-accent-fg hover:bg-accent-strong"
        >
          Try it in the playground
        </Link>
      </main>
    </>
  );
}

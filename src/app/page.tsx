import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { SiteHeader } from "@/components/SiteHeader";
import { SITE, absoluteUrl } from "@/lib/site";

const STEPS = [
  {
    title: "Write your own solution",
    body: "Paste or type any supported JavaScript or TypeScript. There are no templates to pick and no visualizations to configure.",
  },
  {
    title: "Run it once",
    body: "Your code is instrumented and executed in an isolated Web Worker. Every statement, call, branch and mutation is recorded.",
  },
  {
    title: "Step through history",
    body: "Move forward and backward through the recorded run. Playback replays the trace and never re-executes your program.",
  },
] as const;

const FEATURES = [
  [
    "Variables and scopes",
    "Every frame's bindings, what changed this step, and the previous value.",
  ],
  ["Arrays as cells", "Indexed cells with the slots written in the current step highlighted."],
  ["Objects, maps and sets", "Expandable views with stable identities, so aliasing is visible."],
  ["Call stack and recursion", "One frame per active call, with its arguments and return value."],
  [
    "Branches and loops",
    "Which condition was checked, whether it was true, and why a loop continued.",
  ],
  [
    "Errors and limits",
    "Exceptions point to the line that threw. Infinite loops are stopped, not frozen.",
  ],
] as const;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE.name,
  applicationCategory: "EducationalApplication",
  operatingSystem: "Any (web browser)",
  description: SITE.description,
  url: absoluteUrl("/"),
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 pt-20 pb-16 sm:px-6 sm:pt-28">
          <p className="text-sm font-medium text-accent">Execution visualizer for DSA practice</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            See how your code actually runs.
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-pretty text-muted">
            Stop simulating execution in your head. Run your own solution and inspect every step of
            the real execution: variables, arrays, objects, references, call stacks and recursion.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/playground"
              className="press rounded-lg bg-accent px-5 py-2.5 font-medium text-accent-fg hover:bg-accent-strong"
            >
              Open the playground
            </Link>
            <Link
              href="/docs/javascript"
              className="press rounded-lg border border-border px-5 py-2.5 font-medium hover:bg-surface-2"
            >
              What&apos;s supported
            </Link>
          </div>
        </section>

        <section aria-labelledby="how" className="border-t border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="how" className="text-2xl font-semibold tracking-tight">
              How it works
            </h2>
            <ol className="mt-8 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="rounded-xl border border-border bg-bg p-5">
                  <span className="font-mono text-sm text-faint">0{index + 1}</span>
                  <h3 className="mt-2 font-medium">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="inspect" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 id="inspect" className="text-2xl font-semibold tracking-tight">
            Everything is derived from the actual run
          </h2>
          <p className="mt-3 max-w-2xl text-muted">
            Visualizations are not tied to algorithm templates. A variable named <code>head</code>{" "}
            is not assumed to be a linked list: what you see is what your program built.
          </p>
          <dl className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(([title, body]) => (
              <div key={title}>
                <dt className="font-medium">{title}</dt>
                <dd className="mt-1 text-sm text-muted">{body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="private" className="border-t border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="private" className="text-2xl font-semibold tracking-tight">
              Runs in your browser
            </h2>
            <p className="mt-3 max-w-2xl text-muted">
              No account, no server-side execution and no AI service required. Your code is compiled
              and executed locally, in a worker that is discarded after every run.
            </p>
          </div>
        </section>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-faint sm:px-6">
          {SITE.name}: understand what your code does by watching it run.
        </div>
      </footer>
      <JsonLd data={jsonLd} />
    </>
  );
}

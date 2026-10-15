import {
  ArrowRight,
  Box,
  Code2,
  Columns2,
  Database,
  Globe,
  History,
  MonitorPlay,
  ScanEye,
  ShieldCheck,
  Sparkles,
  UserRoundX,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { GitHubIcon } from "@/components/BrandIcons";
import { buttonClass } from "@/components/buttonStyles";
import { JsonLd } from "@/components/JsonLd";
import { Reveal } from "@/components/Reveal";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { ExampleCards } from "@/features/landing/ExampleCards";
import { HeroVisual } from "@/features/landing/HeroVisual";
import { PlaygroundPreview } from "@/features/landing/PlaygroundPreview";
import { compilePreview } from "@/features/landing/previewProgram";
import { WorkspaceGraphic } from "@/features/landing/WorkspaceGraphic";
import { SITE, absoluteUrl } from "@/lib/site";

/** Compiled once at build time; the browser only runs and records it. */
const preview = compilePreview();

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

const HERO_BADGES: ReadonlyArray<{ icon: LucideIcon; label: string }> = [
  { icon: ScanEye, label: "Your real code, recorded" },
  { icon: MonitorPlay, label: "Runs in your browser" },
  { icon: UserRoundX, label: "No account needed" },
];

const FEATURES = [
  {
    icon: Box,
    title: "Visualize data structures",
    body: "See arrays, objects, Maps, Sets and more as they change.",
  },
  {
    icon: Workflow,
    title: "Follow execution flow",
    body: "Understand loops, conditions and function calls step by step.",
  },
  {
    icon: Database,
    title: "Explore memory and scope",
    body: "Inspect variable values, call stacks and how data moves.",
  },
] as const;

const PERSPECTIVES = [
  { icon: Columns2, title: "Split", body: "Code and visualization side by side." },
  { icon: Sparkles, title: "Visual", body: "Focus on execution and data flow." },
  { icon: Code2, title: "Code", body: "A clean editor with inline execution info." },
] as const;

const BUILT_STATS: ReadonlyArray<{
  icon: LucideIcon;
  title: string;
  body: string;
}> = [
  { icon: ScanEye, title: "Real execution", body: "Your code, not a simulation" },
  { icon: History, title: "Instant replay", body: "Scrub without re-running" },
  { icon: Globe, title: "Browser-based", body: "No installation required" },
  { icon: ShieldCheck, title: "Private", body: "Code never leaves your tab" },
];

function Kicker({ children }: { children: string }) {
  return (
    <p className="text-[11px] font-medium tracking-[0.22em] text-muted uppercase">{children}</p>
  );
}

const headline = "font-semibold tracking-[-0.045em] text-ink text-balance";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1 overflow-x-clip">
        {/* Hero */}
        <section className="mx-auto grid max-w-[1180px] items-center gap-6 px-5 pt-10 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
          <div>
            <Reveal from={{ y: 20 }} duration={0.6}>
              <Kicker>Understand code by seeing it</Kicker>
            </Reveal>
            <Reveal from={{ y: 40 }} delay={0.05}>
              <h1 className={`mt-5 text-[clamp(44px,6.2vw,76px)] leading-[0.98] ${headline}`}>
                See what happens <span className="text-ink/85">inside</span> your code.
              </h1>
            </Reveal>
            <Reveal from={{ y: 40 }} delay={0.15}>
              <p className="mt-6 max-w-[46ch] text-[17px] leading-relaxed text-pretty text-muted">
                Write code. Watch variables change, functions execute, and data transform — one step
                at a time.
              </p>
            </Reveal>
            <Reveal from={{ y: 30 }} delay={0.2}>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link href="/playground" className={buttonClass("primary", "lg")}>
                  Open Playground <ArrowRight size={16} />
                </Link>
                <Link href="#examples" className={buttonClass("secondary", "lg")}>
                  Explore Examples
                </Link>
              </div>
            </Reveal>
            <Reveal from={{ y: 20 }} delay={0.3}>
              <ul className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-[13px] text-muted">
                {HERO_BADGES.map(({ icon: Icon, label }) => (
                  <li key={label} className="flex items-center gap-2">
                    <Icon className="size-4 text-ink" />
                    {label}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
          <div className="flex justify-center lg:justify-end">
            <HeroVisual />
          </div>
        </section>

        {/* Playground preview */}
        <section
          aria-label="Playground preview"
          className="relative mx-auto max-w-[1180px] px-5 pt-14 sm:px-8"
        >
          <div aria-hidden className="haze absolute inset-x-0 top-20 h-[70%] opacity-50" />
          <Reveal from={{ y: 40, scale: 0.98 }} delay={0.4} duration={0.8} className="relative">
            <PlaygroundPreview preview={preview} />
          </Reveal>
        </section>

        {/* Features row */}
        <section aria-label="Features" className="mx-auto max-w-[1060px] px-5 pt-14 sm:px-8">
          <ul className="grid gap-8 md:grid-cols-3 md:gap-0">
            {FEATURES.map(({ icon: Icon, title, body }, index) => (
              <li
                key={title}
                className={`md:px-8 ${index > 0 ? "md:border-l md:border-border" : "md:pl-0"}`}
              >
                <Reveal delay={index * 0.1} className="flex gap-4">
                  <Reveal from={{ scale: 0.8 }} delay={index * 0.1 + 0.1} duration={0.5}>
                    <Icon size={30} strokeWidth={1.4} className="text-ink" />
                  </Reveal>
                  <div>
                    <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{body}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
        </section>

        {/* Examples */}
        <section
          id="examples"
          aria-labelledby="examples-heading"
          className="mx-auto mt-28 max-w-[1180px] scroll-mt-24 px-5 sm:px-8"
        >
          <div className="mx-auto max-w-[1060px]">
            <Reveal className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <Kicker>Interactive examples</Kicker>
                <h2
                  id="examples-heading"
                  className={`mt-3 text-[clamp(32px,4vw,44px)] leading-[1.05] ${headline}`}
                >
                  Try it yourself.
                </h2>
                <p className="mt-3 text-[16px] text-muted">
                  Explore real examples and see how code comes to life.
                </p>
              </div>
              <Link
                href="/playground"
                className="group inline-flex items-center gap-1.5 text-[14px] font-medium text-accent"
              >
                View all examples
                <ArrowRight
                  size={15}
                  className="transition-transform duration-200 group-hover:translate-x-0.5"
                />
              </Link>
            </Reveal>
            <div className="relative mt-10">
              {/* Colour for the glass cards to pick up. */}
              <div
                aria-hidden
                className="haze pointer-events-none absolute -inset-x-10 -inset-y-16 opacity-80"
              />
              <ExampleCards />
            </div>
          </div>
        </section>

        {/* One workspace */}
        <section
          aria-labelledby="workspace-heading"
          className="mx-auto mt-32 grid max-w-[1180px] items-center gap-12 px-5 sm:px-8 lg:grid-cols-[1.15fr_1fr]"
        >
          <WorkspaceGraphic />
          <Reveal from={{ x: 40 }}>
            <Kicker>A better way to learn and debug</Kicker>
            <h2
              id="workspace-heading"
              className={`mt-4 text-[clamp(32px,4vw,46px)] leading-[1.04] ${headline}`}
            >
              One workspace.
              <br />
              Three perspectives.
            </h2>
            <p className="mt-4 max-w-[44ch] text-[16px] leading-relaxed text-muted">
              Switch between code, visualizations, and a split view. Everything stays in sync.
            </p>
            <ul className="mt-8 flex flex-col gap-6">
              {PERSPECTIVES.map(({ icon: Icon, title, body }, index) => (
                <li key={title}>
                  <Reveal
                    delay={0.1 + index * 0.08}
                    from={{ x: 20 }}
                    className="flex items-center gap-4"
                  >
                    <span className="grid size-9 place-items-center rounded-lg text-ink shadow-[inset_0_0_0_1px_var(--border-strong)]">
                      <Icon size={18} strokeWidth={1.6} />
                    </span>
                    <div>
                      <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
                      <p className="text-[13.5px] text-muted">{body}</p>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        {/* Built for understanding */}
        <section
          aria-labelledby="built-heading"
          className="relative mx-auto mt-32 grid max-w-[1180px] items-center gap-10 px-5 sm:px-8 lg:grid-cols-[0.7fr_1.3fr]"
        >
          <Reveal from={{ y: 50 }} duration={0.9} className="relative h-[280px]" aria-hidden>
            <div className="haze absolute inset-0" />
            <div className="animate-float-slow absolute inset-0 [perspective:1200px]">
              <div className="absolute inset-[10%_20%_10%_10%] [transform:rotateY(-30deg)_rotateX(10deg)] [transform-style:preserve-3d]">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="glass-sheet absolute inset-0 rounded-3xl"
                    style={{
                      transform: `translate3d(${i * 34}px, ${i * -10}px, ${i * 30}px)`,
                      opacity: 0.45 + i * 0.15,
                    }}
                  />
                ))}
              </div>
            </div>
          </Reveal>
          <div>
            <Reveal>
              <Kicker>Built for understanding</Kicker>
              <h2
                id="built-heading"
                className={`mt-4 text-[clamp(32px,4vw,46px)] leading-[1.04] ${headline}`}
              >
                Runs your real code.
                <br />
                Designed for clarity.
              </h2>
              <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-muted">
                reify instruments your JavaScript or TypeScript, runs it in a sandboxed worker in
                your browser and records every step, so you can replay it forwards and backwards
                without running it again.
              </p>
            </Reveal>
            <ul className="mt-10 grid grid-cols-2 gap-x-5 gap-y-6 xl:grid-cols-4">
              {BUILT_STATS.map(({ icon: Icon, title, body }, index) => (
                <li key={title}>
                  <Reveal delay={index * 0.08} from={{ y: 20 }} className="flex gap-2.5">
                    <Icon className="mt-0.5 size-5 shrink-0 text-ink" />
                    <div>
                      <p className="text-[13px] font-semibold text-ink">{title}</p>
                      <p className="text-[12px] text-muted">{body}</p>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* CTA */}
        <section className="relative mx-auto max-w-[1180px] px-5 pt-32 pb-16 sm:px-8">
          <div
            aria-hidden
            className="animate-float-slow absolute right-0 bottom-0 size-64 rounded-full bg-[radial-gradient(circle_at_35%_35%,color-mix(in_srgb,var(--violet)_35%,transparent),transparent_70%)] opacity-60"
          />
          <Reveal
            from={{ y: 30, scale: 0.98 }}
            className="relative overflow-hidden rounded-3xl bg-[#0d0d12] px-8 py-14 text-white sm:px-14"
          >
            <div
              aria-hidden
              className="absolute inset-0 bg-[radial-gradient(60%_80%_at_85%_100%,rgb(124_92_240/0.35),transparent_70%),radial-gradient(40%_60%_at_100%_0%,rgb(58_109_240/0.25),transparent_70%)]"
            />
            <div className="relative flex flex-col gap-10 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[11px] font-medium tracking-[0.22em] text-white/60 uppercase">
                  Ready to explore?
                </p>
                <h2 className="mt-4 text-[clamp(34px,4.4vw,52px)] leading-[1.02] font-semibold tracking-[-0.045em]">
                  Stop guessing.
                  <br />
                  Start seeing.
                </h2>
              </div>
              <div className="max-w-[300px]">
                <p className="text-[14px] leading-relaxed text-white/75">
                  Open the playground and experience code in a whole new way.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    href="/playground"
                    className="press inline-flex h-11 items-center gap-2 rounded-lg bg-white px-5 text-[14px] font-medium text-[#0d0d12] transition-shadow hover:shadow-[0_0_24px_rgb(169_144_255/0.55)]"
                  >
                    Open Playground <ArrowRight size={15} />
                  </Link>
                  <a
                    href={SITE.github}
                    target="_blank"
                    rel="noreferrer"
                    className="press inline-flex h-11 items-center gap-2 rounded-lg px-5 text-[14px] font-medium text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.25)] transition-colors hover:bg-white/10"
                  >
                    <GitHubIcon className="size-4" /> View on GitHub
                  </a>
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      </main>
      <SiteFooter />
      <JsonLd data={jsonLd} />
    </>
  );
}

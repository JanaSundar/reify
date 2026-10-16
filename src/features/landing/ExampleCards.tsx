import { ArrowRight, Braces, Brackets, SquareFunction, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Reveal } from "@/components/Reveal";
import { ArrayCells, TypeTag } from "@/components/viz/ArrayCells";
import { MiniCode } from "./MiniCode";
import { TONE } from "@/components/tones";

interface CardProps {
  readonly exampleId: string;
  readonly icon: LucideIcon;
  readonly iconClass: string;
  readonly title: string;
  readonly summary: string;
  readonly code: string;
  readonly children: ReactNode;
  readonly delay: number;
}

function ExampleCard({
  exampleId,
  icon: Icon,
  iconClass,
  title,
  summary,
  code,
  children,
  delay,
}: CardProps) {
  return (
    <Reveal delay={delay} from={{ y: 40, scale: 0.95 }} className="h-full">
      <Link
        href={`/playground?example=${exampleId}`}
        className="glass lift group flex h-full flex-col rounded-2xl p-5"
      >
        <div className="flex items-start gap-3">
          <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${iconClass}`}>
            <Icon size={15} strokeWidth={2} />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
            <p className="mt-0.5 text-[13px] text-muted">{summary}</p>
          </div>
        </div>
        <div className="glass-pane mt-4 rounded-xl py-2 transition-colors duration-300 ease-out group-hover:bg-accent-soft">
          <MiniCode code={code} numbers={false} className="px-3 text-[11.5px] leading-[22px]" />
        </div>
        <div className="mt-4 flex-1">{children}</div>
        <span className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent">
          Open Example
          <ArrowRight
            size={14}
            className="transition-transform duration-300 ease-out group-hover:translate-x-1"
          />
        </span>
      </Link>
    </Reveal>
  );
}

function Labeled({ type, name, children }: { type: string; name: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[56px_1fr] items-end gap-3">
      <div className="flex flex-col gap-0.5 pb-2">
        <TypeTag>{type}</TypeTag>
        <span className="font-mono text-[12px] font-semibold text-ink">{name}</span>
      </div>
      {children}
    </div>
  );
}

function ArrayExample() {
  return (
    <div className="flex flex-col gap-2">
      <Labeled type="Array" name="nums">
        <ArrayCells cells={[1, 2, 3, 4]} size="sm" />
      </Labeled>
      <div className="flex flex-col items-center pl-14">
        <span className="h-3 w-px bg-accent/50" />
        <span
          className={`rounded-md px-2.5 py-0.5 font-mono text-[11px] text-violet ${TONE.violet}`}
        >
          map(n =&gt; n * n)
        </span>
        <span className="h-3 w-px bg-accent/50" />
      </div>
      <Labeled type="Array" name="squared">
        <ArrayCells cells={[1, 4, 9, 16]} size="sm" tone="violet" />
      </Labeled>
    </div>
  );
}

function CallStackExample() {
  const frames = [
    { label: "add(a, b)", detail: "a = 5, b = 3", tone: "violet" },
    { label: "(return)", detail: "8", tone: "plain" },
    { label: "result", detail: "8", tone: "plain" },
  ] as const;
  return (
    <div className="rounded-xl p-3 edge">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
        <span className="size-2.5 rounded-full border-[1.5px] border-ink" /> Call Stack
      </p>
      <ol className="relative mt-3 flex flex-col gap-2 pl-5">
        <span aria-hidden className="absolute top-2 bottom-2 left-[5px] w-px bg-accent/40" />
        {frames.map((frame, index) => (
          <li key={frame.label} className="relative">
            <span
              aria-hidden
              className={`absolute top-3 -left-[19px] size-[9px] rounded-full border-2 border-accent ${
                index === 0 ? "bg-accent" : "bg-surface"
              }`}
            />
            <div
              className={`rounded-lg px-3 py-1.5 font-mono text-[11px] ${
                frame.tone === "violet" ? `${TONE.violet} text-violet` : "text-text edge"
              }`}
            >
              <p>{frame.label}</p>
              <p className="text-muted">{frame.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ReferenceExample() {
  return (
    <div className="flex flex-col items-center">
      <div className="grid w-full grid-cols-2 gap-4">
        {["user", "admin"].map((name) => (
          <div key={name} className="flex flex-col gap-1.5">
            <span className="font-mono text-[12px] font-semibold text-ink">{name}</span>
            <div className="rounded-lg bg-[color-mix(in_srgb,var(--val-type)_8%,transparent)] px-3 py-2 font-mono text-[11px] leading-5 text-text shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--val-type)_30%,transparent)]">
              {"{"}
              <br />
              &nbsp;&nbsp;name:{" "}
              <span className="text-[var(--val-string)]">&apos;Developer&apos;</span>
              <br />
              {"}"}
            </div>
          </div>
        ))}
      </div>
      <svg viewBox="0 0 200 30" className="h-7 w-2/3 text-accent/60" aria-hidden>
        <path d="M30 0 V12 Q30 18 40 18 H160 Q170 18 170 12 V0" fill="none" stroke="currentColor" />
        <path d="M100 18 V30" stroke="currentColor" />
      </svg>
      <span className="rounded-md bg-accent-soft px-3 py-1 text-center font-mono text-[11px] leading-4 text-accent edge-blue">
        Same reference
        <br />
        in memory
      </span>
    </div>
  );
}

/** The "Try it yourself" cards; each opens the matching example in the playground. */
export function ExampleCards() {
  return (
    <div className="relative grid gap-5 md:grid-cols-3">
      <ExampleCard
        exampleId="array-map"
        icon={Brackets}
        iconClass="bg-accent-soft text-accent"
        title="Array transformation"
        summary="See how map, filter and reduce work."
        code={"const nums = [1, 2, 3, 4];\nconst squared = nums.map(n => n * n);"}
        delay={0}
      >
        <ArrayExample />
      </ExampleCard>
      <ExampleCard
        exampleId="fibonacci"
        icon={SquareFunction}
        iconClass="bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-success"
        title="Function calls"
        summary="Step through function execution."
        code={"function add(a, b) {\n  return a + b;\n}\nconst result = add(5, 3);"}
        delay={0.08}
      >
        <CallStackExample />
      </ExampleCard>
      <ExampleCard
        exampleId="object-reference"
        icon={Braces}
        iconClass="bg-[color-mix(in_srgb,var(--val-type)_14%,transparent)] text-[var(--val-type)]"
        title="Objects & references"
        summary="Understand memory and references."
        code={"const user = { name: 'Jana' };\nconst admin = user;\n\nadmin.name = 'Developer';"}
        delay={0.16}
      >
        <ReferenceExample />
      </ExampleCard>
    </div>
  );
}

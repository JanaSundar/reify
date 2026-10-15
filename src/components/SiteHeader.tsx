import Link from "next/link";
import { SITE } from "@/lib/site";

const NAV = [
  { href: "/playground", label: "Playground" },
  { href: "/docs/javascript", label: "Supported JavaScript" },
] as const;

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6"
      >
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden
            className="grid size-6 place-items-center rounded-md bg-accent text-xs text-accent-fg"
          >
            {"{}"}
          </span>
          {SITE.name}
        </Link>
        <ul className="flex items-center gap-1 text-sm">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="rounded-md px-3 py-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

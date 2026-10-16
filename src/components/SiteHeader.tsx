"use client";

import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SITE } from "@/lib/site";
import { buttonClass } from "./buttonStyles";
import { GitHubIcon } from "./BrandIcons";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { easeOut } from "@/components/motion";

export const NAV = [{ href: "/playground", label: "Playground" }] as const;

/**
 * The one site header, shared by the landing page and the playground. `page` is sticky and
 * centred (transparent at the top, frosted once scrolled); `app` spans the full width with a
 * hairline under it. Links, theme toggle and active-link underline are identical.
 */
export function SiteHeader({ variant = "page" }: { variant?: "page" | "app" }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const app = variant === "app";

  useEffect(() => {
    if (app) return;
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [app]);

  return (
    <header
      className={app ? "shrink-0 border-b border-border bg-bg" : "site-nav sticky top-0 z-30"}
      data-scrolled={scrolled}
    >
      <nav
        aria-label="Main"
        className={`flex h-16 items-center gap-10 ${app ? "px-5" : "mx-auto max-w-[1180px] px-5 sm:px-8"}`}
      >
        <Logo />
        <ul className="hidden h-full items-stretch gap-8 text-[14px] md:flex">
          {NAV.map((item, index) => {
            const active = pathname === item.href;
            return (
              <motion.li
                key={item.label}
                className="relative flex items-center"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={easeOut(0.4, 0.1 + index * 0.05)}
              >
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-1.5 transition-colors hover:text-ink ${active ? "font-medium text-ink" : "text-muted"}`}
                >
                  {item.label}
                </Link>
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-3 h-[2px] rounded-full bg-ink"
                  />
                )}
              </motion.li>
            );
          })}
        </ul>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          {pathname !== "/playground" && (
            <Link href="/playground" className={buttonClass("primary", "md")}>
              Open Playground <ArrowRight size={15} />
            </Link>
          )}
          <a
            href={SITE.github}
            target="_blank"
            rel="noreferrer"
            aria-label="reify on GitHub"
            title="reify on GitHub"
            className="press grid size-9 place-items-center rounded-full text-muted transition-colors hover:text-ink"
          >
            <GitHubIcon className="size-[18px]" />
          </a>
        </div>
      </nav>
    </header>
  );
}

const FOOTER_LINKS = NAV;

export function SiteFooter() {
  return (
    <motion.footer
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
      transition={easeOut(0.6)}
      className="mt-auto"
    >
      {/* Three equal-width outer columns keep the credit exactly centred. */}
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-10 text-[13px] text-muted sm:px-8 md:grid md:grid-cols-[1fr_auto_1fr] md:items-center">
        <div className="flex items-center gap-6">
          <Logo />
          <p>{SITE.tagline}</p>
        </div>
        <p className="md:text-center">
          Made by{" "}
          <a
            href={SITE.author.url}
            target="_blank"
            rel="author noreferrer"
            className="font-medium text-ink underline decoration-border-strong underline-offset-4 transition-colors hover:decoration-ink"
          >
            {SITE.author.name}
          </a>
        </p>
        <nav aria-label="Footer" className="flex items-center gap-6 md:justify-self-end">
          <ul className="flex flex-wrap gap-x-8 gap-y-2">
            {FOOTER_LINKS.map((link) => (
              <li key={link.label}>
                <Link href={link.href} className="transition-colors hover:text-ink">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <a
            href={SITE.github}
            target="_blank"
            rel="noreferrer"
            aria-label="reify on GitHub"
            className="press block text-ink opacity-80 transition-opacity hover:opacity-100"
          >
            <GitHubIcon className="size-[18px]" />
          </a>
        </nav>
      </div>
    </motion.footer>
  );
}

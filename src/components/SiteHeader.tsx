"use client";

import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SITE } from "@/lib/site";
import { buttonClass } from "./buttonStyles";
import { GitHubIcon, DiscordIcon, XIcon } from "./BrandIcons";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

export const NAV = [
  { href: "/playground", label: "Playground" },
  { href: SITE.github, label: "GitHub", external: true },
] as const;

const EASE = [0.23, 1, 0.32, 1] as const;

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
            const active = !("external" in item) && pathname === item.href;
            return (
              <motion.li
                key={item.label}
                className="relative flex items-center"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + index * 0.05, ease: EASE }}
              >
                <Link
                  href={item.href}
                  {...("external" in item ? { target: "_blank", rel: "noreferrer" } : {})}
                  aria-current={active ? "page" : undefined}
                  className={`transition-colors hover:text-ink ${active ? "font-medium text-ink" : "text-muted"}`}
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
      transition={{ duration: 0.6, ease: EASE }}
      className="mt-auto"
    >
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center">
        <div className="flex items-center gap-6">
          <Logo />
          <p className="text-[13px] text-muted">{SITE.tagline}</p>
        </div>
        <nav aria-label="Footer" className="md:mx-auto">
          <ul className="flex flex-wrap gap-x-8 gap-y-2 text-[13px] text-muted">
            {FOOTER_LINKS.map((link) => (
              <li key={link.label}>
                <Link href={link.href} className="transition-colors hover:text-ink">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <ul className="flex items-center gap-4 text-ink">
          {[
            { href: SITE.x, label: "X", Icon: XIcon },
            { href: SITE.github, label: "GitHub", Icon: GitHubIcon },
            { href: SITE.discord, label: "Discord", Icon: DiscordIcon },
          ].map(({ href, label, Icon }) => (
            <li key={label}>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={label}
                className="press block opacity-80 transition-opacity hover:opacity-100"
              >
                <Icon className="size-[18px]" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </motion.footer>
  );
}

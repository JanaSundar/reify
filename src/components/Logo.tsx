import Image from "next/image";
import Link from "next/link";
import { SITE } from "@/lib/site";

/** The official full logo (852 × 263), one file per theme. */
const LOGO_RATIO = 852 / 263;

/**
 * The reify logo, linking home. Both theme variants are rendered and CSS shows the one that
 * matches the active theme (see `.theme-light-only` / `.theme-dark-only` in globals.css), so
 * it never flashes the wrong variant before hydration.
 */
export function Logo({ height = 26 }: { height?: number }) {
  const width = Math.round(height * LOGO_RATIO);
  return (
    <Link
      href="/"
      aria-label={`${SITE.name} home`}
      className="site-logo flex shrink-0 items-center transition-opacity hover:opacity-80"
    >
      <Image
        src="/brand/reify-logo-light.svg"
        alt=""
        width={width}
        height={height}
        unoptimized
        preload
        className="theme-light-only"
      />
      <Image
        src="/brand/reify-logo-dark.svg"
        alt=""
        width={width}
        height={height}
        unoptimized
        preload
        className="theme-dark-only"
      />
    </Link>
  );
}

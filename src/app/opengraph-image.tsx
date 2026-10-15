import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

/** The share image for every page: the logo, centred on a dark background. */
export const alt = SITE.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The official dark-theme logo, rasterized by `pnpm icons` (read once at build time). */
const logo = `data:image/png;base64,${await readFile(
  join(process.cwd(), "public/brand/reify-logo-dark.png"),
  "base64",
)}`;

/** Logo aspect ratio of the official artwork (852 × 263). */
const LOGO_WIDTH = 480;
const LOGO_HEIGHT = Math.round((LOGO_WIDTH * 263) / 852);

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0d",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse needs <img> */}
      <img src={logo} width={LOGO_WIDTH} height={LOGO_HEIGHT} alt="" />
    </div>,
    size,
  );
}

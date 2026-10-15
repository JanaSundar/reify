import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

export const alt = SITE.title;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The official dark-theme logo, rasterized by `pnpm icons` (read once at build time). */
const logo = `data:image/png;base64,${await readFile(
  join(process.cwd(), "public/brand/reify-logo-dark.png"),
  "base64",
)}`;

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 80,
        background: "#0a0a0d",
        color: "#f5f1e8",
        fontSize: 64,
        fontWeight: 600,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse needs <img> */}
      <img src={logo} width={260} height={80} alt="" />
      <div style={{ marginTop: 40, maxWidth: 900 }}>See what happens inside your code.</div>
      <div style={{ marginTop: 24, fontSize: 30, color: "#a8a39a", maxWidth: 900 }}>
        Write code. Watch variables change, functions execute, and data transform — one step at a
        time.
      </div>
    </div>,
    size,
  );
}

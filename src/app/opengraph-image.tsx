import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

export const alt = SITE.title;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
        background: "#0b0d10",
        color: "#e6e9ee",
        fontSize: 64,
        fontWeight: 600,
      }}
    >
      <div style={{ color: "#5eead4", fontSize: 32 }}>{SITE.name}</div>
      <div style={{ marginTop: 24, maxWidth: 900 }}>See how your code actually runs.</div>
      <div style={{ marginTop: 24, fontSize: 30, color: "#8b94a3", maxWidth: 900 }}>
        Step through variables, arrays, objects and recursion from the real execution.
      </div>
    </div>,
    size,
  );
}

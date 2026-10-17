import { describe, expect, it } from "vitest";
import { edgeFadeMask } from "@/hooks/useHorizontalScroll";

describe("edge fade mask", () => {
  it("is absent when nothing is hidden", () => {
    expect(edgeFadeMask({ before: false, after: false })).toBeUndefined();
  });

  it("fades only the ends that hide content", () => {
    expect(edgeFadeMask({ before: false, after: true })).toBe(
      "linear-gradient(to right, #000, #000 0, #000 calc(100% - 24px), transparent)",
    );
    expect(edgeFadeMask({ before: true, after: false })).toBe(
      "linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 0px), #000)",
    );
  });
});

"use client";

import { useEffect, useState, type RefObject } from "react";

export interface ScrollEdges {
  /** Content is hidden to the left. */
  readonly before: boolean;
  /** Content is hidden to the right. */
  readonly after: boolean;
}

const NONE: ScrollEdges = { before: false, after: false };

/** Which ends of a horizontally scrolling element hide content (1px slack for rounding). */
const edgesOf = (el: HTMLElement): ScrollEdges => ({
  before: el.scrollLeft > 1,
  after: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
});

const FADE = "24px";

/** A mask that fades the ends of a row where content is hidden (none when nothing is). */
export const edgeFadeMask = ({ before, after }: ScrollEdges): string | undefined =>
  before || after
    ? `linear-gradient(to right, ${before ? "transparent" : "#000"}, #000 ${before ? FADE : "0"}, #000 calc(100% - ${after ? FADE : "0px"}), ${after ? "transparent" : "#000"})`
    : undefined;

/**
 * Makes a row scroll sideways with an ordinary mouse wheel (vertical wheel → horizontal
 * scroll; trackpads already scroll sideways) and reports which ends hide content, so the
 * row can fade them instead of showing a scrollbar.
 */
export const useHorizontalScroll = (ref: RefObject<HTMLElement | null>): ScrollEdges => {
  const [edges, setEdges] = useState<ScrollEdges>(NONE);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setEdges((prev) => {
        const next = edgesOf(el);
        return prev.before === next.before && prev.after === next.after ? prev : next;
      });
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY))
        return;
      event.preventDefault(); // the page should not scroll while the row does
      el.scrollLeft += event.deltaY;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    const resize = new ResizeObserver(update);
    resize.observe(el);
    const children = new MutationObserver(update);
    children.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", onWheel);
      resize.disconnect();
      children.disconnect();
    };
  }, [ref]);

  return edges;
};

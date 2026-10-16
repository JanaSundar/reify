/**
 * The reify R, in the 78 × 96 box at (8, 7) that `public/brand/reify-mark-*.svg` use.
 * Drawn in `currentColor` so the caller picks the colour; render it inside an <svg>.
 */
export function MarkShape() {
  return (
    <>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={16}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 88V30C20 21 27 17 34 21L62 39" />
        <path d="M45 66L72 90" />
      </g>
      <circle cx={66} cy={42} r={15} fill="currentColor" />
    </>
  );
}

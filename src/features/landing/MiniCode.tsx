const TOKENS =
  /(\/\/.*$|`[^`]*`|"[^"]*"|'[^']*'|\b(?:const|let|var|function|return|for|if|else|new)\b|\b\d+\b|=>)/g;

const tokenClass = (token: string): string => {
  if (token.startsWith("//")) return "text-faint";
  if (/^["'`]/.test(token)) return "text-[var(--val-string)]";
  if (/^\d/.test(token)) return "text-violet";
  return "text-accent";
};

/** Lightweight syntax colouring for static code samples (keywords, numbers, strings). */
export function CodeText({ text }: { text: string }) {
  const parts = text.split(TOKENS);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className={tokenClass(part)}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

interface MiniCodeProps {
  readonly code: string;
  /** 1-based line to highlight. */
  readonly active?: number | null;
  readonly numbers?: boolean;
  readonly className?: string;
}

/** A static code block with optional line numbers and an active-line highlight. */
export function MiniCode({ code, active = null, numbers = true, className = "" }: MiniCodeProps) {
  return (
    <ol className={`font-mono text-[12.5px] leading-[26px] text-text ${className}`}>
      {code.split("\n").map((line, index) => {
        const current = active === index + 1;
        return (
          <li
            key={index}
            className={`relative flex rounded-md pr-3 transition-colors duration-300 ${
              current ? "bg-accent-soft" : ""
            }`}
          >
            {numbers && (
              <span
                className={`w-9 shrink-0 pr-4 text-right select-none ${current ? "text-accent" : "text-faint"}`}
              >
                {index + 1}
              </span>
            )}
            {current && numbers && (
              <span
                aria-hidden
                className="absolute top-1/2 left-0 size-0 -translate-y-1/2 border-y-[5px] border-l-[7px] border-y-transparent border-l-accent"
              />
            )}
            <span className="whitespace-pre">
              <CodeText text={line} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

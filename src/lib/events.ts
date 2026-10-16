/** A click handler that runs `handler` without letting the click reach enclosing elements. */
export const isolated =
  (handler: () => void) =>
  (event: { stopPropagation(): void }): void => {
    event.stopPropagation();
    handler();
  };

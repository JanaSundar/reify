/**
 * Saves `text` as a file. The link is attached to the page while it is clicked, and the object
 * URL outlives the click: browsers that fetch lazily (Firefox, Safari, embedded webviews)
 * cancel the download if the URL is revoked straight away.
 */
export const downloadText = (name: string, text: string, type: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = Object.assign(document.createElement("a"), {
    href: url,
    download: name,
    hidden: true,
  });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
};

const REVOKE_DELAY_MS = 10_000;

/** Copies text to the clipboard; resolves to whether it worked (blocked in some contexts). */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall back to a hidden textarea for pages without clipboard permission.
    const area = Object.assign(document.createElement("textarea"), { value: text });
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
};

import { DEFAULT_LANGUAGE_ID, findLanguage } from "@/engine/languages/catalog";

export interface Draft {
  readonly languageId: string;
  readonly source: string;
}

const STORAGE_KEY = "learncode:draft:v1";

export const STARTER_SOURCE = `// Write your own solution, then press Run (Ctrl+Enter).
function twoSum(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) return [seen.get(need), i];
    seen.set(nums[i], i);
  }
  return null;
}

console.log(twoSum([2, 7, 11, 15], 18));
`;

const STARTER: Draft = { languageId: DEFAULT_LANGUAGE_ID, source: STARTER_SOURCE };

/** The editor draft persists per browser; storage failures fall back to the starter. */
export const loadDraft = (): Draft => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return STARTER;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (typeof parsed.source !== "string" || !findLanguage(parsed.languageId ?? "")) return STARTER;
    return { languageId: parsed.languageId!, source: parsed.source };
  } catch {
    return STARTER;
  }
};

export const saveDraft = (draft: Draft): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage may be unavailable (private mode, quota); the draft just isn't kept.
  }
};

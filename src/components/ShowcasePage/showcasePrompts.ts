/**
 * Showcase prompt catalogs by workload type.
 * Canonical lists live in src/shared/llmPrompts.js (also used by Decode bench).
 */

import type { TFunction } from "i18next";

export type ShowcasePromptType = "structural" | "text" | "mixed";

export const PROMPT_TYPES: readonly ShowcasePromptType[] = ["text", "structural", "mixed"];

/** Name and one-line description of a prompt type, for the picker (the prompts themselves stay as written). */
export function promptTypeText(t: TFunction<"showcase">, id: ShowcasePromptType): { label: string; hint: string } {
  switch (id) {
    case "text":
      return { label: t("promptType.text"), hint: t("promptType.textHint") };
    case "structural":
      return { label: t("promptType.structural"), hint: t("promptType.structuralHint") };
    default:
      return { label: t("promptType.mixed"), hint: t("promptType.mixedHint") };
  }
}

export {
  TEXT_PROMPTS,
  STRUCTURAL_PROMPTS,
  pickShowcasePrompts,
  withFillToMaxInstruction,
} from "../../shared/llmPrompts.js";

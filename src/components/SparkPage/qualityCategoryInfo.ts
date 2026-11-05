import type { TFunction } from "i18next";
import type { QualityCategory } from "../../api/types";

/** Plain-language explanation of one Quality category, shown under "How it works". */
export interface QualityCategoryInfo {
  /** What a good score says about the model. */
  measures: string;
  /** What is sent and how. */
  how: string;
  /** How a reply becomes pass / fail. */
  scoring: string;
  /** A prompt of the kind the category sends (shortened where the real ones are long). */
  example: string;
  /** Run settings and rough cost. */
  settings: string;
}

/**
 * Example prompts, in the shape the category really sends. They are model input, so they stay in
 * English in every UI language (translating them would misstate what the model is asked).
 */
const EXAMPLES: Record<Exclude<QualityCategory, "gsm8k">, string> = {
  qa: "What is 17 * 23?",
  reason: "Ana has 40 apples. Ben has 3 times as many as Ana. Cy has 12 … How many are in the jar, and how many in each box? End with 'Answer: <jar>, <per box>'.",
  arith: "Start with 482. Then, in order: (1) multiply it by 7; (2) add 1530; … (10) divide it by 4, rounding down. What is the final number?",
  track: "Track the tokens carefully. Mia starts with 34 tokens. … Mia gives 5 to Leo. Leo finds 3. … How many tokens does Leo have at the end?",
  mmlu: "The following is a multiple choice question about astronomy. … A. … B. … C. … D. … Reply with the letter of the correct answer.",
  follow: "Write a short piece about how bees make honey. 1. Use exactly 4 bullet points, each starting with “* ”. 2. Do not use any commas.",
  long: "… Remember this: the code for otter is 48213. … Correction: the code for otter has changed, it is now 90471. … What is the current code for every animal?",
};
const GSM8K_PROMPT_TAIL = "Solve it step by step. End with 'Answer: <number>'.";

/** Display name of a Quality category in the current language. */
export function qualityCategoryLabel(t: TFunction<"quality">, cat: QualityCategory): string {
  switch (cat) {
    case "qa":
      return t("cat.qa");
    case "reason":
      return t("cat.reason");
    case "arith":
      return t("cat.arith");
    case "track":
      return t("cat.track");
    case "gsm8k":
      return t("cat.gsm8k");
    case "mmlu":
      return t("cat.mmlu");
    case "follow":
      return t("cat.follow");
    case "long":
      return t("cat.long");
    default:
      return String(cat);
  }
}

/** One-line hint shown on a category's selection card. */
export function qualityCategoryHint(t: TFunction<"quality">, cat: QualityCategory): string {
  switch (cat) {
    case "qa":
      return t("hint.qa");
    case "reason":
      return t("hint.reason");
    case "arith":
      return t("hint.arith");
    case "track":
      return t("hint.track");
    case "gsm8k":
      return t("hint.gsm8k");
    case "mmlu":
      return t("hint.mmlu");
    case "follow":
      return t("hint.follow");
    case "long":
      return t("hint.long");
    default:
      return "";
  }
}

/** The "How it works" panel text of one category in the current language. */
export function qualityCategoryInfo(t: TFunction<"quality">, cat: QualityCategory): QualityCategoryInfo {
  switch (cat) {
    case "qa":
      return {
        measures: t("info.qa.measures"),
        how: t("info.qa.how"),
        scoring: t("info.qa.scoring"),
        example: EXAMPLES.qa,
        settings: t("info.qa.settings"),
      };
    case "reason":
      return {
        measures: t("info.reason.measures"),
        how: t("info.reason.how"),
        scoring: t("info.reason.scoring"),
        example: EXAMPLES.reason,
        settings: t("info.reason.settings"),
      };
    case "arith":
      return {
        measures: t("info.arith.measures"),
        how: t("info.arith.how"),
        scoring: t("info.arith.scoring"),
        example: EXAMPLES.arith,
        settings: t("info.arith.settings"),
      };
    case "track":
      return {
        measures: t("info.track.measures"),
        how: t("info.track.how"),
        scoring: t("info.track.scoring"),
        example: EXAMPLES.track,
        settings: t("info.track.settings"),
      };
    case "gsm8k":
      return {
        measures: t("info.gsm8k.measures"),
        how: t("info.gsm8k.how"),
        scoring: t("info.gsm8k.scoring"),
        example: t("info.gsm8k.example", { prompt: GSM8K_PROMPT_TAIL }),
        settings: t("info.gsm8k.settings"),
      };
    case "mmlu":
      return {
        measures: t("info.mmlu.measures"),
        how: t("info.mmlu.how"),
        scoring: t("info.mmlu.scoring"),
        example: EXAMPLES.mmlu,
        settings: t("info.mmlu.settings"),
      };
    case "follow":
      return {
        measures: t("info.follow.measures"),
        how: t("info.follow.how"),
        scoring: t("info.follow.scoring"),
        example: EXAMPLES.follow,
        settings: t("info.follow.settings"),
      };
    case "long":
      return {
        measures: t("info.long.measures"),
        how: t("info.long.how"),
        scoring: t("info.long.scoring"),
        example: EXAMPLES.long,
        settings: t("info.long.settings"),
      };
    default:
      return { measures: "", how: "", scoring: "", example: "", settings: "" };
  }
}

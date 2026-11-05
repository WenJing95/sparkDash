/**
 * Wording for the two "generated tokens" numbers the UI shows, kept in one
 * place so the LLM panel tile and the token-totals tables explain each other.
 *
 * - The engine's own counter (`totalOutputTokens`) starts at zero whenever the
 *   LLM server restarts.
 * - sparkDash's ledger (the "Total tokens by model" tables) keeps counting
 *   across restarts, from when sparkDash first saw the endpoint.
 */
import type { TFunction } from "i18next";
import { i18n } from "../../i18n";
import en from "../../locales/en/llm.json";

// English copies for callers that are not on the "llm" namespace yet. Components
// on it read tokens.* through t so the wording follows the selected language.
export const ENGINE_GENERATED_LABEL = en.tokens.engineGenerated;
export const ENGINE_GENERATED_TITLE = en.tokens.engineGeneratedTitle;
export const LEDGER_HINT = en.tokens.ledgerHint;
export const LEDGER_TITLE = en.tokens.ledgerTitle;

/**
 * A ledger row's prompt whose cache split was never measured (the engine published no cached counter
 * then): neither cached nor computed prefill. Older servers send only the flag.
 */
export function unreportedOf(row: { promptTokens: number; cachedTokens: number; cacheReported?: boolean; unreportedPromptTokens?: number }): number {
  const open = Math.max(0, (row.promptTokens || 0) - Math.min(row.cachedTokens || 0, row.promptTokens || 0));
  const n = typeof row.unreportedPromptTokens === "number" ? row.unreportedPromptTokens : row.cacheReported === false ? open : 0;
  return Math.min(Math.max(0, n), open);
}

type TokenRow = { promptTokens: number; cachedTokens: number; unreportedPromptTokens: number; completionTokens: number };

/** The hover of a token row: prompt, its split and generated. Without t it is English. */
export function tokenRowTitle(row: TokenRow, t?: TFunction<"llm">): string {
  return rowTitle(row, t ?? i18n.getFixedT("en", "llm"));
}

function rowTitle(row: TokenRow, t: TFunction<"llm">): string {
  const values = {
    prompt: row.promptTokens.toLocaleString(),
    cached: row.cachedTokens.toLocaleString(),
    prefill: (row.promptTokens - row.cachedTokens - row.unreportedPromptTokens).toLocaleString(),
    unreported: row.unreportedPromptTokens.toLocaleString(),
    generated: row.completionTokens.toLocaleString(),
  };
  return row.unreportedPromptTokens > 0 ? t("tokens.rowTitleUnreported", values) : t("tokens.rowTitle", values);
}

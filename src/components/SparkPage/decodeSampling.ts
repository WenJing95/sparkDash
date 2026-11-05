import type { TFunction } from "i18next";
import type { DecodeBenchConfig } from "../../api/types";
import { normalizeDecodeBenchType } from "../../shared/llmPrompts.js";

/** "temp 0.7 · thinking on". Runs saved before these options existed ran at temp 0 with thinking off. */
export function decodeBenchSamplingLabel(config: Pick<DecodeBenchConfig, "temperature" | "thinking" | "topK"> | null | undefined): string {
  const temp = typeof config?.temperature === "number" ? config.temperature : 0;
  const thinking = typeof config?.thinking === "boolean" ? config.thinking : false;
  const topK = config?.topK != null ? ` · top_k ${config.topK}` : "";
  return `temp ${temp} · thinking ${thinking ? "on" : "off"}${topK}`;
}

/** True when the runs used more than one temperature / thinking setting, so their tok/s are not comparable. */
export function decodeBenchSamplingMixed(configs: Array<Pick<DecodeBenchConfig, "temperature" | "thinking" | "topK"> | null | undefined>): boolean {
  return new Set(configs.map(decodeBenchSamplingLabel)).size > 1;
}

/** `decodeBenchSamplingLabel` in the current UI language, for display and copied text. top_k is a parameter name and stays as is. */
export function decodeBenchSamplingText(
  config: Pick<DecodeBenchConfig, "temperature" | "thinking" | "topK"> | null | undefined,
  t: TFunction<"benchRun">
): string {
  const temp = typeof config?.temperature === "number" ? config.temperature : 0;
  const thinking = typeof config?.thinking === "boolean" ? config.thinking : false;
  const topK = config?.topK != null ? ` · top_k ${config.topK}` : "";
  return `${thinking ? t("sampling.thinkingOn", { temp }) : t("sampling.thinkingOff", { temp })}${topK}`;
}

/** Display name of a decode prompt type (`decodeBenchTypeLabel`) in the current UI language. */
export function decodeBenchTypeText(type: unknown, t: TFunction<"benchRun">): string {
  switch (normalizeDecodeBenchType(type)) {
    case "prose":
      return t("types.prose");
    case "code":
      return t("types.code");
    case "json":
      return t("types.json");
    default:
      return t("types.structured");
  }
}

/** One-line description of a decode prompt type, in the current UI language. */
export function decodeBenchTypeHint(type: unknown, t: TFunction<"benchRun">): string {
  switch (normalizeDecodeBenchType(type)) {
    case "prose":
      return t("types.proseHint");
    case "code":
      return t("types.codeHint");
    case "json":
      return t("types.jsonHint");
    default:
      return t("types.structuredHint");
  }
}

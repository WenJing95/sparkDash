/** Small formatting helpers for the Tool Eval pages (pure, unit-tested). */
import type { TFunction } from "i18next";
import { i18n } from "../../../i18n";

/**
 * English messages for callers that pass no translator (the share card, tests).
 * Components pass their own `t` so the text follows the selected language.
 */
export const enT = (): TFunction<"toolEval"> => i18n.getFixedT("en", "toolEval") as TFunction<"toolEval">;

/** 75 -> "1m 15s", 3700 -> "1h 01m". */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "–";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Rough time left from progress so far; null until at least one item finished. */
export function estimateRemaining(elapsedSeconds: number, done: number, total: number | null | undefined): number | null {
  if (!total || total <= 0 || done <= 0 || done >= total || elapsedSeconds <= 0) return null;
  return (elapsedSeconds / done) * (total - done);
}

export function fmtNum(v: unknown, digits = 2): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return v == null ? "–" : String(v);
  if (Number.isInteger(v)) return Math.abs(v) >= 10000 ? v.toLocaleString() : String(v);
  const abs = Math.abs(v);
  const d = abs >= 100 ? 1 : abs >= 10 ? Math.min(digits, 2) : digits;
  return Number(v.toFixed(d)).toLocaleString(undefined, { maximumFractionDigits: d });
}

export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "–";
  return new Date(ms).toLocaleString(i18n.resolvedLanguage, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KiB`;
}

/** "tokens_per_second" -> "Tokens per second"; "ttftMs" -> "Ttft ms". */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : key;
}

export type TierId = "excellent" | "good" | "adequate" | "weak" | "poor";
/** `label` is the tool's own English tier name (also printed on the share card); show `tierLabel(t, tier.id)` in the UI. */
export type Tier = { id: TierId; label: string; stars: number; tone: "good" | "info" | "warn" | "bad" };

/** The tool's score tiers: 90+ Excellent, 75+ Good, 60+ Adequate, 40+ Weak, else Poor. */
export function scoreTier(score: number | null | undefined): Tier | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score >= 90) return { id: "excellent", label: "Excellent", stars: 5, tone: "good" };
  if (score >= 75) return { id: "good", label: "Good", stars: 4, tone: "good" };
  if (score >= 60) return { id: "adequate", label: "Adequate", stars: 3, tone: "info" };
  if (score >= 40) return { id: "weak", label: "Weak", stars: 2, tone: "warn" };
  return { id: "poor", label: "Poor", stars: 1, tone: "bad" };
}

export function tierLabel(t: TFunction<"toolEval">, id: TierId): string {
  switch (id) {
    case "excellent":
      return t("tier.excellent");
    case "good":
      return t("tier.good");
    case "adequate":
      return t("tier.adequate");
    case "weak":
      return t("tier.weak");
    default:
      return t("tier.poor");
  }
}

/** The tool's rating text ("★★★ Adequate") with a known tier name shown in the current language; other text stays as the tool wrote it. */
export function ratingText(t: TFunction<"toolEval">, rating: string): string {
  switch (rating.trim()) {
    case "Excellent":
      return tierLabel(t, "excellent");
    case "Good":
      return tierLabel(t, "good");
    case "Adequate":
      return tierLabel(t, "adequate");
    case "Weak":
      return tierLabel(t, "weak");
    case "Poor":
      return tierLabel(t, "poor");
    default:
      return rating;
  }
}

export function toneColor(tone: Tier["tone"] | "neutral"): string {
  switch (tone) {
    case "good":
      return "var(--color-success)";
    case "info":
      return "var(--color-info)";
    case "warn":
      return "var(--color-warning)";
    case "bad":
      return "var(--color-danger)";
    default:
      return "var(--color-accent)";
  }
}

/** Plain-language explanation of the error codes the tool reports on its progress stream. */
export function explainErrorCode(code: string | null | undefined, message?: string | null, tr?: TFunction<"toolEval">): string {
  return explainErrorCodeIn(tr ?? enT(), code, message);
}

function explainErrorCodeIn(t: TFunction<"toolEval">, code: string | null | undefined, message?: string | null): string {
  const c = (code ?? "").toLowerCase();
  const tail = message ? t("errorCode.tail", { message }) : "";
  if (c === "no_server") return t("errorCode.noServer", { tail });
  if (c === "connection_failed") return t("errorCode.connectionFailed", { tail });
  if (c === "no_models") return t("errorCode.noModels", { tail });
  if (c === "auth_failed" || c === "unauthorized") return t("errorCode.authFailed", { tail });
  if (c === "model_not_found") return t("errorCode.modelNotFound", { tail });
  if (message) return `${code}: ${message}`;
  return code ? t("errorCode.otherWithCode", { code }) : t("errorCode.other");
}

export interface ToolNote {
  /** Stable key for React. */
  key: string;
  text: string;
}

/**
 * Plain-language notes for messages the tool prints about what the model server does not support.
 * They are not failures (the run carries on), but the raw lines ("returned 400", "rejected") read like errors.
 * Pass the run's output lines; returns nothing when there is nothing to explain.
 */
export function toolNotes(lines: readonly { text: string }[], tr?: TFunction<"toolEval">): ToolNote[] {
  return toolNotesIn(tr ?? enT(), lines);
}

function toolNotesIn(t: TFunction<"toolEval">, lines: readonly { text: string }[]): ToolNote[] {
  const notes: ToolNote[] = [];
  const seen = new Set<string>();
  const add = (key: string, text: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      notes.push({ key, text });
    }
  };
  const excluded: string[] = [];
  let forcedToolCalls = false;
  for (const { text } of lines) {
    if (/tool_choice/i.test(text) && /(rejected|not supported|unsupported|does not enforce)/i.test(text)) forcedToolCalls = true;
    const m = /Excluding\s+(TC-\d+)\s+from scoring/i.exec(text);
    if (m && !excluded.includes(m[1])) excluded.push(m[1]);
  }
  if (forcedToolCalls) {
    add("tool-choice", excluded.length ? t("notes.toolChoiceIds", { count: excluded.length, ids: excluded.join(", ") }) : t("notes.toolChoice"));
  } else if (excluded.length) {
    add("excluded", t("notes.excluded", { count: excluded.length, ids: excluded.join(", ") }));
  }
  return notes;
}

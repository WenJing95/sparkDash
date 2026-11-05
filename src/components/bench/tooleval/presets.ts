import type { TFunction } from "i18next";
import { enT } from "./format";
import type { FieldValue } from "./options";

/** A preset's settings; its name and description come from `presetText`. */
export interface PresetDef {
  id: string;
  values: Record<string, FieldValue>;
  /** Accuracy page only: which suites to tick. */
  suites?: string[];
}

export interface Preset extends PresetDef {
  label: string;
  help: string;
}

/** One-click starting points per page type. Applied on top of the page's defaults. */
export const PRESETS: Record<string, PresetDef[]> = {
  "tool-eval": [
    { id: "quick", values: { short: true } },
    { id: "full", values: {} },
    { id: "hard", values: { "hardmode-only": true } },
    { id: "repro", values: { temperature: "0", seed: "42" } },
    { id: "thinking", values: { "no-think": true, timeout: "120" } },
  ],
  throughput: [
    { id: "quick", values: { pp: "512", tg: "64", depth: "0", concurrency: "1", "benchy-runs": "1" } },
    { id: "standard", values: {} },
    { id: "deep", values: { depth: "0,4096,8192,16384,32768", concurrency: "1,2,4,8" } },
  ],
  "spec-decode": [
    { id: "quick", values: { "spec-runs": "1", "spec-prompts": "filler" } },
    { id: "standard", values: {} },
    { id: "code", values: { "spec-prompts": "code,structured" } },
  ],
  "context-pressure": [
    { id: "single", values: { "context-pressure": "0.75", short: true } },
    { id: "sweep", values: { "context-pressure-sweep": "0.5-1.0", "sweep-steps": "5", short: true } },
    { id: "fine", values: { "context-pressure-sweep": "0.1-1.0", "sweep-steps": "10", short: true } },
  ],
  accuracy: [
    { id: "quick", values: { "gsm8k-limit": "50", "mmlu-limit": "100", "ifeval-limit": "100" }, suites: ["gsm8k", "mmlu", "ifeval"] },
    { id: "standard", values: {}, suites: ["gsm8k", "mmlu", "ifeval"] },
    { id: "full", values: { "gsm8k-limit": "0", "mmlu-limit": "0", "ifeval-limit": "0" }, suites: ["gsm8k", "mmlu", "ifeval"] },
    { id: "repro", values: { seed: "42", "gsm8k-shuffle": true }, suites: ["gsm8k", "mmlu", "ifeval"] },
  ],
  needle: [
    { id: "quick", values: { "needle-depths": "3", "needle-lengths": "2" } },
    { id: "standard", values: {} },
    { id: "thorough", values: { "needle-depths": "10", "needle-lengths": "8" } },
  ],
  decision: [{ id: "standard", values: {} }],
};

/** Name and description of a preset of a page type (empty for an unknown one). */
export function presetText(t: TFunction<"toolEval">, type: string, id: string): { label: string; help: string } {
  switch (`${type}:${id}`) {
    case "tool-eval:quick":
      return { label: t("presets.toolEval.quick.label"), help: t("presets.toolEval.quick.help") };
    case "tool-eval:full":
      return { label: t("presets.toolEval.full.label"), help: t("presets.toolEval.full.help") };
    case "tool-eval:hard":
      return { label: t("presets.toolEval.hard.label"), help: t("presets.toolEval.hard.help") };
    case "tool-eval:repro":
      return { label: t("presets.toolEval.repro.label"), help: t("presets.toolEval.repro.help") };
    case "tool-eval:thinking":
      return { label: t("presets.toolEval.thinking.label"), help: t("presets.toolEval.thinking.help") };
    case "throughput:quick":
      return { label: t("presets.quick"), help: t("presets.throughput.quick") };
    case "throughput:standard":
      return { label: t("presets.standard"), help: t("presets.toolDefaults") };
    case "throughput:deep":
      return { label: t("presets.throughput.deep.label"), help: t("presets.throughput.deep.help") };
    case "spec-decode:quick":
      return { label: t("presets.quick"), help: t("presets.specDecode.quick") };
    case "spec-decode:standard":
      return { label: t("presets.standard"), help: t("presets.toolDefaults") };
    case "spec-decode:code":
      return { label: t("presets.specDecode.code.label"), help: t("presets.specDecode.code.help") };
    case "context-pressure:single":
      return { label: t("presets.contextPressure.single.label"), help: t("presets.contextPressure.single.help") };
    case "context-pressure:sweep":
      return { label: t("presets.contextPressure.sweep.label"), help: t("presets.contextPressure.sweep.help") };
    case "context-pressure:fine":
      return { label: t("presets.contextPressure.fine.label"), help: t("presets.contextPressure.fine.help") };
    case "accuracy:quick":
      return { label: t("presets.quick"), help: t("presets.accuracy.quick") };
    case "accuracy:standard":
      return { label: t("presets.standard"), help: t("presets.accuracy.standard") };
    case "accuracy:full":
      return { label: t("presets.accuracy.full.label"), help: t("presets.accuracy.full.help") };
    case "accuracy:repro":
      return { label: t("presets.accuracy.repro.label"), help: t("presets.accuracy.repro.help") };
    case "needle:quick":
      return { label: t("presets.quick"), help: t("presets.needle.quick") };
    case "needle:standard":
      return { label: t("presets.standard"), help: t("presets.needle.standard") };
    case "needle:thorough":
      return { label: t("presets.needle.thorough.label"), help: t("presets.needle.thorough.help") };
    case "decision:standard":
      return { label: t("presets.decision.label"), help: t("presets.toolDefaults") };
    default:
      return { label: id, help: "" };
  }
}

/** The presets of a page type with their names and descriptions (English when no translator is passed). */
export function presetList(type: string, tr?: TFunction<"toolEval">): Preset[] {
  const t = tr ?? enT();
  return (PRESETS[type] ?? []).map((p) => ({ ...p, ...presetText(t, type, p.id) }));
}

/** A ready-made run shown as a card in the Simple view. */
export interface SimpleTemplate extends Preset {
  /** Rough size, shown on the card. */
  size?: string;
  /** Rough time, shown on the card. */
  time?: string;
}

/**
 * The Simple view's templates. Tool Eval gets four basics, all with a fixed seed (42) so repeat runs stay comparable; (regular, regular + hard mode, short, hard mode only);
 * the other pages offer their ready presets as templates.
 */
export function simpleTemplates(type: string, tr?: TFunction<"toolEval">): SimpleTemplate[] {
  return simpleTemplatesIn(tr ?? enT(), type);
}

function simpleTemplatesIn(t: TFunction<"toolEval">, type: string): SimpleTemplate[] {
  if (type === "tool-eval") {
    return [
      {
        id: "regular",
        label: t("templates.regular.label"),
        help: t("templates.regular.help"),
        values: { seed: "42" },
        size: t("templates.scenarios", { count: 69 }),
        time: t("templates.minutesRange", { min: 10, max: 20 }),
      },
      {
        id: "regular-hard",
        label: t("templates.regularHard.label"),
        help: t("templates.regularHard.help"),
        values: { hardmode: true, seed: "42" },
        size: t("templates.scenarios", { count: 92 }),
        time: t("templates.minutesRange", { min: 15, max: 30 }),
      },
      {
        id: "short",
        label: t("templates.short.label"),
        help: t("templates.short.help"),
        values: { short: true, seed: "42" },
        size: t("templates.scenarios", { count: 15 }),
        time: t("templates.minutes", { count: 2 }),
      },
      {
        id: "hard",
        label: t("templates.hard.label"),
        help: t("templates.hard.help"),
        values: { "hardmode-only": true, seed: "42" },
        size: t("templates.scenarios", { count: 23 }),
        time: t("templates.minutesRange", { min: 5, max: 10 }),
      },
    ];
  }
  return presetList(type, t);
}

/** Where the run points, not how it runs: a custom URL or model never makes a template "custom". */
export const TARGET_KEYS: ReadonlySet<string> = new Set(["base-url", "model"]);

/** Settings the Simple view keeps across templates: the target, and how many trials to repeat. */
export const KEPT_KEYS: ReadonlySet<string> = new Set([...TARGET_KEYS, "trials"]);

const normValue = (v: unknown): string => (Array.isArray(v) ? v.join(" ") : String(v ?? "")).trim();

/** Does the form currently hold exactly this template (and nothing else)? */
export function matchesTemplate(
  state: { values: Record<string, unknown>; extraArgs: string; suites: string[] },
  template: PresetDef
): boolean {
  if (state.extraArgs.trim()) return false;
  const set = (v: unknown) => v !== undefined && v !== "" && v !== false && !(Array.isArray(v) && v.every((x) => !String(x).trim()));
  const keys = new Set([...Object.keys(state.values).filter((k) => set(state.values[k])), ...Object.keys(template.values).filter((k) => set(template.values[k]))]);
  for (const k of KEPT_KEYS) keys.delete(k);
  for (const k of keys) {
    if (set(state.values[k]) !== set(template.values[k])) return false;
    if (normValue(state.values[k]) !== normValue(template.values[k]) && String(state.values[k]) !== String(template.values[k])) return false;
  }
  if (template.suites) {
    const a = [...template.suites].sort().join(",");
    const b = [...state.suites].sort().join(",");
    if (a !== b) return false;
  }
  return true;
}

/** The non-blank KEPT_KEYS values of a form: what survives picking a template or preset. */
export function keptValues(values: Record<string, FieldValue>): Record<string, FieldValue> {
  return Object.fromEntries([...KEPT_KEYS].filter((k) => String(values[k] ?? "").trim()).map((k) => [k, values[k]]));
}

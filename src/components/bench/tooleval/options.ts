import type { TFunction } from "i18next";
import type { ToolEvalArgSpec, ToolEvalRun, ToolEvalSpec } from "../../../api/types";
import { enT } from "./format";
import { presetList, type Preset, type PresetDef } from "./presets";

/**
 * Form state for the Tool Eval pages and its mapping to the API payload.
 * Strings stay strings while the user types (numbers are parsed at build time),
 * `categories` and `repeat` options are string arrays, bools are booleans.
 */
export type FieldValue = string | boolean | string[];

export interface FormState {
  values: Record<string, FieldValue>;
  extraArgs: string;
  /** LLM port on the Spark; null = the Spark's first port. */
  port: number | null;
  /** accuracy page: which suites to run. */
  suites: string[];
}

export const SUITES = [
  { id: "gsm8k", label: "GSM8K" },
  { id: "mmlu", label: "MMLU" },
  { id: "ifeval", label: "IFEval" },
] as const;

/** One-line description of an accuracy suite. */
export function suiteHelp(t: TFunction<"toolEval">, id: (typeof SUITES)[number]["id"]): string {
  switch (id) {
    case "gsm8k":
      return t("suites.gsm8k");
    case "mmlu":
      return t("suites.mmlu");
    default:
      return t("suites.ifeval");
  }
}

/** A group on a page; `only` limits it to named fields (a field from another group can join a page this way). */
export interface GroupSel {
  id: string;
  only?: string[];
  /** Fields that the page sets itself and therefore hides. */
  hide?: string[];
  label?: string;
}

export interface TypeConfig {
  groups: GroupSel[];
  /** Flags this page always sends (they define what the page measures). */
  forced: Record<string, boolean>;
}

export const TYPE_CONFIG: Record<string, TypeConfig> = {
  "tool-eval": {
    groups: [{ id: "connection" }, { id: "scenarios" }, { id: "sampling" }, { id: "run" }, { id: "scoring" }, { id: "output" }],
    forced: {},
  },
  throughput: {
    groups: [{ id: "connection" }, { id: "throughput", hide: ["perf", "perf-only"] }, { id: "run", only: ["timeout"] }, { id: "output" }],
    forced: { "perf-only": true },
  },
  "spec-decode": {
    groups: [{ id: "connection" }, { id: "spec", hide: ["spec-bench"] }, { id: "sampling", only: ["temperature"] }, { id: "output" }],
    forced: { "spec-bench": true, "skip-tool-eval": true },
  },
  "context-pressure": {
    groups: [{ id: "connection" }, { id: "scenarios" }, { id: "pressure" }, { id: "sampling" }, { id: "run" }, { id: "output" }],
    forced: {},
  },
  accuracy: {
    groups: [
      { id: "connection" },
      { id: "gsm8k", hide: ["gsm8k", "gsm8k-only"] },
      { id: "mmlu", hide: ["mmlu", "mmlu-only"] },
      { id: "ifeval", hide: ["ifeval", "ifeval-only"] },
      { id: "sampling", only: ["seed"] },
      { id: "output" },
    ],
    forced: {},
  },
  needle: {
    groups: [{ id: "connection" }, { id: "needle", hide: ["needle", "needle-only"] }, { id: "output" }],
    forced: { "needle-only": true },
  },
  decision: {
    groups: [{ id: "connection" }, { id: "decision", hide: ["decision", "decision-only"] }, { id: "output" }],
    forced: { "decision-only": true },
  },
};

const ACCURACY_ONLY = ["gsm8k-only", "mmlu-only", "ifeval-only"];

export function typeConfig(type: string): TypeConfig {
  return TYPE_CONFIG[type] ?? TYPE_CONFIG["tool-eval"];
}

/** Names of the options the page itself controls (never shown, never persisted). */
export function managedNames(type: string): Set<string> {
  const names = new Set(Object.keys(typeConfig(type).forced));
  if (type === "accuracy") ACCURACY_ONLY.forEach((n) => names.add(n));
  return names;
}

/** The fields shown in the main form for a group on this page. */
export function groupFields(spec: ToolEvalSpec, type: string, sel: GroupSel): ToolEvalArgSpec[] {
  const hidden = new Set([...(sel.hide ?? []), ...managedNames(type)]);
  return spec.args.filter((a) => a.group === sel.id && a.kind !== "secret" && !hidden.has(a.name) && (!sel.only || sel.only.includes(a.name)));
}

/** Every option not in the main form (and not managed by the page): the "Advanced / all options" disclosure. */
export function advancedFields(spec: ToolEvalSpec, type: string): ToolEvalArgSpec[] {
  const shown = new Set<string>();
  for (const sel of typeConfig(type).groups) groupFields(spec, type, sel).forEach((f) => shown.add(f.name));
  const managed = managedNames(type);
  return spec.args.filter((a) => a.kind !== "secret" && !shown.has(a.name) && !managed.has(a.name));
}

export function emptyState(type: string): FormState {
  return { values: {}, extraArgs: "", port: null, suites: type === "accuracy" ? SUITES.map((s) => s.id) : [] };
}

export function applyPreset(type: string, preset: PresetDef): FormState {
  const base = emptyState(type);
  return { ...base, values: { ...preset.values }, suites: preset.suites ? [...preset.suites] : base.suites };
}

export function presetsFor(type: string, tr?: TFunction<"toolEval">): Preset[] {
  return presetList(type, tr);
}

const isBlank = (v: FieldValue | undefined): boolean => v === undefined || v === "" || v === false || (Array.isArray(v) && v.every((x) => !x.trim()));

/** Value of a `list` option as tokens (whitespace / comma separated). */
export function splitList(raw: string): string[] {
  return raw.split(/[\s,]+/).filter(Boolean);
}

/** Convert one form value to what the API expects; undefined = not set. */
function toApiValue(spec: ToolEvalArgSpec, v: FieldValue | undefined): unknown {
  if (isBlank(v)) return undefined;
  switch (spec.kind) {
    case "bool":
      return v === true ? true : undefined;
    case "int":
    case "float": {
      const s = String(v).trim();
      if (!s) return undefined;
      const n = Number(s);
      return Number.isFinite(n) ? n : s; // invalid text is sent as is so the server explains it
    }
    case "list":
      return Array.isArray(v) ? v.filter(Boolean) : splitList(String(v));
    case "repeat":
      return Array.isArray(v) ? v.map((x) => x.trim()).filter(Boolean) : String(v).split("\n").map((x) => x.trim()).filter(Boolean);
    default:
      return typeof v === "string" ? v.trim() === "" ? undefined : spec.kind === "text" ? v : v.trim() : undefined;
  }
}

/** The key that will actually be sent: only with a non-blank custom base URL. */
export function apiKeyFor(state: Pick<FormState, "values">, apiKey: string): string {
  const url = state.values["base-url"];
  return apiKey && typeof url === "string" && url.trim() ? apiKey : "";
}

export interface BuiltRequest {
  options: Record<string, unknown>;
  extraArgs: string;
  port?: number;
}

/** Form state -> request body parts (options keyed by option name, plus the forced flags of the page). */
export function buildRequest(spec: ToolEvalSpec, type: string, state: FormState, apiKey = ""): BuiltRequest {
  const options: Record<string, unknown> = {};
  const managed = managedNames(type);
  for (const arg of spec.args) {
    if (arg.kind === "secret" || managed.has(arg.name)) continue;
    const v = toApiValue(arg, state.values[arg.name]);
    if (v !== undefined) options[arg.name] = v;
  }
  for (const [name, on] of Object.entries(typeConfig(type).forced)) if (on) options[name] = true;
  if (type === "accuracy") for (const s of state.suites) options[`${s}-only`] = true;
  // A typed key belongs to the custom endpoint: with no base URL the run goes to the local server, which must never see it.
  if (apiKey && options["base-url"] !== undefined) options["api-key"] = apiKey;
  const out: BuiltRequest = { options, extraArgs: state.extraArgs.trim() };
  if (state.port != null) out.port = state.port;
  return out;
}

/** Client-side check of one raw field value, mirroring the server so errors show while typing. */
export function validateField(spec: ToolEvalArgSpec, v: FieldValue | undefined, tr?: TFunction<"toolEval">): string | null {
  return fieldError(tr ?? enT(), spec, v);
}

function fieldError(t: TFunction<"toolEval">, spec: ToolEvalArgSpec, v: FieldValue | undefined): string | null {
  if (isBlank(v)) return null;
  const label = argLabel(t, spec);
  const s = typeof v === "string" ? v.trim() : "";
  // Whitespace-only text is dropped by toApiValue, so it is not an error either.
  if (typeof v === "string" && !s) return null;
  switch (spec.kind) {
    case "int":
    case "float": {
      const n = Number(s);
      if (!s || !Number.isFinite(n)) return t("validation.notNumber", { label });
      if (spec.kind === "int" && !Number.isInteger(n)) return t("validation.notInteger", { label });
      if (spec.min != null && n < spec.min) return t("validation.min", { label, min: spec.min });
      if (spec.max != null && n > spec.max) return t("validation.max", { label, max: spec.max });
      return null;
    }
    case "choice":
      return spec.choices?.includes(s) ? null : t("validation.choice", { label, choices: spec.choices?.join(", ") ?? "" });
    case "string":
    case "csv":
    case "range":
      if (s.length > (spec.maxLen ?? 500)) return t("validation.tooLong", { label });
      if (spec.pattern && !new RegExp(spec.pattern).test(s)) return t("validation.format", { label });
      return null;
    case "text": {
      const bytes = byteLength(typeof v === "string" ? v : "");
      return bytes > (spec.maxBytes ?? 32768) ? t("validation.tooManyBytes", { label, kib: (spec.maxBytes ?? 32768) / 1024 }) : null;
    }
    case "path":
      if (!/^(~\/|\/)[A-Za-z0-9._@+=,/ -]{0,300}$/.test(s)) return t("validation.path", { label });
      return s.split("/").includes("..") ? t("validation.pathDots", { label }) : null;
    case "url":
      try {
        const u = new URL(s);
        if (u.protocol !== "http:" && u.protocol !== "https:") return t("validation.urlScheme", { label });
        return u.username || u.password ? t("validation.urlCredentials", { label }) : null;
      } catch {
        return t("validation.url", { label });
      }
    case "json": {
      const reason = jsonObjectError(s, t);
      return reason ? t("validation.json", { label, reason }) : null;
    }
    case "list": {
      const items = Array.isArray(v) ? v : splitList(String(v));
      if (spec.maxItems && items.length > spec.maxItems) return t("validation.tooManyItems", { label });
      const re = spec.itemPattern ? new RegExp(spec.itemPattern) : null;
      const bad = re ? items.find((i) => !re.test(i)) : undefined;
      return bad ? t("validation.badItem", { label, item: bad.slice(0, 40) }) : null;
    }
    case "repeat": {
      const items = (Array.isArray(v) ? v : [String(v)]).map((x) => x.trim()).filter(Boolean);
      if (spec.maxItems && items.length > spec.maxItems) return t("validation.tooManyItems", { label });
      const re = spec.itemPattern ? new RegExp(spec.itemPattern) : null;
      const bad = re ? items.find((i) => !re.test(i)) : undefined;
      return bad ? t("validation.badEntry", { label, item: bad.slice(0, 40) }) : null;
    }
    default:
      return null;
  }
}

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** null when `s` is a JSON object; otherwise a short reason. */
export function jsonObjectError(s: string, tr?: TFunction<"toolEval">): string | null {
  return jsonReason(tr ?? enT(), s);
}

function jsonReason(t: TFunction<"toolEval">, s: string): string | null {
  try {
    const p = JSON.parse(s);
    return p && typeof p === "object" && !Array.isArray(p) ? null : t("validation.jsonNotObject");
  } catch {
    return t("validation.jsonInvalid");
  }
}

/** Errors per option name plus form-level ones (cross-field rules). */
export function validateState(spec: ToolEvalSpec, type: string, state: FormState, tr?: TFunction<"toolEval">): { fields: Record<string, string>; form: string[] } {
  return stateErrors(tr ?? enT(), spec, type, state);
}

function stateErrors(t: TFunction<"toolEval">, spec: ToolEvalSpec, type: string, state: FormState): { fields: Record<string, string>; form: string[] } {
  const fields: Record<string, string> = {};
  const managed = managedNames(type);
  for (const arg of spec.args) {
    if (arg.kind === "secret" || managed.has(arg.name)) continue;
    const e = fieldError(t, arg, state.values[arg.name]);
    if (e) fields[arg.name] = e;
  }
  const form: string[] = [];
  const set = (n: string) => !isBlank(state.values[n]);
  if (set("system-prompt") && set("system-prompt-file")) form.push(t("validation.systemPromptBoth"));
  if (set("context-pressure") && set("context-pressure-sweep")) form.push(t("validation.pressureBoth"));
  if (set("short") && set("scenarios")) form.push(t("validation.shortAndScenarios"));
  if (type === "accuracy" && state.suites.length === 0) form.push(t("validation.noSuite"));
  if (type === "context-pressure" && !set("context-pressure") && !set("context-pressure-sweep")) {
    form.push(t("validation.noPressure"));
  }
  return { fields, form };
}

/** Map the server's `errors[]` (which start with the option label) back onto fields. */
export function mapServerErrors(spec: ToolEvalSpec, errors: readonly string[]): { fields: Record<string, string>; form: string[] } {
  const fields: Record<string, string> = {};
  const form: string[] = [];
  const byLen = [...spec.args].sort((a, b) => b.label.length - a.label.length);
  for (const e of errors) {
    const hit = byLen.find((a) => e.startsWith(a.label));
    const quoted = /Unknown option "([^"]+)"/.exec(e);
    if (hit) fields[hit.name] ??= e;
    else if (quoted && spec.args.some((a) => a.name === quoted[1])) fields[quoted[1]] ??= e;
    else form.push(e);
  }
  return { fields, form };
}

// ── History re-run: loading a stored run's (redacted) options back into the form ──

export function stateFromRun(spec: ToolEvalSpec, type: string, run: Pick<ToolEvalRun, "options" | "port">): FormState {
  const state = emptyState(type);
  const managed = managedNames(type);
  const opts = run.options ?? {};
  const suites: string[] = [];
  for (const arg of spec.args) {
    const raw = opts[arg.name];
    if (raw === undefined || raw === null) continue;
    if (type === "accuracy" && ACCURACY_ONLY.includes(arg.name)) {
      if (raw === true) suites.push(arg.name.replace("-only", ""));
      continue;
    }
    if (arg.kind === "secret" || managed.has(arg.name) || raw === "(hidden)" || raw === "(saved key)") continue;
    if (arg.secret) continue; // header values are not stored
    // Large values (system prompt, backend kwargs) are stored as an "(omitted: …)" placeholder: never reload that as the value.
    if (typeof raw === "string" && raw.startsWith("(omitted:")) continue;
    if (arg.kind === "bool") state.values[arg.name] = raw === true;
    else if (arg.kind === "repeat") state.values[arg.name] = Array.isArray(raw) ? raw.map(String) : [String(raw)];
    else if (arg.kind === "list") state.values[arg.name] = arg.choices ? (Array.isArray(raw) ? raw.map(String) : []) : Array.isArray(raw) ? raw.join(" ") : String(raw);
    else state.values[arg.name] = String(raw);
  }
  if (type === "accuracy") state.suites = suites.length ? suites : state.suites;
  if (Array.isArray(opts.extra)) state.extraArgs = opts.extra.map(String).join(" ");
  state.port = typeof run.port === "number" ? run.port : null;
  return state;
}

// ── Persistence of the last-used options per page type (never the API key or header values) ──

const storageKey = (type: string) => `sparkdash.tooleval.options.${type}`;

export function persistable(spec: ToolEvalSpec | null, state: FormState): FormState {
  const secretNames = new Set((spec?.args ?? []).filter((a) => a.secret || a.kind === "secret").map((a) => a.name));
  secretNames.add("api-key");
  secretNames.add("header");
  const values: Record<string, FieldValue> = {};
  for (const [k, v] of Object.entries(state.values)) if (!secretNames.has(k)) values[k] = v;
  return { ...state, values };
}

export function saveState(type: string, spec: ToolEvalSpec | null, state: FormState): void {
  try {
    localStorage.setItem(storageKey(type), JSON.stringify(persistable(spec, state)));
  } catch {
    /* private mode */
  }
}

export function loadState(type: string): FormState | null {
  try {
    const raw = localStorage.getItem(storageKey(type));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<FormState>;
    if (!p || typeof p !== "object" || typeof p.values !== "object" || p.values === null || Array.isArray(p.values)) return null;
    const base = emptyState(type);
    return {
      values: p.values as Record<string, FieldValue>,
      extraArgs: typeof p.extraArgs === "string" ? p.extraArgs : "",
      port: typeof p.port === "number" ? p.port : null,
      suites: Array.isArray(p.suites) ? p.suites.filter((s): s is string => typeof s === "string") : base.suites,
    };
  } catch {
    return null;
  }
}

/** Count of options that differ from "unset", for the "N options set" hint. */
export function countSet(state: FormState): number {
  return Object.values(state.values).filter((v) => !isBlank(v)).length + (state.extraArgs.trim() ? 1 : 0);
}

// ── Display text for the server's option spec (GET /api/tool-eval/spec) ──
// The server sends English labels and help. Known options/groups get a translation through the
// static keys below; a translation is used only while the server's English still matches the
// catalog's English, so a new or reworded server option simply shows the server text.

interface SpecText {
  label: string;
  help: string;
}

function argTextIn(t: TFunction<"toolEval">, name: string): SpecText | null {
  switch (name) {
    case "base-url":
      return { label: t("args.base-url.label"), help: t("args.base-url.help") };
    case "model":
      return { label: t("args.model.label"), help: t("args.model.help") };
    case "backend":
      return { label: t("args.backend.label"), help: t("args.backend.help") };
    case "provider":
      return { label: t("args.provider.label"), help: t("args.provider.help") };
    case "format":
      return { label: t("args.format.label"), help: t("args.format.help") };
    case "api-key":
      return { label: t("args.api-key.label"), help: t("args.api-key.help") };
    case "header":
      return { label: t("args.header.label"), help: t("args.header.help") };
    case "session-header":
      return { label: t("args.session-header.label"), help: t("args.session-header.help") };
    case "short":
      return { label: t("args.short.label"), help: t("args.short.help") };
    case "scenarios":
      return { label: t("args.scenarios.label"), help: t("args.scenarios.help") };
    case "categories":
      return { label: t("args.categories.label"), help: t("args.categories.help") };
    case "hardmode":
      return { label: t("args.hardmode.label"), help: t("args.hardmode.help") };
    case "hardmode-only":
      return { label: t("args.hardmode-only.label"), help: t("args.hardmode-only.help") };
    case "variant-seed":
      return { label: t("args.variant-seed.label"), help: t("args.variant-seed.help") };
    case "scenario-pack":
      return { label: t("args.scenario-pack.label"), help: t("args.scenario-pack.help") };
    case "pack-only":
      return { label: t("args.pack-only.label"), help: t("args.pack-only.help") };
    case "temperature":
      return { label: t("args.temperature.label"), help: t("args.temperature.help") };
    case "no-think":
      return { label: t("args.no-think.label"), help: t("args.no-think.help") };
    case "top-p":
      return { label: t("args.top-p.label"), help: t("args.top-p.help") };
    case "top-k":
      return { label: t("args.top-k.label"), help: t("args.top-k.help") };
    case "min-p":
      return { label: t("args.min-p.label"), help: t("args.min-p.help") };
    case "repeat-penalty":
      return { label: t("args.repeat-penalty.label"), help: t("args.repeat-penalty.help") };
    case "seed":
      return { label: t("args.seed.label"), help: t("args.seed.help") };
    case "backend-kwargs":
      return { label: t("args.backend-kwargs.label"), help: t("args.backend-kwargs.help") };
    case "timeout":
      return { label: t("args.timeout.label"), help: t("args.timeout.help") };
    case "max-turns":
      return { label: t("args.max-turns.label"), help: t("args.max-turns.help") };
    case "trials":
      return { label: t("args.trials.label"), help: t("args.trials.help") };
    case "parallel":
      return { label: t("args.parallel.label"), help: t("args.parallel.help") };
    case "error-rate":
      return { label: t("args.error-rate.label"), help: t("args.error-rate.help") };
    case "no-warmup":
      return { label: t("args.no-warmup.label"), help: t("args.no-warmup.help") };
    case "no-preflight":
      return { label: t("args.no-preflight.label"), help: t("args.no-preflight.help") };
    case "no-probe-engine":
      return { label: t("args.no-probe-engine.label"), help: t("args.no-probe-engine.help") };
    case "reference-date":
      return { label: t("args.reference-date.label"), help: t("args.reference-date.help") };
    case "system-prompt":
      return { label: t("args.system-prompt.label"), help: t("args.system-prompt.help") };
    case "system-prompt-file":
      return { label: t("args.system-prompt-file.label"), help: t("args.system-prompt-file.help") };
    case "skip-tool-eval":
      return { label: t("args.skip-tool-eval.label"), help: t("args.skip-tool-eval.help") };
    case "resume":
      return { label: t("args.resume.label"), help: t("args.resume.help") };
    case "diff":
      return { label: t("args.diff.label"), help: t("args.diff.help") };
    case "fail-on-safety":
      return { label: t("args.fail-on-safety.label"), help: t("args.fail-on-safety.help") };
    case "alpha":
      return { label: t("args.alpha.label"), help: t("args.alpha.help") };
    case "weight-by-difficulty":
      return { label: t("args.weight-by-difficulty.label"), help: t("args.weight-by-difficulty.help") };
    case "label":
      return { label: t("args.label.label"), help: t("args.label.help") };
    case "output-dir":
      return { label: t("args.output-dir.label"), help: t("args.output-dir.help") };
    case "perf":
      return { label: t("args.perf.label"), help: t("args.perf.help") };
    case "perf-only":
      return { label: t("args.perf-only.label"), help: t("args.perf-only.help") };
    case "pp":
      return { label: t("args.pp.label"), help: t("args.pp.help") };
    case "tg":
      return { label: t("args.tg.label"), help: t("args.tg.help") };
    case "depth":
      return { label: t("args.depth.label"), help: t("args.depth.help") };
    case "concurrency":
      return { label: t("args.concurrency.label"), help: t("args.concurrency.help") };
    case "benchy-runs":
      return { label: t("args.benchy-runs.label"), help: t("args.benchy-runs.help") };
    case "benchy-latency-mode":
      return { label: t("args.benchy-latency-mode.label"), help: t("args.benchy-latency-mode.help") };
    case "benchy-args":
      return { label: t("args.benchy-args.label"), help: t("args.benchy-args.help") };
    case "tokenizer":
      return { label: t("args.tokenizer.label"), help: t("args.tokenizer.help") };
    case "spec-bench":
      return { label: t("args.spec-bench.label"), help: t("args.spec-bench.help") };
    case "spec-method":
      return { label: t("args.spec-method.label"), help: t("args.spec-method.help") };
    case "spec-prompts":
      return { label: t("args.spec-prompts.label"), help: t("args.spec-prompts.help") };
    case "spec-prompt-file":
      return { label: t("args.spec-prompt-file.label"), help: t("args.spec-prompt-file.help") };
    case "spec-runs":
      return { label: t("args.spec-runs.label"), help: t("args.spec-runs.help") };
    case "baseline-tgs":
      return { label: t("args.baseline-tgs.label"), help: t("args.baseline-tgs.help") };
    case "metrics-url":
      return { label: t("args.metrics-url.label"), help: t("args.metrics-url.help") };
    case "context-pressure":
      return { label: t("args.context-pressure.label"), help: t("args.context-pressure.help") };
    case "context-pressure-sweep":
      return { label: t("args.context-pressure-sweep.label"), help: t("args.context-pressure-sweep.help") };
    case "sweep-steps":
      return { label: t("args.sweep-steps.label"), help: t("args.sweep-steps.help") };
    case "context-size":
      return { label: t("args.context-size.label"), help: t("args.context-size.help") };
    case "gsm8k":
      return { label: t("args.gsm8k.label"), help: t("args.gsm8k.help") };
    case "gsm8k-only":
      return { label: t("args.gsm8k-only.label"), help: t("args.gsm8k-only.help") };
    case "gsm8k-shots":
      return { label: t("args.gsm8k-shots.label"), help: t("args.gsm8k-shots.help") };
    case "gsm8k-limit":
      return { label: t("args.gsm8k-limit.label"), help: t("args.gsm8k-limit.help") };
    case "gsm8k-shuffle":
      return { label: t("args.gsm8k-shuffle.label"), help: t("args.gsm8k-shuffle.help") };
    case "mmlu":
      return { label: t("args.mmlu.label"), help: t("args.mmlu.help") };
    case "mmlu-only":
      return { label: t("args.mmlu-only.label"), help: t("args.mmlu-only.help") };
    case "mmlu-shots":
      return { label: t("args.mmlu-shots.label"), help: t("args.mmlu-shots.help") };
    case "mmlu-limit":
      return { label: t("args.mmlu-limit.label"), help: t("args.mmlu-limit.help") };
    case "mmlu-subjects":
      return { label: t("args.mmlu-subjects.label"), help: t("args.mmlu-subjects.help") };
    case "ifeval":
      return { label: t("args.ifeval.label"), help: t("args.ifeval.help") };
    case "ifeval-only":
      return { label: t("args.ifeval-only.label"), help: t("args.ifeval-only.help") };
    case "ifeval-limit":
      return { label: t("args.ifeval-limit.label"), help: t("args.ifeval-limit.help") };
    case "needle":
      return { label: t("args.needle.label"), help: t("args.needle.help") };
    case "needle-only":
      return { label: t("args.needle-only.label"), help: t("args.needle-only.help") };
    case "needle-depths":
      return { label: t("args.needle-depths.label"), help: t("args.needle-depths.help") };
    case "needle-lengths":
      return { label: t("args.needle-lengths.label"), help: t("args.needle-lengths.help") };
    case "decision":
      return { label: t("args.decision.label"), help: t("args.decision.help") };
    case "decision-only":
      return { label: t("args.decision-only.label"), help: t("args.decision-only.help") };
    default:
      return null;
  }
}

function groupTextIn(t: TFunction<"toolEval">, id: string): SpecText | null {
  switch (id) {
    case "connection":
      return { label: t("groups.connection.label"), help: t("groups.connection.help") };
    case "scenarios":
      return { label: t("groups.scenarios.label"), help: t("groups.scenarios.help") };
    case "sampling":
      return { label: t("groups.sampling.label"), help: t("groups.sampling.help") };
    case "run":
      return { label: t("groups.run.label"), help: t("groups.run.help") };
    case "scoring":
      return { label: t("groups.scoring.label"), help: t("groups.scoring.help") };
    case "output":
      return { label: t("groups.output.label"), help: t("groups.output.help") };
    case "throughput":
      return { label: t("groups.throughput.label"), help: t("groups.throughput.help") };
    case "spec":
      return { label: t("groups.spec.label"), help: t("groups.spec.help") };
    case "pressure":
      return { label: t("groups.pressure.label"), help: t("groups.pressure.help") };
    case "gsm8k":
      return { label: t("groups.gsm8k.label"), help: t("groups.gsm8k.help") };
    case "mmlu":
      return { label: t("groups.mmlu.label"), help: t("groups.mmlu.help") };
    case "ifeval":
      return { label: t("groups.ifeval.label"), help: t("groups.ifeval.help") };
    case "needle":
      return { label: t("groups.needle.label"), help: t("groups.needle.help") };
    case "decision":
      return { label: t("groups.decision.label"), help: t("groups.decision.help") };
    case "advanced":
      return { label: t("groups.advanced.label"), help: t("groups.advanced.help") };
    default:
      return null;
  }
}

function choiceTextIn(t: TFunction<"toolEval">, name: string, value: string): string | null {
  switch (`${name}:${value}`) {
    case "benchy-latency-mode:api":
      return t("choices.benchy-latency-mode.api");
    case "benchy-latency-mode:generation":
      return t("choices.benchy-latency-mode.generation");
    case "benchy-latency-mode:none":
      return t("choices.benchy-latency-mode.none");
    default:
      return null;
  }
}

/** Label of an option in the current language (the server's text when no matching translation exists). */
export function argLabel(t: TFunction<"toolEval">, arg: Pick<ToolEvalArgSpec, "name" | "label">): string {
  const en = argTextIn(enT(), arg.name);
  return en && en.label === arg.label ? argTextIn(t, arg.name)?.label ?? arg.label : arg.label;
}

/** Help text of an option in the current language (the server's text when no matching translation exists). */
export function argHelp(t: TFunction<"toolEval">, arg: Pick<ToolEvalArgSpec, "name" | "help">): string {
  const en = argTextIn(enT(), arg.name);
  return en && en.help === arg.help ? argTextIn(t, arg.name)?.help ?? arg.help : arg.help;
}

export function groupLabel(t: TFunction<"toolEval">, group: { id: string; label: string }): string {
  const en = groupTextIn(enT(), group.id);
  return en && en.label === group.label ? groupTextIn(t, group.id)?.label ?? group.label : group.label;
}

export function groupHelp(t: TFunction<"toolEval">, group: { id: string; help: string }): string {
  const en = groupTextIn(enT(), group.id);
  return en && en.help === group.help ? groupTextIn(t, group.id)?.help ?? group.help : group.help;
}

/** Display name of a choice value; the value itself (what is sent) never changes. */
export function choiceLabel(t: TFunction<"toolEval">, arg: Pick<ToolEvalArgSpec, "name">, value: string): string {
  return choiceTextIn(enT(), arg.name, value) === value ? choiceTextIn(t, arg.name, value) ?? value : value;
}

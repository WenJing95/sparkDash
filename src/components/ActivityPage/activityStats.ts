import type { TFunction } from "i18next";
import type { ActivityEvent } from "../../api/types";
import { i18n } from "../../i18n";
import { configuredTimeZone } from "../../shared/timeZone";

/** Pure logic for the Activity page: categories, labels, filtering, counts, day grouping, export. */

export type Severity = ActivityEvent["severity"];

export const SEVERITIES: readonly Severity[] = ["error", "warn", "success", "info"];

/** Labels follow the caller's language; pure callers without one (tests, exports) get English. */
const english = (): TFunction<"activity"> => i18n.getFixedT("en", "activity");

function severityText(t: TFunction<"activity">, s: Severity): string {
  switch (s) {
    case "error":
      return t("severity.error");
    case "warn":
      return t("severity.warn");
    case "success":
      return t("severity.success");
    case "info":
      return t("severity.info");
    default:
      return String(s);
  }
}

/** "Error", "Warning", ... in the caller's language; an unknown severity is shown as sent. */
export function severityLabel(s: Severity, t?: TFunction<"activity">): string {
  return severityText(t ?? english(), s);
}

export type CategoryId = "status" | "thermal" | "health" | "alerts" | "hermes" | "bench" | "power" | "llm" | "fleet" | "other";

export const CATEGORIES: readonly CategoryId[] = ["status", "thermal", "health", "alerts", "hermes", "bench", "power", "llm", "fleet", "other"];

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Spark filter value for events that belong to no Spark. */
export const NO_SPARK = "__none__";

export type RangeId = "24h" | "7d" | "all";

export interface ActivityFilter {
  /** Empty = every severity. */
  severities: Severity[];
  category: CategoryId | "all";
  /** Spark id, NO_SPARK, or "all". */
  sparkId: string;
  query: string;
  range: RangeId;
}

export const EMPTY_FILTER: ActivityFilter = { severities: [], category: "all", sparkId: "all", query: "", range: "all" };

export function isFilterActive(f: ActivityFilter): boolean {
  return f.severities.length > 0 || f.category !== "all" || f.sparkId !== "all" || f.query.trim() !== "" || f.range !== "all";
}

export function categorize(type: string): CategoryId {
  if (type === "spark.online" || type === "spark.offline") return "status";
  if (type === "spark.added" || type === "spark.removed") return "fleet";
  if (type.startsWith("gpu.throttle")) return "thermal";
  if (type.startsWith("health.")) return "health";
  if (type.startsWith("alert.")) return "alerts";
  if (type.startsWith("hermes.")) return "hermes";
  if (type.startsWith("bench.")) return "bench";
  if (type.startsWith("power.")) return "power";
  if (type.startsWith("llm.")) return "llm";
  return "other";
}

function knownLabel(t: TFunction<"activity">, type: string): string | null {
  switch (type) {
    case "spark.online": return t("types.sparkOnline");
    case "spark.offline": return t("types.sparkOffline");
    case "spark.added": return t("types.sparkAdded");
    case "spark.removed": return t("types.sparkRemoved");
    case "gpu.throttle.thermal": return t("types.throttleThermal");
    case "gpu.throttle.cleared": return t("types.throttleCleared");
    case "hermes.update.available": return t("types.hermesAvailable");
    case "hermes.update.success": return t("types.hermesSuccess");
    case "hermes.update.error": return t("types.hermesError");
    case "health.xid": return t("types.healthXid");
    case "health.oom": return t("types.healthOom");
    case "health.thermal": return t("types.healthThermal");
    case "health.low-power": return t("types.healthLowPower");
    case "health.memory": return t("types.healthMemory");
    case "health.concurrency": return t("types.healthConcurrency");
    case "health.link-speed": return t("types.healthLinkSpeed");
    case "health.roce-link": return t("types.healthRoceLink");
    case "health.roce-loss": return t("types.healthRoceLoss");
    case "health.cleared": return t("types.healthCleared");
    case "alert.notify.sent": return t("types.notifySent");
    case "alert.notify.failed": return t("types.notifyFailed");
    case "power.shutdown": return t("types.powerShutdown");
    case "power.wake": return t("types.powerWake");
    default: return null;
  }
}

function benchName(t: TFunction<"activity">, kind: string): string | null {
  if (kind === "decode") return t("types.benchDecode");
  if (kind === "prefill") return t("types.benchPrefill");
  if (kind === "quality") return t("types.benchQuality");
  return null;
}

function benchLabel(t: TFunction<"activity">, name: string, stage: string): string | null {
  if (stage === "finished") return name;
  if (stage === "failed") return t("types.benchFailed", { name });
  if (stage === "cancelled") return t("types.benchCancelled", { name });
  return null;
}

/** The last part of an llm.* type ("completed") in the UI language; an unknown stage is kept as the server sent it. */
function llmStageText(t: TFunction<"activity">, stage: string): string {
  switch (stage) {
    case "requested": return t("llmStage.requested");
    case "started": return t("llmStage.started");
    case "running": return t("llmStage.running");
    case "completed": return t("llmStage.completed");
    case "failed": return t("llmStage.failed");
    case "cancelled": return t("llmStage.cancelled");
    case "stopped": return t("llmStage.stopped");
    case "attached": return t("llmStage.attached");
    case "detached": return t("llmStage.detached");
    default: return stage;
  }
}

function llmLabel(t: TFunction<"activity">, action: string, rawStage: string): string | null {
  const stage = llmStageText(t, rawStage);
  if (action === "start") return t("types.llmStart", { stage });
  if (action === "stop") return t("types.llmStop", { stage });
  if (action === "attach") return t("types.llmAttach", { stage });
  return null;
}

/** An unknown type is shown as its own id made readable ("foo.bar_baz" -> "Foo bar baz"). */
function sentence(t: TFunction<"activity">, s: string): string {
  const text = s.replace(/[._-]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : t("types.fallback");
}

function typeText(t: TFunction<"activity">, type: string): string {
  const known = knownLabel(t, type);
  if (known != null) return known;
  const parts = type.split(".");
  if (parts[0] === "bench" && parts.length === 3) {
    const name = benchName(t, parts[1]);
    const label = name == null ? null : benchLabel(t, name, parts[2]);
    if (label != null) return label;
  }
  if (parts[0] === "llm" && parts.length === 3) {
    const label = llmLabel(t, parts[1], parts[2]);
    if (label != null) return label;
  }
  return sentence(t, type);
}

/** Short human label for a type tag, e.g. "bench.decode.finished" -> "Decode bench". */
export function typeLabel(type: string, t?: TFunction<"activity">): string {
  return typeText(t ?? english(), type);
}

function categoryText(t: TFunction<"activity">, id: CategoryId): string {
  switch (id) {
    case "status": return t("category.status");
    case "thermal": return t("category.thermal");
    case "health": return t("category.health");
    case "alerts": return t("category.alerts");
    case "hermes": return t("category.hermes");
    case "bench": return t("category.bench");
    case "power": return t("category.power");
    case "llm": return t("category.llm");
    case "fleet": return t("category.fleet");
    default: return t("category.other");
  }
}

export function categoryLabel(id: CategoryId, t?: TFunction<"activity">): string {
  return categoryText(t ?? english(), id);
}

/** Newest first by id (ids are monotonic), ts as a tiebreak for odd inputs. */
function byNewest(a: ActivityEvent, b: ActivityEvent): number {
  return b.id - a.id || b.ts - a.ts;
}

/** Merge a page of events into a list: dedupe by id (incoming wins), newest first. */
export function mergeEvents(current: readonly ActivityEvent[], incoming: readonly ActivityEvent[]): ActivityEvent[] {
  const map = new Map<number, ActivityEvent>();
  for (const e of current) map.set(e.id, e);
  for (const e of incoming) map.set(e.id, e);
  return [...map.values()].sort(byNewest);
}

export function sparkKey(e: ActivityEvent): string {
  return e.sparkId ? e.sparkId : NO_SPARK;
}

function rangeCutoff(range: RangeId, now: number): number {
  return range === "24h" ? now - DAY_MS : range === "7d" ? now - 7 * DAY_MS : -Infinity;
}

type Dim = keyof ActivityFilter;

function matches(e: ActivityEvent, f: ActivityFilter, now: number, skip?: Dim, t?: TFunction<"activity">): boolean {
  if (skip !== "severities" && f.severities.length > 0 && !f.severities.includes(e.severity)) return false;
  if (skip !== "category" && f.category !== "all" && categorize(e.type) !== f.category) return false;
  if (skip !== "sparkId" && f.sparkId !== "all" && sparkKey(e) !== f.sparkId) return false;
  if (skip !== "range" && e.ts < rangeCutoff(f.range, now)) return false;
  if (skip !== "query") {
    const q = f.query.trim().toLowerCase();
    if (q) {
      // The type's label is searchable in English and in the page's language.
      const hay = `${e.message}\n${e.sparkName ?? ""}\n${e.type}\n${typeLabel(e.type)}\n${t ? typeLabel(e.type, t) : ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }
  return true;
}

/** Events matching every active filter dimension (order preserved). */
export function filterEvents(events: readonly ActivityEvent[], f: ActivityFilter, now: number = Date.now(), t?: TFunction<"activity">): ActivityEvent[] {
  return events.filter((e) => matches(e, f, now, undefined, t));
}

/** Faceted counts: each dimension is counted with all the OTHER filters applied. */
export function countBySeverity(events: readonly ActivityEvent[], f: ActivityFilter, now: number = Date.now(), t?: TFunction<"activity">): Record<Severity, number> {
  const out: Record<Severity, number> = { error: 0, warn: 0, success: 0, info: 0 };
  for (const e of events) if (matches(e, f, now, "severities", t) && e.severity in out) out[e.severity]++;
  return out;
}

export function countByCategory(events: readonly ActivityEvent[], f: ActivityFilter, now: number = Date.now(), t?: TFunction<"activity">): Record<CategoryId, number> {
  const out = Object.fromEntries(CATEGORIES.map((id) => [id, 0])) as Record<CategoryId, number>;
  for (const e of events) if (matches(e, f, now, "category", t)) out[categorize(e.type)]++;
  return out;
}

export function countBySpark(events: readonly ActivityEvent[], f: ActivityFilter, now: number = Date.now(), t?: TFunction<"activity">): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) if (matches(e, f, now, "sparkId", t)) out[sparkKey(e)] = (out[sparkKey(e)] ?? 0) + 1;
  return out;
}

export interface SparkOption {
  id: string;
  name: string;
}

/** Sparks from the live list plus any ids only seen in events (removed Sparks), sorted by name. */
export function sparkOptions(
  sparks: readonly { id: string; name?: string | null }[],
  events: readonly ActivityEvent[]
): SparkOption[] {
  const map = new Map<string, string>();
  for (const s of sparks) map.set(s.id, s.name || s.id);
  for (const e of events) {
    if (e.sparkId && !map.has(e.sparkId)) map.set(e.sparkId, e.sparkName || e.sparkId);
  }
  return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

// ── Local-day handling ──────────────────────────────────────────────

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(key: string, tz: string | undefined, opts: Intl.DateTimeFormatOptions, locale = "en-US"): Intl.DateTimeFormat {
  // No explicit zone: the Settings time zone, else the browser's.
  const zone = tz ?? configuredTimeZone() ?? undefined;
  const k = `${key}|${zone ?? ""}|${locale}`;
  let f = dtfCache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: zone });
    dtfCache.set(k, f);
  }
  return f;
}

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function ymd(ts: number, tz?: string): Ymd {
  const parts = dtf("ymd", tz, { year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(ts));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const keyOf = ({ y, m, d }: Ymd) => `${y}-${pad2(m)}-${pad2(d)}`;
const dayNumber = ({ y, m, d }: Ymd) => Date.UTC(y, m - 1, d) / DAY_MS;

/** "YYYY-MM-DD" of the calendar day containing ts in `tz` (default: browser-local). */
export function localDayKey(ts: number, tz?: string): string {
  return keyOf(ymd(ts, tz));
}

function parseKey(key: string): Ymd {
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

/** Format a day key with Intl options (the key is a plain calendar date, so UTC is exact). */
function formatDayKey(key: string, opts: Intl.DateTimeFormatOptions, locale: string): string {
  const { y, m, d } = parseKey(key);
  return dtf(`dk${JSON.stringify(opts)}`, "UTC", opts, locale).format(new Date(Date.UTC(y, m - 1, d)));
}

function shiftKey(key: string, days: number): string {
  const { y, m, d } = parseKey(key);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return keyOf({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

/** "Today", "Yesterday", else "Tuesday, Oct 7" (adds the year when it differs from now's). */
function dayText(t: TFunction<"activity">, key: string, now: number, tz?: string): string {
  const today = ymd(now, tz);
  const diff = dayNumber(today) - dayNumber(parseKey(key));
  if (diff === 0) return t("day.today");
  if (diff === 1) return t("day.yesterday");
  const sameYear = parseKey(key).y === today.y;
  const opts: Intl.DateTimeFormatOptions = sameYear
    ? { weekday: "long", month: "short", day: "numeric" }
    : { weekday: "long", month: "short", day: "numeric", year: "numeric" };
  return formatDayKey(key, opts, t("day.intlLocale"));
}

export function dayLabel(key: string, now: number = Date.now(), tz?: string, t?: TFunction<"activity">): string {
  return dayText(t ?? english(), key, now, tz);
}

function intlLocale(t: TFunction<"activity">): string {
  return t("day.intlLocale");
}

/** "14:05" 24-hour local time. */
export function formatClock(ts: number, tz?: string): string {
  return dtf("clock", tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ts));
}

/** "2026-10-07 14:05:09" in `tz`. */
export function formatStamp(ts: number, tz?: string): string {
  const parts = dtf("stamp", tz, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ts));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}:${g("second")}`;
}

export interface DayGroup {
  key: string;
  label: string;
  events: ActivityEvent[];
}

/** Group events (in the given order) by local day; groups keep first-seen order. */
export function groupByDay(events: readonly ActivityEvent[], now: number = Date.now(), tz?: string, t?: TFunction<"activity">): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const e of events) {
    const key = localDayKey(e.ts, tz);
    let g = groups.get(key);
    if (!g) {
      g = { key, label: dayLabel(key, now, tz, t), events: [] };
      groups.set(key, g);
    }
    g.events.push(e);
  }
  return [...groups.values()];
}

export interface DayBucket {
  key: string;
  /** Short axis label ("Oct 7"). */
  label: string;
  /** Tooltip heading ("Tue, Oct 7"). */
  title: string;
  counts: Record<Severity, number>;
}

/** One bucket per local day for the last `days` days (oldest first, today last), zero-filled. */
export function eventsPerDay(events: readonly ActivityEvent[], now: number = Date.now(), days = 14, tz?: string, t?: TFunction<"activity">): DayBucket[] {
  const today = localDayKey(now, tz);
  const locale = intlLocale(t ?? english());
  const buckets: DayBucket[] = [];
  const index = new Map<string, DayBucket>();
  for (let i = days - 1; i >= 0; i--) {
    const key = shiftKey(today, -i);
    const b: DayBucket = {
      key,
      label: formatDayKey(key, { month: "short", day: "numeric" }, locale),
      title: formatDayKey(key, { weekday: "short", month: "short", day: "numeric" }, locale),
      counts: { error: 0, warn: 0, success: 0, info: 0 },
    };
    buckets.push(b);
    index.set(key, b);
  }
  for (const e of events) {
    const b = index.get(localDayKey(e.ts, tz));
    if (b && e.severity in b.counts) b.counts[e.severity]++;
  }
  return buckets;
}

export interface ActivitySummary {
  events24h: number;
  events7d: number;
  errors24h: number;
  errors7d: number;
  warnings24h: number;
  warnings7d: number;
  /** Sparks with at least one error or warning in the last 24 h. */
  problemSparks24h: number;
  problemSparks7d: number;
  mostActive: { sparkId: string; name: string; count: number } | null;
}

/** Headline numbers; the most active Spark is over the last 24 h, falling back to 7 d when quiet. */
export function summarize(events: readonly ActivityEvent[], now: number = Date.now()): ActivitySummary {
  const c24 = now - DAY_MS;
  const c7 = now - 7 * DAY_MS;
  const s: ActivitySummary = {
    events24h: 0, events7d: 0, errors24h: 0, errors7d: 0, warnings24h: 0, warnings7d: 0,
    problemSparks24h: 0, problemSparks7d: 0, mostActive: null,
  };
  const prob24 = new Set<string>();
  const prob7 = new Set<string>();
  const per24 = new Map<string, { name: string; count: number }>();
  const per7 = new Map<string, { name: string; count: number }>();
  const bump = (m: Map<string, { name: string; count: number }>, e: ActivityEvent) => {
    const k = e.sparkId as string;
    const cur = m.get(k);
    if (cur) cur.count++;
    else m.set(k, { name: e.sparkName || k, count: 1 });
  };
  for (const e of events) {
    if (e.ts < c7 || e.ts > now + HOUR_MS) continue;
    s.events7d++;
    const problem = e.severity === "error" || e.severity === "warn";
    if (e.severity === "error") s.errors7d++;
    if (e.severity === "warn") s.warnings7d++;
    if (problem && e.sparkId) prob7.add(e.sparkId);
    if (e.sparkId) bump(per7, e);
    if (e.ts >= c24) {
      s.events24h++;
      if (e.severity === "error") s.errors24h++;
      if (e.severity === "warn") s.warnings24h++;
      if (problem && e.sparkId) prob24.add(e.sparkId);
      if (e.sparkId) bump(per24, e);
    }
  }
  s.problemSparks24h = prob24.size;
  s.problemSparks7d = prob7.size;
  const best = (m: Map<string, { name: string; count: number }>) => {
    let top: ActivitySummary["mostActive"] = null;
    for (const [sparkId, v] of m) {
      if (!top || v.count > top.count || (v.count === top.count && v.name.localeCompare(top.name) < 0)) {
        top = { sparkId, name: v.name, count: v.count };
      }
    }
    return top;
  };
  s.mostActive = best(per24) ?? best(per7);
  return s;
}

/** Plain-text export, one line per event, in the order given; labels in the caller's language, messages as sent. */
export function exportText(events: readonly ActivityEvent[], tz?: string, t?: TFunction<"activity">): string {
  return events
    .map((e) => {
      return `${formatStamp(e.ts, tz)} [${severityLabel(e.severity, t)}] ${typeLabel(e.type, t)} - ${e.message}`.replace(/\s+/g, " ");
    })
    .join("\n");
}

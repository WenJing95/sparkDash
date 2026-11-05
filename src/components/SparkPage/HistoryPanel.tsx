import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { getUnitHistory } from "../../api/client";
import type {
  HistoryStat,
  MetricsHistoryData,
  MetricsHistoryRange,
  MetricsHistoryResponse,
} from "../../api/types";
import { formatBytesPerSec, formatMb } from "../../shared/formatBytes";
import { configuredTimeZone } from "../../shared/timeZone";
import { HEADROOM_THRESHOLDS_MB, memoryModelFor } from "../../shared/vramBreakdown";
import { Panel } from "../ui/Panel";
import { ChartIcon } from "../ui/icons";
import { HistoryChart, type HistoryChartSeries, type HistoryThreshold } from "./HistoryChart";

/**
 * The unit's server-side history (Settings → Metrics history): 48 h of 1-minute and
 * 30 days of 15-minute buckets from GET /api/sparks/:id/history, as small multiples
 * with a shared crosshair. Polls every 30 s, and only while the panel is on screen
 * and the tab is visible.
 */

export const HISTORY_RANGES: readonly MetricsHistoryRange[] = ["1h", "6h", "24h", "7d", "30d"];
export const HISTORY_POLL_MS = 30_000;
export const HISTORY_RANGE_KEY = "sparkdash.ui.history.range";

function rangeTitle(range: MetricsHistoryRange, t: TFunction<"spark">): string {
  switch (range) {
    case "1h":
      return t("history.rangeLastHour");
    case "6h":
      return t("history.rangeLast6h");
    case "24h":
      return t("history.rangeLast24h");
    case "7d":
      return t("history.rangeLast7d");
    case "30d":
      return t("history.rangeLast30d");
  }
}

export function readHistoryRange(): MetricsHistoryRange {
  try {
    const raw = localStorage.getItem(HISTORY_RANGE_KEY);
    if (raw && (HISTORY_RANGES as readonly string[]).includes(raw)) return raw as MetricsHistoryRange;
  } catch {
    /* private mode / blocked storage */
  }
  return "1h";
}

function writeHistoryRange(range: MetricsHistoryRange) {
  try {
    localStorage.setItem(HISTORY_RANGE_KEY, range);
  } catch {
    /* a preference is a convenience */
  }
}

function stepLabel(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

const pct = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
const watts = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)} W`;
const tokS = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : v >= 100 ? v.toFixed(0) : v.toFixed(1);

/** Tooltip and axis labels, in Settings → Time zone like the other charts. */
function timeFormatters(range: MetricsHistoryRange, locale: string | undefined) {
  const timeZone = configuredTimeZone() ?? undefined;
  const long = range === "7d" || range === "30d";
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" });
  const day = new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric" });
  const dayTime = new Intl.DateTimeFormat(locale, {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return {
    tooltip: (t: number) => (range === "1h" || range === "6h" ? time.format(t) : dayTime.format(t)),
    axis: (t: number) => (long ? day.format(t) : time.format(t)),
    /** When the data on screen was fetched. */
    stamp: (t: number) => time.format(t),
  };
}

interface ChartDef {
  id: string;
  title: string;
  series: HistoryChartSeries[];
  format: (v: number) => string;
  yMin?: number;
  yMax?: number;
  yUnit?: number;
  thresholds?: HistoryThreshold[];
}

/** Every bucket start in the response (unit and LLM points), ascending. */
export function buildTimeline(data: MetricsHistoryData): number[] {
  const ts = new Set<number>();
  for (const p of data.points) ts.add(p.t);
  for (const e of data.llm) for (const p of e.points) ts.add(p.t);
  return [...ts].sort((a, b) => a - b);
}

function aligned<P extends { t: number }>(
  timeline: readonly number[],
  points: readonly P[],
  pick: (p: P) => HistoryStat | undefined,
  map?: (v: number) => number,
): Array<HistoryStat | null> {
  const at = new Map<number, HistoryStat>();
  for (const p of points) {
    const v = pick(p);
    if (v) at.set(p.t, map ? { avg: map(v.avg), max: map(v.max), min: v.min != null ? map(v.min) : undefined } : v);
  }
  return timeline.map((t) => at.get(t) ?? null);
}

const hasAny = (values: ReadonlyArray<HistoryStat | null>) => values.some(Boolean);

/**
 * Domain rank for the small multiples: hardware first, then the per-port LLM charts, then
 * system/IO. The charts are built in metric order, so the rank is applied as a stable sort at
 * the end: a new chart joins its domain without reordering every push site.
 */
const SYSTEM_CHART_IDS = new Set(["ramUsed", "network"]);

function chartDomain(id: string): number {
  if (id.startsWith("llm-")) return 1;
  return SYSTEM_CHART_IDS.has(id) ? 2 : 0;
}

function buildCharts(
  data: MetricsHistoryData,
  timeline: readonly number[],
  kind: string | undefined,
  platform: string | undefined,
  temperatureUnit: "celsius" | "fahrenheit",
  t: TFunction<"spark">,
): ChartDef[] {
  const pts = data.points;
  const f = temperatureUnit === "fahrenheit";
  const toTemp = f ? (c: number) => (c * 9) / 5 + 32 : undefined;
  const temp = (v: number) => `${Math.round(v)}°${f ? "F" : "C"}`;
  const accent = "var(--color-accent)";
  const model = memoryModelFor(kind, platform);
  const headroom = HEADROOM_THRESHOLDS_MB[model];

  // The free line and its headroom thresholds are one question with one scale. The used split is
  // a different question at a different magnitude (a 109 GB GPU share against 6 GB free), so it
  // gets its own chart rather than sharing this y-axis: on one domain the free trace collapsed to
  // a sub-pixel band and the two threshold labels landed 3 px apart (#350 review).
  const memFree = aligned(timeline, pts, (p) => p.memFreeMB);
  const gpuUsed = model === "unified" ? aligned(timeline, pts, (p) => p.memGpuMB) : null;
  const sysUsed = model === "unified" ? aligned(timeline, pts, (p) => p.memSysMB) : null;
  // A unified pool has two owners — the GPU/model side and everything else — so the split answers
  // "what consumed the pool" (#336) as a trend of its own. A discrete card's `used` figure is the
  // GPU's alone, so there is nothing to split and no chart is added.
  const memSplit: ChartDef | null =
    gpuUsed && sysUsed && hasAny(gpuUsed) && hasAny(sysUsed)
      ? {
          id: "memSplit",
          title: t("history.memoryUsed"),
          format: formatMb,
          yMin: 0,
          yUnit: 1024,
          series: [
            { key: "memGpuMB", label: "GPU", color: "var(--color-violet)", band: "max", values: gpuUsed },
            { key: "memSysMB", label: t("history.system"), color: "var(--color-info)", band: "max", values: sysUsed },
          ],
        }
      : null;

  const charts: ChartDef[] = [
    {
      id: "gpuUtil",
      title: t("history.gpuUtil"),
      format: pct,
      yMin: 0,
      yMax: 100,
      series: [{ key: "gpuUtil", label: "GPU", color: accent, band: "max", values: aligned(timeline, pts, (p) => p.gpuUtil) }],
    },
    {
      id: "gpuTemp",
      title: t("history.gpuTemp"),
      format: temp,
      yUnit: 5,
      series: [{ key: "gpuTemp", label: "GPU", color: "var(--color-info)", band: "max", values: aligned(timeline, pts, (p) => p.gpuTemp, toTemp) }],
    },
    {
      id: "gpuPower",
      title: t("history.gpuPower"),
      format: watts,
      yMin: 0,
      series: [{ key: "gpuPower", label: t("history.power"), color: "var(--color-violet)", band: "max", values: aligned(timeline, pts, (p) => p.gpuPower) }],
    },
    {
      id: "memFree",
      title: model === "unified" ? t("history.memFreeUnified") : t("history.vramFree"),
      format: formatMb,
      yMin: 0,
      yUnit: 1024,
      thresholds: [
        { value: headroom.low, label: t("history.thresholdLow", { size: formatMb(headroom.low) }), color: "var(--color-warning)" },
        { value: headroom.critical, label: t("history.thresholdCritical", { size: formatMb(headroom.critical) }), color: "var(--color-danger)" },
      ],
      series: [{ key: "memFreeMB", label: t("history.free"), color: "var(--color-success)", band: "min", values: memFree }],
    },
    ...(memSplit ? [memSplit] : []),
    {
      id: "cpuUtil",
      title: t("history.cpuUtil"),
      format: pct,
      yMin: 0,
      yMax: 100,
      series: [{ key: "cpuUtil", label: "CPU", color: accent, band: "max", values: aligned(timeline, pts, (p) => p.cpuUtil) }],
    },
    {
      id: "cpuTemp",
      title: t("history.cpuTemp"),
      format: temp,
      yUnit: 5,
      series: [{ key: "cpuTemp", label: "CPU", color: "var(--color-info)", band: "max", values: aligned(timeline, pts, (p) => p.cpuTemp, toTemp) }],
    },
  ];

  const ram = aligned(timeline, pts, (p) => p.ramUsedMB);
  // Only a discrete host has RAM apart from the memory charted above; a Mac's RAM is that unified pool.
  if (model === "discrete" && hasAny(ram)) {
    charts.push({
      id: "ramUsed",
      title: t("history.ramUsed"),
      format: formatMb,
      yMin: 0,
      yUnit: 1024,
      series: [{ key: "ramUsedMB", label: t("history.used"), color: accent, band: "max", values: ram }],
    });
  }

  charts.push({
    id: "network",
    title: t("history.network"),
    format: (v) => formatBytesPerSec(Math.round(v)),
    yMin: 0,
    series: [
      { key: "netRx", label: "↓ rx", color: accent, values: aligned(timeline, pts, (p) => p.netRx) },
      { key: "netTx", label: "↑ tx", color: "var(--color-info)", values: aligned(timeline, pts, (p) => p.netTx) },
    ],
  });

  for (const endpoint of data.llm) {
    const port = endpoint.port;
    const lp = endpoint.points;
    charts.push(
      {
        id: `llm-${port}-gen`,
        title: t("history.decodeTitle", { port }),
        format: tokS,
        yMin: 0,
        series: [{ key: "genTps", label: t("history.decode"), color: accent, band: "max", values: aligned(timeline, lp, (p) => p.genTps) }],
      },
      {
        id: `llm-${port}-prefill`,
        title: t("history.prefillTitle", { port }),
        format: tokS,
        yMin: 0,
        series: [{ key: "prefillTps", label: t("history.prefill"), color: "var(--color-violet)", band: "max", values: aligned(timeline, lp, (p) => p.prefillTps) }],
      },
    );
    const kv = aligned(timeline, lp, (p) => p.kvUsage, (v) => v * 100);
    if (hasAny(kv)) {
      charts.push({
        id: `llm-${port}-kv`,
        title: t("history.kvTitle", { port }),
        format: pct,
        yMin: 0,
        yMax: 100,
        series: [{ key: "kvUsage", label: "KV", color: "var(--color-mem-engine)", band: "max", values: kv }],
      });
    }
  }
  // Stable sort: within a domain the metric order above is kept.
  return charts.sort((a, b) => chartDomain(a.id) - chartDomain(b.id));
}

/**
 * Whether the element the returned ref is attached to is on screen. Without
 * IntersectionObserver (old browsers, tests) it counts as visible.
 */
function useOnScreen(): [(el: HTMLElement | null) => void, boolean] {
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  const observer = useRef<IntersectionObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el || typeof IntersectionObserver === "undefined") return;
    observer.current = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setVisible(entry.isIntersecting);
    });
    observer.current.observe(el);
  }, []);
  return [ref, visible];
}

function useTabVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

/**
 * Poll the history endpoint while `active`; the last answer stays on screen while paused, and
 * after a failed refresh (`error` set with `data`, `loadedAt` saying when it was fetched).
 */
function useUnitHistory(sparkId: string, range: MetricsHistoryRange, active: boolean) {
  const [data, setData] = useState<MetricsHistoryResponse | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A new unit or range starts from "loading", not from the previous answer.
  useEffect(() => {
    setData(null);
    setLoadedAt(null);
    setError(null);
  }, [sparkId, range]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = () => {
      getUnitHistory(sparkId, range)
        .then((res) => {
          if (cancelled) return;
          setData(res);
          setLoadedAt(Date.now());
          setError(null);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        });
    };
    load();
    const timer = setInterval(load, HISTORY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sparkId, range, active]);

  return { data, loadedAt, error };
}

export function HistoryPanel({
  sparkId,
  kind,
  platform,
  temperatureUnit,
}: {
  sparkId: string;
  kind?: string;
  /** A macOS host's memory is unified, like a Spark's. */
  platform?: string;
  temperatureUnit: "celsius" | "fahrenheit";
}) {
  const { t, i18n } = useTranslation("spark");
  const locale = i18n.resolvedLanguage;
  const [range, setRange] = useState<MetricsHistoryRange>(readHistoryRange);
  /** Shared crosshair: one timestamp for every chart. */
  const [cursorT, setCursorT] = useState<number | null>(null);
  const [screenRef, onScreen] = useOnScreen();
  const tabVisible = useTabVisible();
  const { data, loadedAt, error } = useUnitHistory(sparkId, range, onScreen && tabVisible);

  const enabled = data?.enabled === true ? data : null;
  const timeline = useMemo(() => (enabled ? buildTimeline(enabled) : []), [enabled]);
  const charts = useMemo(
    () => (enabled ? buildCharts(enabled, timeline, kind, platform, temperatureUnit, t) : []),
    [enabled, timeline, kind, platform, temperatureUnit, t],
  );
  const formats = useMemo(() => timeFormatters(range, locale), [range, locale]);

  const pick = (next: MetricsHistoryRange) => {
    if (next === range) return;
    writeHistoryRange(next);
    setCursorT(null);
    setRange(next);
  };

  const chips = (
    <div className="seg" role="group" aria-label={t("history.rangeGroup")}>
      {HISTORY_RANGES.map((r) => (
        <button
          key={r}
          type="button"
          className={r === range ? "is-on" : ""}
          aria-pressed={r === range}
          onClick={() => pick(r)}
        >
          {r}
        </button>
      ))}
    </div>
  );

  let body;
  if (error && !data) {
    body = <p className="sp-error">{t("history.loadError", { error })}</p>;
  } else if (!data) {
    body = <p className="sp-muted">{t("history.loading")}</p>;
  } else if (!enabled) {
    body = <p className="sp-muted">{t("history.off")}</p>;
  } else if (timeline.length === 0) {
    body = (
      <div className="sp-chart sp-chart--empty">
        <p className="sp-chart__note">{t("history.empty")}</p>
      </div>
    );
  } else {
    body = (
      <>
        <p className="sp-hint">
          {t("history.hint", { step: stepLabel(enabled.stepMs) })}
        </p>
        <div className="sp-hist-grid">
          {charts.map((c) => (
            <HistoryChart
              key={c.id}
              id={c.id}
              title={c.title}
              timeline={timeline}
              stepMs={enabled.stepMs}
              from={enabled.from}
              to={enabled.to}
              series={c.series}
              format={c.format}
              yMin={c.yMin}
              yMax={c.yMax}
              yUnit={c.yUnit}
              thresholds={c.thresholds}
              cursorT={cursorT}
              onCursor={setCursorT}
              formatTime={formats.tooltip}
              formatAxisTime={formats.axis}
            />
          ))}
        </div>
      </>
    );
  }

  // A refresh failed after an earlier answer: keep that answer on screen, but say it is stale.
  const stale =
    error && data && loadedAt !== null ? (
      <p className="sp-error" role="status">
        {t("history.stale", { error, time: formats.stamp(loadedAt) })}
      </p>
    ) : null;

  return (
    <div ref={screenRef} className="sp-hist">
      <Panel title={t("history.title", { range: rangeTitle(range, t) })} icon={<ChartIcon />} actions={chips} bodyClassName="sp-stack sp-stack--tight">
        {stale}
        {body}
      </Panel>
    </div>
  );
}

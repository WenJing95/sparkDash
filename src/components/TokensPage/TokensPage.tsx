import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { fetchTokenHistory, resetTokenTotals } from "../../api/client";
import { ClearMenu, type ClearChoice } from "../ui/ClearMenu";
import { fetchLlmTokenTotals } from "../../api/llmTokenClient";
import type { LlmTokenSeriesTotals } from "../../api/llmTokenTypes";
import type { SparkSnapshot, TokenHistory } from "../../api/types";
import { formatTokensCompact } from "../../shared/tokenFormat";
import { StackedBarChart, type BarBucket, type BarSeries } from "../ui/StackedBarChart";
import { EndpointTable, ModelTable } from "./TokenTables";
import {
  OTHER_ID,
  RANGES,
  bucketDate,
  bucketLabel,
  bucketTitle,
  bucketTotals,
  buildCsv,
  buildInsights,
  compare,
  endpointRows,
  entriesFromTotals,
  fmtPct,
  groupBuckets,
  lastSeenByModel,
  modelRows,
  rangeLabel,
  rangePhrase,
  rangeSpan,
  rowsIn,
  summarize,
  tallyOf,
  trackedBuckets,
  windowFor,
  type Comparison,
  type GroupBy,
  type RangeKey,
  type RangeSpec,
  type Summary,
} from "./tokenStats";
import "../../styles/tokens.css";

const POLL_MS = 30_000;
const fmt = formatTokensCompact;

const GROUPS: GroupBy[] = ["type", "model", "spark"];

function groupLabel(key: GroupBy, t: TFunction<"tokens">): string {
  return key === "type" ? t("group.type") : key === "model" ? t("group.model") : t("group.spark");
}

/** Lower-case group name for the chart's screen-reader label. */
function groupAria(key: GroupBy, t: TFunction<"tokens">): string {
  return key === "type" ? t("group.typeAria") : key === "model" ? t("group.modelAria") : t("group.sparkAria");
}
const TYPE_COLORS: Record<string, string> = {
  generated: "var(--color-accent)",
  cached: "var(--color-info)",
  computed: "var(--color-violet)",
  unreported: "var(--color-faint)",
};
const GROUP_COLORS = ["var(--color-accent)", "var(--color-info)", "var(--color-violet)", "var(--color-success)", "var(--color-warning)"];

interface Loaded {
  history: TokenHistory;
  /** Lifetime totals; null when that endpoint failed (All time then falls back to retained days). */
  lifetime: LlmTokenSeriesTotals[] | null;
  at: number;
}

export function TokensPage({ sparks, onSelectSpark }: { sparks: SparkSnapshot[]; onSelectSpark?: (id: string) => void }) {
  const { t, i18n } = useTranslation("tokens");
  const locale = i18n.resolvedLanguage;
  const [range, setRange] = useState<RangeKey>("7d");
  const [groupBy, setGroupBy] = useState<GroupBy>("type");
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [copyMsg, setCopyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      Promise.all([fetchTokenHistory(), fetchLlmTokenTotals("all").then((r) => r.series || []).catch(() => null)])
        .then(([history, lifetime]) => {
          if (cancelled) return;
          setData({ history, lifetime, at: Date.now() });
          setError(null);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : t("errors.loadFallback"));
        });
    };
    run();
    const id = setInterval(() => {
      if (!document.hidden) run();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tick]);

  useEffect(() => {
    if (!copyMsg) return;
    const timer = setTimeout(() => setCopyMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [copyMsg]);

  const sparkNames = useMemo(() => new Map(sparks.map((s) => [s.id, s.name])), [sparks]);
  const tokenResetChoices = useMemo<ClearChoice<string | undefined>[]>(
    () => [
      { id: "all", label: t("reset.allSparks"), ask: t("reset.askAll"), arg: undefined },
      ...sparks.map((s) => ({ id: s.id, label: s.name, ask: t("reset.askOne", { name: s.name }), arg: s.id })),
    ],
    [sparks, t]
  );
  const sparkName = useCallback((id: string) => sparkNames.get(id) || id, [sparkNames]);
  const knownSpark = useCallback((id: string) => sparkNames.has(id), [sparkNames]);

  const view = useMemo(() => {
    if (!data) return null;
    const { history, lifetime, at } = data;
    const w = windowFor(range, history, at);
    const unit = w.spec.unit;
    const source = unit === "hour" ? history.hour : history.day;
    const inRange = rowsIn(source, w.keys);
    const useLifetime = range === "all" && lifetime != null;
    const entries = useLifetime ? entriesFromTotals(lifetime) : inRange;
    const tally = tallyOf(entries);
    const totals = bucketTotals(inRange, w.keys);
    const elapsed = range === "all" ? trackedBuckets(w.firstKey, "day", at) ?? undefined : undefined;
    const summary = summarize(tally, totals, w.firstKey, elapsed);
    const comparison = w.prevKeys.length ? compare(tally, tallyOf(rowsIn(source, w.prevKeys))) : null;
    const models = modelRows(entries, lifetime ? lastSeenByModel(lifetime) : undefined);
    const endpoints = endpointRows(entries);
    const hasRetainedHistory = history.day.length > 0 || history.hour.length > 0;
    return { w, unit, inRange, tally, totals, summary, comparison, models, endpoints, at, hasRetainedHistory, useLifetime };
  }, [data, range]);

  const grouped = useMemo(
    () => (view ? groupBuckets(view.inRange, view.w.keys, groupBy, { sparkName }, t) : null),
    [view, groupBy, sparkName, t]
  );

  const insights = useMemo(
    () =>
      view
        ? buildInsights({
            spec: view.w.spec,
            summary: view.summary,
            comparison: view.comparison,
            models: view.models,
            endpoints: view.endpoints,
            totals: view.totals,
            firstKey: view.w.firstKey,
            sparkName,
            locale,
          }, t)
        : [],
    [view, sparkName, locale, t]
  );

  const copyCsv = async () => {
    if (!view) return;
    const text = buildCsv(view.inRange, sparkName);
    const n = view.inRange.length;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error("no clipboard");
      setCopyMsg({ ok: true, text: t("copy.copied", { count: n }) });
    } catch {
      // Insecure origins block the async clipboard API; fall back to a hidden textarea.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.className = "tk-sr";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        setCopyMsg(ok ? { ok: true, text: t("copy.copied", { count: n }) } : { ok: false, text: t("copy.failed") });
      } catch {
        setCopyMsg({ ok: false, text: t("copy.failed") });
      }
    }
  };

  const spec = RANGES.find((r) => r.key === range) ?? RANGES[1];
  const hourly = spec.unit === "hour";
  const period = rangePhrase(spec.key, t);

  const series: BarSeries[] = (grouped?.series ?? []).map((s, i) => ({
    id: s.id,
    label: s.label,
    color: groupBy === "type" ? TYPE_COLORS[s.id] : s.id === OTHER_ID ? "var(--color-faint)" : GROUP_COLORS[i % GROUP_COLORS.length],
  }));
  const buckets: BarBucket[] = (grouped?.buckets ?? []).map((b) => ({
    key: b.key,
    label: bucketLabel(b.key, spec.unit, undefined, locale),
    title: bucketTitle(b.key, spec.unit, undefined, t, locale),
    values: b.values,
  }));
  const chartEmpty = range === "24h" ? t("chart.emptyHourly") : t("chart.emptyRange");

  return (
    <div className="tk">
      <header className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="page-head__sub">{t("subtitle")}</p>
        </div>
        <div className="page-head__tools">
          <div className="seg" role="group" aria-label={t("range.aria")}>
            {RANGES.map((r) => (
              <button key={r.key} type="button" className={r.key === range ? "is-on" : undefined} aria-pressed={r.key === range} onClick={() => setRange(r.key)}>
                {rangeLabel(r.key, t)}
              </button>
            ))}
          </div>
          <ClearMenu
            label={t("reset.label")}
            choices={tokenResetChoices}
            note={t("reset.note")}
            onRun={async (id) => {
              const { removed } = await resetTokenTotals(id);
              setTick((t) => t + 1);
              return removed;
            }}
          />
          <button type="button" className="btn btn--sm" onClick={copyCsv} disabled={!view || view.inRange.length === 0}>
            {t("copy.button")}
          </button>
          <span className={`tk-copymsg${copyMsg && !copyMsg.ok ? " is-err" : ""}`} role="status" aria-live="polite">
            {copyMsg?.text}
          </span>
        </div>
      </header>

      {!data && !error ? (
        <div className="panel tk-note" role="status">
          {t("loading")}
        </div>
      ) : null}

      {error ? (
        <div className="panel tk-note tk-note--err" role="alert">
          <span>{data ? t("errors.stale", { error }) : t("errors.load", { error })}</span>
          <button type="button" className="btn btn--sm" onClick={() => setTick((t) => t + 1)}>
            {t("retry")}
          </button>
        </div>
      ) : null}

      {view ? (
        <>
          {view.summary.total > 0 ? <Tiles s={view.summary} cmp={view.comparison} spec={spec} /> : null}

          <div className="tk-grid">
            <section className="panel tk-card" aria-labelledby="tk-chart-title">
              <div className="tk-card__head">
                <div>
                  <h2 id="tk-chart-title" className="tk-card__title">
                    {hourly ? t("chart.titleHour") : t("chart.titleDay")}
                  </h2>
                  <p className="tk-card__sub">
                    {hourly ? t("chart.subHour") : range === "all" ? t("chart.subAll") : t("chart.subDay")}
                  </p>
                </div>
                <div className="tk-card__tools">
                  <span className="eyebrow">{t("chart.groupBy")}</span>
                  <div className="seg" role="group" aria-label={t("chart.groupAria")}>
                    {GROUPS.map((g) => (
                      <button key={g} type="button" className={g === groupBy ? "is-on" : undefined} aria-pressed={g === groupBy} onClick={() => setGroupBy(g)}>
                        {groupLabel(g, t)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <StackedBarChart
                buckets={buckets}
                series={series}
                height={260}
                format={fmt}
                unit={t("chart.unit")}
                empty={chartEmpty}
                ariaLabel={
                  hourly
                    ? t("chart.ariaHour", { period, group: groupAria(groupBy, t) })
                    : t("chart.ariaDay", { period, group: groupAria(groupBy, t) })
                }
              />
              <ul className="legend tk-legend">
                {series.map((s, i) => (
                  <li key={s.id} style={{ "--c": s.color } as CSSProperties}>
                    <span>{s.label}</span>
                    <em className="mono">{fmt(grouped?.series[i].total ?? 0)}</em>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel tk-card" aria-labelledby="tk-insights-title">
              <h2 id="tk-insights-title" className="tk-card__title">
                {t("insights.title")}
              </h2>
              {insights.length > 0 ? (
                <ul className="tk-insights">
                  {insights.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="tk-card__sub">{t("insights.empty", { period })}</p>
              )}
            </section>
          </div>

          {view.summary.total > 0 ? (
            <>
              <section className="panel tk-card" aria-labelledby="tk-models-title">
                <div className="tk-card__head">
                  <div>
                    <h2 id="tk-models-title" className="tk-card__title">
                      {t("models.title")}
                    </h2>
                    <p className="tk-card__sub">{t("models.sub", { count: view.models.length, period })}</p>
                  </div>
                </div>
                <ModelTable rows={view.models} sparkName={sparkName} nowMs={view.at} />
              </section>

              <section className="panel tk-card" aria-labelledby="tk-eps-title">
                <div className="tk-card__head">
                  <div>
                    <h2 id="tk-eps-title" className="tk-card__title">
                      {t("endpoints.title")}
                    </h2>
                    <p className="tk-card__sub">{t("endpoints.sub")}</p>
                  </div>
                </div>
                <EndpointTable rows={view.endpoints} sparkName={sparkName} knownSpark={knownSpark} onSelectSpark={onSelectSpark} />
              </section>
            </>
          ) : (
            <section className="panel tk-note" role="status">
              <b>{t("empty.title", { period })}</b>
              <span>{view.hasRetainedHistory ? t("empty.tryLonger") : t("empty.firstRun")}</span>
            </section>
          )}

          <section className="panel tk-card tk-about" aria-labelledby="tk-about-title">
            <h2 id="tk-about-title" className="tk-card__title">
              {t("about.title")}
            </h2>
            <ul>
              <li>
                {t("about.bucketsBefore")}
                <b>{t("about.utcDays")}</b>
                {t("about.bucketsAfter")}
                {data?.history.firstDay ? (
                  <>
                    {" "}
                    {t("about.trackingBefore")}
                    <b>{data.history.firstDay}</b>
                    {t("about.trackingAfter")}
                  </>
                ) : null}
              </li>
              <li>{t("about.restarts")}</li>
              <li>{t("about.retention", { hours: data?.history.retention.hours ?? 72, days: data?.history.retention.days ?? 35 })}</li>
              <li>
                <b>{t("about.allTime")}</b>
                {data?.lifetime ? t("about.allTimeBody") : t("about.allTimeBodyFallback")}
              </li>
              <li>{t("about.definitions")}</li>
              {view.w.prevKeys.length === 0 && spec.count != null ? <li>{t("about.noPrevious", { span: rangeSpan(spec.key, t) })}</li> : null}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Delta({ value, span }: { value: number | null | undefined; span: string }) {
  const { t } = useTranslation("tokens");
  if (value == null || !Number.isFinite(value)) return null;
  const flat = Math.abs(value) < 0.005;
  const arrow = <span aria-hidden="true" />;
  return (
    <span className={`tk-delta ${flat ? "" : value > 0 ? "is-up" : "is-down"}`}>
      {flat ? (
        <Trans t={t} i18nKey="tiles.flatVsPrev" values={{ span }} components={{ arrow }} />
      ) : (
        <Trans t={t} i18nKey="tiles.deltaVsPrev" values={{ arrow: value > 0 ? "▲" : "▼", value: fmtPct(Math.abs(value)), span }} components={{ arrow }} />
      )}
    </span>
  );
}

function Tile({ label, value, unit, sub, delta, title }: { label: string; value: string; unit?: string; sub?: string; delta?: React.ReactNode; title?: string }) {
  return (
    <div className="tk-tile" title={title}>
      <span className="eyebrow">{label}</span>
      <div className="big-num">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {sub ? <p className="tk-tile__sub">{sub}</p> : null}
      {delta}
    </div>
  );
}

function Tiles({ s, cmp, spec }: { s: Summary; cmp: Comparison | null; spec: RangeSpec }) {
  const { t, i18n } = useTranslation("tokens");
  const hourly = spec.unit === "hour";
  const span = rangeSpan(spec.key, t);
  const ratio = s.genPerPrompt != null && s.generated > 0 ? s.prompt / s.generated : null;
  const ratioText = ratio == null ? "" : ratio >= 10 ? String(Math.round(ratio)) : ratio.toFixed(1);
  return (
    <section className="tk-tiles" aria-label={t("tiles.aria", { period: rangePhrase(spec.key, t) })}>
      <Tile label={t("tiles.total")} value={fmt(s.total)} sub={t("tiles.totalSub")} title={s.total.toLocaleString()} delta={<Delta value={cmp?.total} span={span} />} />
      <Tile
        label={t("tiles.generated")}
        value={fmt(s.generated)}
        sub={s.total > 0 ? t("tiles.generatedSub", { pct: fmtPct(s.generated / s.total) }) : undefined}
        title={s.generated.toLocaleString()}
        delta={<Delta value={cmp?.generated} span={span} />}
      />
      <Tile
        label={t("tiles.prompt")}
        value={fmt(s.prompt)}
        sub={
          s.prompt <= 0
            ? t("tiles.promptNone")
            : s.unreported > 0
              ? t("tiles.promptSplitUnreported", { computed: fmt(s.computed), cached: fmt(s.cached), unreported: fmt(s.unreported) })
              : t("tiles.promptSplit", { computed: fmt(s.computed), cached: fmt(s.cached) })
        }
        title={s.prompt.toLocaleString()}
        delta={<Delta value={cmp?.prompt} span={span} />}
      />
      <Tile
        label={t("tiles.cacheRate")}
        value={s.cacheRate == null ? "—" : fmtPct(s.cacheRate)}
        sub={
          s.prompt <= 0
            ? t("tiles.cacheNeedsPrompt")
            : s.cacheReported === false
              ? t("tiles.cacheNotReported")
              : s.unreported > 0
                ? t("tiles.cacheMeasuredOn", { measured: fmt(s.prompt - s.unreported), prompt: fmt(s.prompt) })
                : s.cached > 0
                ? t("tiles.cacheSaved", { cached: fmt(s.cached) })
                : t("tiles.cacheSavedNothing")
        }
        delta={
          cmp?.cachePoints != null ? (
            <span className={`tk-delta ${Math.abs(cmp.cachePoints) < 0.5 ? "" : cmp.cachePoints > 0 ? "is-up" : "is-down"}`}>
              {t("tiles.pointsVsPrev", { points: `${cmp.cachePoints >= 0 ? "+" : "−"}${Math.abs(cmp.cachePoints).toFixed(1)}`, span })}
            </span>
          ) : null
        }
      />
      <Tile
        label={t("tiles.ratio")}
        value={ratio == null ? "—" : `1 : ${ratioText}`}
        sub={ratio == null ? t("tiles.ratioNeeds") : t("tiles.ratioSub", { ratio: ratioText })}
      />
      <Tile
        label={hourly ? t("tiles.avgHour") : t("tiles.avgDay")}
        value={fmt(Math.round(s.avgPerBucket))}
        unit={hourly ? t("tiles.perHour") : t("tiles.perDay")}
        sub={hourly ? t("tiles.overHours", { count: s.elapsed }) : t("tiles.overDays", { count: s.elapsed })}
      />
      <Tile
        label={hourly ? t("tiles.busiestHour") : t("tiles.busiestDay")}
        value={s.busiest ? fmt(s.busiest.total) : "—"}
        sub={s.busiest ? bucketDate(s.busiest.key, spec.unit, undefined, i18n.resolvedLanguage) ?? s.busiest.key : t("tiles.noTraffic")}
        title={s.busiest ? s.busiest.total.toLocaleString() : undefined}
      />
    </section>
  );
}

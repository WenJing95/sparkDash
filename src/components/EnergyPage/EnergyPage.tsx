import { RestartButton } from "../ui/RestartButton";
import { activeTimeZone } from "../../shared/timeZone";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { clearFleetEnergy, fetchEnergyHistory, fetchFleetEnergy } from "../../api/client";
import { ClearMenu } from "../ui/ClearMenu";
import type { EnergyHistory, FleetEnergy, Settings, SparkSnapshot } from "../../api/types";
import { StackedBarChart, type BarBucket, type BarSeries } from "../ui/StackedBarChart";
import { LineAreaChart, type LinePoint } from "../ui/LineAreaChart";
import { Tag } from "../ui/Tag";
import { MonthlyEnergy } from "./MonthlyEnergy";
import {
  NODE_COLORS,
  RANGE_DAYS,
  browserTzOffset,
  buildBuckets,
  buildInsights,
  floorHour,
  formatKwh,
  formatLocalHour,
  formatMoney,
  formatShortDay,
  formatWatts,
  previousPeriodDelta,
  rangeWindow,
  rowsInRange,
  sortNodes,
  summarize,
  toCsv,
  type EnergyBucket,
  type EnergyRange,
  type EnergySummary,
  type NodeSortKey,
  type PeriodDelta,
  type RangeWindow,
} from "./energyStats";
import "../../styles/energy.css";

const DAY_MS = 86_400_000;
function energyClearChoices(t: TFunction<"energy">) {
  return [
    { id: "7d", label: t("reset.older7d"), ask: t("reset.ask7d"), arg: 7 * DAY_MS },
    { id: "24h", label: t("reset.older24h"), ask: t("reset.ask24h"), arg: DAY_MS },
    { id: "all", label: t("reset.everything"), ask: t("reset.askAll"), arg: undefined },
  ];
}

const HISTORY_POLL_MS = 60_000;
const LIVE_POLL_MS = 15_000;

const RANGES: EnergyRange[] = ["24h", "7d", "14d", "31d"];

/** Segment button text. */
function rangeButton(id: EnergyRange, t: TFunction<"energy">): string {
  switch (id) {
    case "24h":
      return t("range.label.24h");
    case "7d":
      return t("range.label.7d");
    case "14d":
      return t("range.label.14d");
    default:
      return t("range.label.31d");
  }
}

/** The range length used in sentences: "24 hours", "7 days". */
function rangeLong(id: EnergyRange, t: TFunction<"energy">): string {
  switch (id) {
    case "24h":
      return t("range.long.24h");
    case "7d":
      return t("range.long.7d");
    case "14d":
      return t("range.long.14d");
    default:
      return t("range.long.31d");
  }
}

const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Repeating timer that pauses while the tab is hidden and catches up when it returns. */
function useVisiblePoll(load: () => Promise<void>, everyMs: number) {
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let last = 0;
    const run = () => {
      last = Date.now();
      void loadRef.current();
    };
    run();
    const timer = window.setInterval(() => {
      if (!document.hidden) run();
    }, everyMs);
    const onVisible = () => {
      if (!document.hidden && Date.now() - last >= everyMs) run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [everyMs]);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.className = "en-offscreen";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function EnergyPage({
  sparks,
  settings,
  onSelectSpark,
}: {
  sparks: SparkSnapshot[];
  settings: Settings | null;
  onSelectSpark?: (id: string) => void;
}) {
  const { t, i18n } = useTranslation("energy");
  const locale = i18n.resolvedLanguage;
  const clearChoices = useMemo(() => energyClearChoices(t), [t]);
  const [history, setHistory] = useState<EnergyHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [live, setLive] = useState<FleetEnergy | null>(null);
  const [range, setRange] = useState<EnergyRange>("24h");
  const [monthlyReload, setMonthlyReload] = useState(0);
  const [sort, setSort] = useState<{ key: NodeSortKey; dir: "asc" | "desc" }>({ key: "kwh", dir: "desc" });
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");

  const loadHistory = useCallback(
    () =>
      fetchEnergyHistory()
        .then((next) => {
          setHistory(next);
          setHistoryError(null);
        })
        .catch((err) => setHistoryError(errMsg(err))),
    []
  );
  const loadLive = useCallback(
    () =>
      fetchFleetEnergy()
        .then(setLive)
        .catch(() => undefined),
    []
  );
  useVisiblePoll(loadHistory, HISTORY_POLL_MS);
  useVisiblePoll(loadLive, LIVE_POLL_MS);

  const price = settings?.energyPricePerKwh ?? null;
  const currency = settings?.energyCurrency || "$";
  const names = useMemo(() => new Map(sparks.map((s) => [s.id, s.name])), [sparks]);
  const nameOf = useCallback((id: string) => names.get(id) || id, [names]);
  const tz = browserTzOffset;

  const model = useMemo(() => {
    if (!history || history.membershipChanged) return null;
    const rows = history.hourly;
    const win = rangeWindow(range, history.generatedAt, rows);
    const inRange = rowsInRange(rows, win.startMs, win.endHourMs);
    const nodeIds = history.nodeIds;
    const summary = summarize(rows, win, nodeIds, price);
    const mode: "hour" | "day" = range === "24h" ? "hour" : "day";
    const buckets = buildBuckets(rows, win, mode, tz, locale);
    const hourly = buildBuckets(rows, win, "hour", tz, locale);
    const powerBuckets = range === "24h" ? hourly : hourly.filter((b) => b.startMs >= floorHour(win.windowStartMs));
    const delta = previousPeriodDelta(rows, win, summary.kwh);
    const insights = buildInsights({ summary, buckets, rows: inRange, mode, tz, price, currency, nodeName: nameOf, locale }, t);
    return { rows, inRange, win, summary, mode, buckets, powerBuckets, delta, insights, nodeIds };
  }, [history, range, price, currency, nameOf, tz, locale, t]);

  const colorOf = useMemo(() => {
    const map = new Map<string, string>();
    (model?.summary.nodes ?? []).forEach((n, i) => map.set(n.id, NODE_COLORS[i % NODE_COLORS.length]));
    return (id: string) => map.get(id) ?? NODE_COLORS[NODE_COLORS.length - 1];
  }, [model]);


  const copyCsv = async () => {
    if (!model) return;
    const ok = await copyText(toCsv(model.inRange, model.nodeIds, nameOf));
    setCopied(ok ? "ok" : "fail");
    window.setTimeout(() => setCopied("idle"), 2000);
  };

  const body = (() => {
    if (historyError && !history) {
      return (
        <section className="panel en-state" role="alert">
          <h2>{t("state.loadError")}</h2>
          <p>{historyError}</p>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void loadHistory()}>{t("state.retry")}</button>
        </section>
      );
    }
    if (!history) {
      return (
        <section className="panel en-state" role="status" aria-live="polite">
          <h2>{t("state.loading")}</h2>
        </section>
      );
    }
    if (history.membershipChanged) {
      return (
        <section className="panel en-state" role="status">
          <h2>{t("state.membershipTitle")}</h2>
          <p>{t("state.membershipBody")}</p>
          <RestartButton />
        </section>
      );
    }
    if (!model || history.hourly.length === 0) {
      return (
        <section className="panel en-state" role="status">
          <h2>{t("state.warmingTitle")}</h2>
          <p>{t("state.warmingBody")}</p>
        </section>
      );
    }
    return (
      <EnergyBody
        model={model}
        live={live}
        nodeTotal={sparks.length || history.nodeIds.length}
        rangeLabel={rangeLong(range, t)}
        price={price}
        currency={currency}
        nameOf={nameOf}
        colorOf={colorOf}
        sort={sort}
        setSort={setSort}
        onSelectSpark={onSelectSpark}
        stale={Boolean(historyError)}
      />
    );
  })();

  return (
    <div className="en">
      <div className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="page-head__sub">
            {t("subtitle")}
            {history ? (
              <span className="mono en-updated">
                {" "}
                {t("updated", { time: new Date(history.generatedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: activeTimeZone() }) })}
              </span>
            ) : null}
          </p>
        </div>
        <div className="page-head__tools">
          <div className="seg" role="group" aria-label={t("range.aria")}>
            {RANGES.map((r) => (
              <button key={r} type="button" aria-pressed={range === r} className={range === r ? "is-on" : ""} onClick={() => setRange(r)}>
                {rangeButton(r, t)}
              </button>
            ))}
          </div>
          <ClearMenu
            label={t("reset.label")}
            choices={clearChoices}
            note={t("reset.note")}
            onRun={async (ms) => {
              const { removed } = await clearFleetEnergy(ms);
              await Promise.all([loadHistory(), loadLive()]);
              setMonthlyReload((n) => n + 1);
              return removed;
            }}
          />
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void copyCsv()} disabled={!model || model.inRange.length === 0}>
            {copied === "ok" ? t("copy.copied") : copied === "fail" ? t("copy.failed") : t("copy.button")}
          </button>
          <span className="sr-only" role="status" aria-live="polite">{copied === "ok" ? t("copy.announce") : ""}</span>
        </div>
      </div>
      {body}
      <MonthlyEnergy nameOf={nameOf} price={price} currency={currency} reloadToken={monthlyReload} />
    </div>
  );
}

interface Model {
  rows: EnergyHistory["hourly"];
  inRange: EnergyHistory["hourly"];
  win: RangeWindow;
  summary: EnergySummary;
  mode: "hour" | "day";
  buckets: EnergyBucket[];
  powerBuckets: EnergyBucket[];
  delta: PeriodDelta | null;
  insights: string[];
  nodeIds: string[];
}

function EnergyBody({
  model,
  live,
  nodeTotal,
  rangeLabel,
  price,
  currency,
  nameOf,
  colorOf,
  sort,
  setSort,
  onSelectSpark,
  stale,
}: {
  model: Model;
  live: FleetEnergy | null;
  nodeTotal: number;
  rangeLabel: string;
  price: number | null;
  currency: string;
  nameOf: (id: string) => string;
  colorOf: (id: string) => string;
  sort: { key: NodeSortKey; dir: "asc" | "desc" };
  setSort: (s: { key: NodeSortKey; dir: "asc" | "desc" }) => void;
  onSelectSpark?: (id: string) => void;
  stale: boolean;
}) {
  const { t, i18n } = useTranslation("energy");
  const locale = i18n.resolvedLanguage;
  const { summary, win, mode, buckets, powerBuckets, delta, insights } = model;
  const tz = browserTzOffset;
  const noData = !summary.hasData;
  const shortHistory = win.windowStartMs > win.startMs;
  const fresh = live?.freshNodeCount ?? null;
  const total = live?.currentNodeIds.length || nodeTotal;

  const series: BarSeries[] = summary.nodes.map((n) => ({ id: n.id, label: nameOf(n.id), color: colorOf(n.id) }));
  const barBuckets: BarBucket[] = buckets.map((b) => ({ key: b.key, label: b.label, title: b.title, values: b.nodeKwh }));
  const bucketById = new Map(buckets.map((b) => [b.key, b]));
  const hourly = mode === "hour";

  const powerPoints: LinePoint[] = powerBuckets.map((b) => ({
    key: b.key,
    label: win.range === "24h" ? b.label : `${formatShortDay(b.startMs, tz, locale)}`,
    title: formatLocalHour(b.startMs, tz, locale),
    value: b.avgWatts,
  }));
  const effBuckets = mode === "hour" ? powerBuckets : buckets;
  const effPoints: LinePoint[] = effBuckets.map((b) => ({ key: b.key, label: b.label, title: b.title, value: b.whPer1kTokens }));
  const showEff = effPoints.filter((p) => p.value != null).length >= 2;

  const sortedNodes = sortNodes(summary.nodes, sort.key, sort.dir, nameOf);
  const maxShare = Math.max(0.0001, ...summary.nodes.map((n) => n.share));

  return (
    <>
      {stale ? <p className="en-banner en-banner--warn" role="status">{t("body.stale")}</p> : null}
      <p className="en-banner" role="note">
        <b>{t("body.estimatedTitle")}</b>{t("body.estimatedBody")}
      </p>

      <section className="en-tiles" aria-label={t("tiles.aria")}>
        <Tile label={t("tiles.currentDraw")}>
          <div className="big-num mono">{live?.currentWatts30s != null ? Math.round(live.currentWatts30s) : "—"}<small>W</small></div>
          <div className="en-tile__sub">
            {fresh != null ? (
              <Tag tone={fresh === 0 ? "bad" : fresh < total ? "warn" : "good"}>{t("tiles.nodesFresh", { fresh, total })}</Tag>
            ) : null}
            <span>{t("tiles.average30s")}</span>
          </div>
        </Tile>
        <Tile label={t("tiles.energy", { range: rangeLabel })}>
          <div className="big-num mono">{noData ? "—" : formatKwh(summary.kwh)}<small>kWh</small></div>
          <div className="en-tile__sub">
            {delta ? (
              <span className={delta.ratio > 0.02 ? "en-delta en-delta--up" : delta.ratio < -0.02 ? "en-delta en-delta--down" : "en-delta"}>
                {t("tiles.vsPrevious", { delta: `${delta.ratio > 0 ? "+" : ""}${Math.round(delta.ratio * 100)}`, range: rangeLabel })}
              </span>
            ) : (
              <span>{t("tiles.noEarlier")}</span>
            )}
          </div>
        </Tile>
        <Tile label={t("tiles.estimatedCost")}>
          <div className="big-num mono">{summary.cost != null && !noData ? formatMoney(summary.cost, currency) : "—"}</div>
          <div className="en-tile__sub">
            {price == null ? (
              <span>{t("tiles.setPrice")}</span>
            ) : (
              <span>
                {t("tiles.costAt", {
                  perDay: summary.costPerDay != null ? t("tiles.perDay", { money: formatMoney(summary.costPerDay, currency) }) : "—",
                  price: `${currency}${price}`,
                })}
              </span>
            )}
          </div>
        </Tile>
        <Tile label={t("tiles.averagePower")}>
          <div className="big-num mono">{summary.avgWatts != null ? Math.round(summary.avgWatts) : "—"}<small>W</small></div>
          <div className="en-tile__sub"><span>{t("tiles.wholeFleet", { hours: summary.coveredHours >= 10 ? Math.round(summary.coveredHours) : summary.coveredHours.toFixed(1) })}</span></div>
        </Tile>
        <Tile label={t("tiles.peakHour")}>
          <div className="big-num mono">{summary.peak ? Math.round(summary.peak.watts) : "—"}<small>W</small></div>
          <div className="en-tile__sub"><span>{summary.peak ? t("tiles.localTime", { when: formatLocalHour(summary.peak.atMs, tz, locale) }) : t("tiles.noFullHour")}</span></div>
        </Tile>
        <Tile label={t("tiles.efficiency")}>
          <div className="big-num mono">{summary.whPer1kTokens != null ? (summary.whPer1kTokens < 10 ? summary.whPer1kTokens.toFixed(2) : summary.whPer1kTokens.toFixed(1)) : "—"}<small>Wh / 1k tok</small></div>
          <div className="en-tile__sub">
            <span>{summary.coveredTokens > 0 ? t("tiles.outputTokens", { tokens: compact(summary.coveredTokens) }) : t("tiles.noTokenData")}</span>
          </div>
        </Tile>
        <Tile label={t("tiles.coverage")}>
          <div className="big-num mono">{noData ? "—" : pct(summary.coverage, summary.coverage >= 0.995 ? 0 : 1)}</div>
          <div className="en-tile__sub">
            <Tag tone={summary.coverage >= 0.9 ? "good" : summary.coverage >= 0.5 ? "warn" : "bad"}>{summary.coverage >= 0.9 ? t("tiles.solid") : summary.coverage >= 0.5 ? t("tiles.partial") : t("tiles.sparse")}</Tag>
            <span>{shortHistory ? t("tiles.sinceHistory") : t("tiles.ofRange")}</span>
          </div>
        </Tile>
      </section>

      {noData ? (
        <section className="panel en-state" role="status">
          <h2>{t("noData.title", { range: rangeLabel })}</h2>
          <p>{t("noData.body")}</p>
        </section>
      ) : (
        <>
          <section className="panel en-panel" aria-labelledby="en-h-energy">
            <header className="en-panel__head">
              <div>
                <h2 id="en-h-energy">{hourly ? t("energyChart.titleHour") : t("energyChart.titleDay")}</h2>
                <p className="en-panel__sub">{hourly ? t("energyChart.subHour") : t("energyChart.subDay")}</p>
              </div>
              <div className="legend" aria-label={t("energyChart.legendAria")}>
                {series.map((s) => (
                  <span key={s.id} style={{ "--c": s.color } as React.CSSProperties}>{s.label}</span>
                ))}
              </div>
            </header>
            <StackedBarChart
              buckets={barBuckets}
              series={series}
              height={240}
              format={formatKwh}
              unit="kWh"
              ariaLabel={hourly ? t("energyChart.ariaHour", { range: rangeLabel }) : t("energyChart.ariaDay", { range: rangeLabel })}
              footer={(b) => {
                const full = bucketById.get(b.key);
                if (!full || !full.hasData) return t("energyChart.noTelemetry");
                const c = full.expectedMs > 0 ? Math.min(1, full.fleetCoverageMs / full.expectedMs) : 0;
                return hourly ? t("energyChart.coverageHour", { pct: pct(c) }) : t("energyChart.coverageDay", { pct: pct(c) });
              }}
            />
          </section>

          <div className={showEff ? "en-grid2" : ""}>
            <section className="panel en-panel" aria-labelledby="en-h-power">
              <header className="en-panel__head">
                <div>
                  <h2 id="en-h-power">{t("powerChart.title")}</h2>
                  <p className="en-panel__sub">{t("powerChart.sub")}</p>
                </div>
              </header>
              <LineAreaChart
                points={powerPoints}
                height={200}
                format={(v) => `${Math.round(v)}`}
                unit="W"
                color="var(--color-info)"
                ariaLabel={t("powerChart.aria", { range: rangeLabel })}
              />
            </section>
            {showEff ? (
              <section className="panel en-panel" aria-labelledby="en-h-eff">
                <header className="en-panel__head">
                  <div>
                    <h2 id="en-h-eff">{t("effChart.title")}</h2>
                    <p className="en-panel__sub">{hourly ? t("effChart.subHour") : t("effChart.subDay")}</p>
                  </div>
                </header>
                <LineAreaChart
                  points={effPoints}
                  height={200}
                  format={(v) => (v < 10 ? v.toFixed(1) : String(Math.round(v)))}
                  unit="Wh / 1k tok"
                  color="var(--color-violet)"
                  ariaLabel={hourly ? t("effChart.ariaHour") : t("effChart.ariaDay")}
                />
              </section>
            ) : null}
          </div>

          <section className="panel en-panel" aria-labelledby="en-h-nodes">
            <header className="en-panel__head">
              <div>
                <h2 id="en-h-nodes">{t("nodes.title")}</h2>
                <p className="en-panel__sub">{t("nodes.sub")}</p>
              </div>
            </header>
            <div className="en-table-wrap">
              <table className="en-table">
                <caption className="sr-only">{t("nodes.caption", { range: rangeLabel })}</caption>
                <thead>
                  <tr>
                    <SortTh k="name" label={t("nodes.col.spark")} sort={sort} setSort={setSort} left />
                    <SortTh k="kwh" label={t("nodes.col.energy")} sort={sort} setSort={setSort} />
                    <SortTh k="share" label={t("nodes.col.share")} sort={sort} setSort={setSort} wide />
                    <SortTh k="avgWatts" label={t("nodes.col.avgWatts")} sort={sort} setSort={setSort} />
                    <SortTh k="peakWatts" label={t("nodes.col.peakHour")} sort={sort} setSort={setSort} />
                    <SortTh k="coverage" label={t("nodes.col.coverage")} sort={sort} setSort={setSort} />
                    <SortTh k="cost" label={t("nodes.col.cost")} sort={sort} setSort={setSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedNodes.map((n) => (
                    <tr key={n.id}>
                      <th scope="row" className="en-table__name">
                        <i className="en-swatch" style={{ background: colorOf(n.id) }} aria-hidden="true" />
                        {onSelectSpark ? (
                          <button type="button" className="en-link" onClick={() => onSelectSpark(n.id)}>{nameOf(n.id)}</button>
                        ) : (
                          nameOf(n.id)
                        )}
                      </th>
                      <td className="mono">{formatKwh(n.kwh)} kWh</td>
                      <td className="en-table__share">
                        <span className="en-share">
                          <span className="en-share__bar" aria-hidden="true"><i style={{ width: `${(n.share / maxShare) * 100}%`, background: colorOf(n.id) }} /></span>
                          <span className="mono">{pct(n.share, 1)}</span>
                        </span>
                      </td>
                      <td className="mono">{formatWatts(n.avgWatts)}</td>
                      <td className="mono" title={n.peakAtMs != null ? t("tiles.localTime", { when: formatLocalHour(n.peakAtMs, tz, locale) }) : undefined}>
                        {formatWatts(n.peakWatts)}
                        {n.peakAtMs != null ? <span className="en-table__when"> {formatLocalHour(n.peakAtMs, tz, locale)}</span> : null}
                      </td>
                      <td className="mono">{pct(n.coverage, 1)}</td>
                      <td className="mono">{n.cost != null ? formatMoney(n.cost, currency) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {price == null ? <p className="en-panel__sub en-panel__foot">{t("nodes.costNeedsPrice")}</p> : null}
          </section>
        </>
      )}

      <div className="en-grid2">
        <section className="panel en-panel" aria-labelledby="en-h-insights">
          <header className="en-panel__head"><h2 id="en-h-insights">{t("insights.title")}</h2></header>
          {insights.length ? (
            <ul className="en-list">
              {insights.map((line) => <li key={line}>{line}</li>)}
            </ul>
          ) : (
            <p className="en-panel__sub">{t("insights.empty")}</p>
          )}
        </section>
        <section className="panel en-panel" aria-labelledby="en-h-notes">
          <header className="en-panel__head"><h2 id="en-h-notes">{t("about.title")}</h2></header>
          <ul className="en-list en-list--notes">
            <li><b>{t("about.estimatedTitle")}</b>{t("about.estimatedBody")}</li>
            <li><b>{t("about.gapsTitle")}</b>{t("about.gapsBody")}</li>
            <li><b>{t("about.efficiencyTitle")}</b>{t("about.efficiencyBody")}</li>
            <li><b>{t("about.retentionTitle")}</b>{t("about.retentionBody")}</li>
            <li><b>{t("about.localTimeTitle")}</b>{t("about.localTimeBody", { timeZone: activeTimeZone() })}</li>
            <li><b>{t("about.membershipTitle")}</b>{t("about.membershipBody")}</li>
          </ul>
        </section>
      </div>
    </>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="panel en-tile">
      <div className="eyebrow">{label}</div>
      {children}
    </div>
  );
}

function SortTh({
  k,
  label,
  sort,
  setSort,
  left,
  wide,
}: {
  k: NodeSortKey;
  label: string;
  sort: { key: NodeSortKey; dir: "asc" | "desc" };
  setSort: (s: { key: NodeSortKey; dir: "asc" | "desc" }) => void;
  left?: boolean;
  wide?: boolean;
}) {
  const active = sort.key === k;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`${left ? "is-left" : ""} ${wide ? "en-table__share" : ""}`}
    >
      <button
        type="button"
        className="en-sort"
        onClick={() => setSort({ key: k, dir: active ? (sort.dir === "asc" ? "desc" : "asc") : k === "name" ? "asc" : "desc" })}
      >
        {label}
        <span aria-hidden="true" className="en-sort__arrow">{active ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)} k`;
  return String(n);
}

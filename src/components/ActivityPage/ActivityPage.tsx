import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { SparkSnapshot } from "../../api/types";
import { StackedBarChart, type BarBucket, type BarSeries } from "../ui/StackedBarChart";
import { RotateIcon, SearchIcon, XIcon } from "../ui/icons";
import { EventRow } from "./EventRow";
import { ClearMenu } from "../ui/ClearMenu";
import {
  CATEGORIES, EMPTY_FILTER, NO_SPARK, SEVERITIES, categoryLabel, countByCategory, countBySeverity, countBySpark,
  eventsPerDay, exportText, filterEvents, groupByDay, isFilterActive, severityLabel, sparkOptions, summarize,
  type ActivityFilter, type CategoryId, type RangeId, type Severity,
} from "./activityStats";
import { useActivityFeed } from "./useActivityFeed";
import "../../styles/activity.css";

const DAY_MS = 86_400_000;
function activityClear(t: TFunction<"activity">) {
  return [
    { id: "7d", label: t("clear.older7d"), ask: t("clear.older7dAsk"), arg: 7 * DAY_MS },
    { id: "24h", label: t("clear.older24h"), ask: t("clear.older24hAsk"), arg: DAY_MS },
    { id: "all", label: t("clear.all"), ask: t("clear.allAsk"), arg: undefined },
  ] as const;
}

function chartSeries(t: TFunction<"activity">): readonly BarSeries[] {
  return [
    { id: "error", label: t("severity.errors"), color: "var(--color-danger)" },
    { id: "warn", label: t("severity.warnings"), color: "var(--color-warning)" },
    { id: "success", label: t("severity.success"), color: "var(--color-success)" },
    { id: "info", label: t("severity.info"), color: "var(--color-info)" },
  ];
}

function rangeOptions(t: TFunction<"activity">): readonly { id: RangeId; label: string }[] {
  return [
    { id: "24h", label: t("range.24h") },
    { id: "7d", label: t("range.7d") },
    { id: "all", label: t("range.all") },
  ];
}

/** Severity chips share the chart legend's words ("Errors", "Warnings", ...). */
const sevChips = (t: TFunction<"activity">): readonly { id: Severity; label: string }[] =>
  chartSeries(t).map((s) => ({ id: s.id as Severity, label: s.label }));

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

function formatUpdated(t: TFunction<"activity">, ts: number | null, now: number): string {
  if (ts == null) return t("live.connecting");
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 5 ? t("live.justNow") : s < 60 ? t("live.secondsAgo", { seconds: s }) : t("live.minutesAgo", { minutes: Math.floor(s / 60) });
}

/** Puts nodes where a translated sentence has its \u0001 / \u0002 markers, so word order can follow the language. */
function withSlots(text: string, slots: Record<string, ReactNode>): ReactNode {
  return text.split(/([\u0001\u0002])/).map((part, i) => <Fragment key={i}>{slots[part] ?? part}</Fragment>);
}

/** Fallback for browsers or contexts without the async clipboard API. */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.className = "ac-offscreen";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function ActivityPage({ sparks, onSelectSpark }: { sparks: SparkSnapshot[]; onSelectSpark?: (id: string) => void }) {
  const { t } = useTranslation("activity");
  const [filter, setFilter] = useState<ActivityFilter>(EMPTY_FILTER);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [away, setAway] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [copyMsg, setCopyMsg] = useState<{ count: number; ok: boolean } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const awayRef = useRef(false);

  const onArrive = useCallback((n: number) => {
    if (awayRef.current) setUnseen((c) => c + n);
  }, []);
  const feed = useActivityFeed(onArrive);
  const { events } = feed;

  // Clock for relative labels and the Today/Yesterday headings.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  // "Scrolled away" = the timeline's top edge has left the viewport (any scroll container).
  useEffect(() => {
    const check = () => {
      const top = topRef.current?.getBoundingClientRect().top ?? 0;
      const isAway = top < -120;
      awayRef.current = isAway;
      setAway(isAway);
      if (!isAway) setUnseen(0);
    };
    window.addEventListener("scroll", check, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", check, { capture: true });
  }, []);

  const toggle = useCallback((id: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const summary = useMemo(() => summarize(events, now), [events, now]);
  const buckets = useMemo(() => eventsPerDay(events, now, 14, undefined, t), [events, now, t]);
  const chartBuckets: BarBucket[] = useMemo(
    () => buckets.map((b) => ({ key: b.key, label: b.label, title: b.title, values: b.counts })),
    [buckets]
  );
  const visible = useMemo(() => filterEvents(events, filter, now, t), [events, filter, now, t]);
  const groups = useMemo(() => groupByDay(visible, now, undefined, t), [visible, now, t]);
  const sevCounts = useMemo(() => countBySeverity(events, filter, now, t), [events, filter, now, t]);
  const catCounts = useMemo(() => countByCategory(events, filter, now, t), [events, filter, now, t]);
  const sparkCounts = useMemo(() => countBySpark(events, filter, now, t), [events, filter, now, t]);
  const series = useMemo(() => chartSeries(t), [t]);
  const clearChoices = useMemo(() => activityClear(t), [t]);
  const options = useMemo(() => sparkOptions(sparks, events), [sparks, events]);
  const hasNoSpark = (sparkCounts[NO_SPARK] ?? 0) > 0 || filter.sparkId === NO_SPARK;
  const active = isFilterActive(filter);
  const chartTotal = buckets.reduce((n, b) => n + b.counts.error + b.counts.warn + b.counts.success + b.counts.info, 0);

  const patch = (p: Partial<ActivityFilter>) => setFilter((f) => ({ ...f, ...p }));
  const preset = (p: Partial<ActivityFilter>) => setFilter({ ...EMPTY_FILTER, ...p });
  const toggleSeverity = (s: Severity) =>
    patch({ severities: filter.severities.includes(s) ? filter.severities.filter((x) => x !== s) : [...filter.severities, s] });

  const copyAll = async () => {
    const text = exportText(visible, undefined, t);
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = legacyCopy(text);
    }
    setCopyMsg({ ok, count: visible.length });
    setTimeout(() => setCopyMsg(null), 2500);
  };

  const jumpToNewest = () => {
    rootRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    setUnseen(0);
  };

  const live = feed.pollError ? "warn" : feed.paused ? "off" : "ok";
  const liveText = feed.pollError ? t("live.failed") : feed.paused ? t("live.paused") : t("live.live", { updated: formatUpdated(t, feed.lastUpdated, now) });

  const tiles = [
    {
      id: "events",
      label: t("tiles.events24h"),
      value: String(summary.events24h),
      sub: t("tiles.in7d", { count: summary.events7d }),
      on: filter.range === "24h" && !filter.severities.length && filter.sparkId === "all" && filter.category === "all" && !filter.query,
      run: () => preset({ range: "24h" }),
    },
    {
      id: "errors",
      label: t("tiles.errors24h"),
      value: String(summary.errors24h),
      sub: t("tiles.in7d", { count: summary.errors7d }),
      tone: summary.errors24h > 0 ? "bad" : "",
      on: filter.range === "24h" && sameSet(filter.severities, ["error"]),
      run: () => preset({ range: "24h", severities: ["error"] }),
    },
    {
      id: "warnings",
      label: t("tiles.warnings24h"),
      value: String(summary.warnings24h),
      sub: t("tiles.in7d", { count: summary.warnings7d }),
      tone: summary.warnings24h > 0 ? "warn" : "",
      on: filter.range === "24h" && sameSet(filter.severities, ["warn"]),
      run: () => preset({ range: "24h", severities: ["warn"] }),
    },
    {
      id: "problems",
      label: t("tiles.problemSparks"),
      value: String(summary.problemSparks24h),
      sub: t("tiles.in7d", { count: summary.problemSparks7d }),
      tone: summary.problemSparks24h > 0 ? "warn" : "",
      on: filter.range === "24h" && sameSet(filter.severities, ["error", "warn"]),
      run: () => preset({ range: "24h", severities: ["error", "warn"] }),
    },
    {
      id: "active",
      label: t("tiles.mostActive"),
      value: summary.mostActive?.name ?? t("tiles.none"),
      small: true,
      sub: summary.mostActive ? t("tiles.eventCount", { count: summary.mostActive.count }) : t("tiles.noEventsYet"),
      on: summary.mostActive != null && filter.sparkId === summary.mostActive.sparkId,
      disabled: summary.mostActive == null,
      run: () => summary.mostActive && preset({ range: "24h", sparkId: summary.mostActive.sparkId }),
    },
  ];

  const timeline = (() => {
    if (feed.status === "loading") {
      return (
        <ul className="ac-skel" aria-busy="true" aria-label={t("timeline.loading")}>
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="ac-skel__row">
              <i className="ac-skel__bar ac-skel__bar--s" />
              <i className="ac-skel__bar ac-skel__bar--s" />
              <i className="ac-skel__bar" />
            </li>
          ))}
        </ul>
      );
    }
    if (feed.status === "error") {
      return (
        <div className="ac-state" role="alert">
          <h3>{t("timeline.loadFailed")}</h3>
          <p>{feed.error}</p>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void feed.reload()}>
            {t("timeline.retry")}
          </button>
        </div>
      );
    }
    if (events.length === 0) {
      return (
        <div className="ac-state">
          <h3>{t("timeline.emptyTitle")}</h3>
          <p>{t("timeline.emptyBody")}</p>
        </div>
      );
    }
    if (visible.length === 0) {
      return (
        <div className="ac-state">
          <h3>{t("timeline.noMatchTitle")}</h3>
          <p>{t("timeline.noMatchBody")}</p>
          <button type="button" className="btn btn--sm" onClick={() => setFilter(EMPTY_FILTER)}>
            {t("timeline.resetFilters")}
          </button>
        </div>
      );
    }
    return (
      <div>
        {groups.map((g) => (
          <section key={g.key} className="ac-day" aria-label={g.label}>
            <h3 className="ac-day__head">
              <span>{g.label}</span>
              <span className="ac-day__count mono">{g.events.length}</span>
            </h3>
            <ul className="ac-list">
              {g.events.map((e) => (
                <EventRow
                  key={e.id}
                  event={e}
                  open={open.has(e.id)}
                  fresh={feed.fresh.has(e.id)}
                  now={now}
                  onToggle={toggle}
                  onSelectSpark={onSelectSpark}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  })();

  return (
    <div className="ac" ref={rootRef}>
      <header className="page-head">
        <div>
          <h1>{t("page.title")}</h1>
          <p className="page-head__sub">{t("page.sub")}</p>
        </div>
        <div className="page-head__tools">
          <span className={`ac-live ac-live--${live}`} role="status">
            <i className="ac-live__dot" aria-hidden="true" />
            {liveText}
          </span>
          <button type="button" className="btn btn--sm" onClick={() => void feed.refresh()} disabled={feed.status !== "ready" || feed.refreshing}>
            <RotateIcon className={`h-3.5 w-3.5${feed.refreshing ? " ac-spin" : ""}`} />
            {t("page.refresh")}
          </button>
          <button type="button" className="btn btn--sm" onClick={() => void copyAll()} disabled={visible.length === 0}>
            {t("page.copyText")}
          </button>
          <ClearMenu
            label={t("clear.menu")}
            choices={clearChoices}
            onRun={feed.clear}
            disabled={feed.status !== "ready"}
          />
          <span className={`ac-toast${copyMsg ? (copyMsg.ok ? " is-ok" : " is-err") : ""}`} role="status" aria-live="polite">
            {copyMsg ? (copyMsg.ok ? t("page.copied", { count: copyMsg.count }) : t("page.copyFailed")) : null}
          </span>
        </div>
      </header>

      <div className="ac-tiles" role="group" aria-label={t("tiles.group")}>
        {tiles.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`panel ac-tile${t.on ? " is-on" : ""}${t.tone ? ` ac-tile--${t.tone}` : ""}`}
            aria-pressed={t.on}
            disabled={t.disabled || feed.status !== "ready"}
            onClick={t.run}
          >
            <span className="eyebrow">{t.label}</span>
            <span className={`ac-tile__val${t.small ? " ac-tile__val--text" : " big-num"}`}>{t.value}</span>
            <span className="ac-tile__sub">{t.sub}</span>
          </button>
        ))}
      </div>

      <section className="panel ac-chart" aria-label={t("chart.title")}>
        <div className="ac-chart__head">
          <h2 className="panel-title">{t("chart.title")}</h2>
          <ul className="ac-legend">
            {series.map((s) => (
              <li key={s.id}>
                <i className={`ac-sev__dot ac-sev__dot--${s.id}`} aria-hidden="true" />
                {s.label}
              </li>
            ))}
          </ul>
        </div>
        <StackedBarChart
          buckets={chartBuckets}
          series={series}
          height={150}
          format={(n) => String(Math.round(n))}
          unit={t("chart.unit")}
          empty={feed.status === "ready" ? t("chart.empty") : t("chart.loading")}
          ariaLabel={t("chart.aria", { total: chartTotal })}
        />
      </section>

      <section className="panel ac-filters" aria-label={t("filters.aria")}>
        <div className="ac-filters__row">
          <div className="ac-chips" role="group" aria-label={t("filters.severity")}>
            <button type="button" className="ac-chip" aria-pressed={filter.severities.length === 0} onClick={() => patch({ severities: [] })}>
              {t("filters.all")} <b className="mono">{SEVERITIES.reduce((n, s) => n + sevCounts[s], 0)}</b>
            </button>
            {sevChips(t).map((c) => (
              <button
                key={c.id}
                type="button"
                className={`ac-chip ac-chip--${c.id}`}
                aria-pressed={filter.severities.includes(c.id)}
                onClick={() => toggleSeverity(c.id)}
                title={t("severity.events", { severity: severityLabel(c.id, t) })}
              >
                <i className={`ac-sev__dot ac-sev__dot--${c.id}`} aria-hidden="true" />
                {c.label} <b className="mono">{sevCounts[c.id]}</b>
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label={t("filters.timeRange")}>
            {rangeOptions(t).map((r) => (
              <button key={r.id} type="button" aria-pressed={filter.range === r.id} onClick={() => patch({ range: r.id })}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="ac-filters__row">
          <label className="ac-search">
            <SearchIcon className="h-4 w-4" />
            <input
              type="search"
              value={filter.query}
              onChange={(e) => patch({ query: e.target.value })}
              placeholder={t("filters.searchPlaceholder")}
              aria-label={t("filters.searchAria")}
            />
          </label>
          <label className="ac-select">
            <span className="eyebrow">{t("filters.category")}</span>
            <select value={filter.category} onChange={(e) => patch({ category: e.target.value as CategoryId | "all" })}>
              <option value="all">{t("filters.allCategories")}</option>
              {CATEGORIES.filter((id) => catCounts[id] > 0 || filter.category === id).map((id) => (
                <option key={id} value={id}>
                  {t("filters.option", { label: categoryLabel(id, t), count: catCounts[id] })}
                </option>
              ))}
            </select>
          </label>
          <label className="ac-select">
            <span className="eyebrow">{t("filters.spark")}</span>
            <select value={filter.sparkId} onChange={(e) => patch({ sparkId: e.target.value })}>
              <option value="all">{t("filters.allSparks")}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {t("filters.option", { label: o.name, count: sparkCounts[o.id] ?? 0 })}
                </option>
              ))}
              {hasNoSpark ? <option value={NO_SPARK}>{t("filters.fleetWide", { count: sparkCounts[NO_SPARK] ?? 0 })}</option> : null}
            </select>
          </label>
          <button type="button" className="btn btn--ghost btn--sm ac-reset" onClick={() => setFilter(EMPTY_FILTER)} disabled={!active}>
            <XIcon className="h-3.5 w-3.5" />
            {t("timeline.resetFilters")}
          </button>
        </div>
      </section>

      <div className="ac-count" role="status" aria-live="polite">
        {feed.status === "ready" ? (
          withSlots(active ? t("filters.showingFiltered", { shown: "\u0001", total: "\u0002" }) : t("filters.showing", { shown: "\u0001", total: "\u0002" }), {
            "\u0001": <b className="mono">{visible.length}</b>,
            "\u0002": <b className="mono">{events.length}</b>,
          })
        ) : (
          " "
        )}
      </div>

      <div ref={topRef} />
      {away && unseen > 0 ? (
        <div className="ac-newbar">
          <button type="button" className="btn btn--primary btn--sm" onClick={jumpToNewest}>
            {t("timeline.newEvents", { count: unseen })}
          </button>
        </div>
      ) : null}

      <div className="panel ac-timeline">{timeline}</div>

      {feed.status === "ready" && events.length > 0 ? (
        <div className="ac-more">
          {feed.reachedOldest ? (
            <p className="ac-more__end">{t("timeline.reachedOldest")}</p>
          ) : (
            <>
              <button type="button" className="btn btn--sm" onClick={() => void feed.loadOlder()} disabled={feed.loadingMore}>
                {feed.loadingMore ? t("timeline.loadingMore") : t("timeline.loadOlder")}
              </button>
              {active ? <p className="ac-more__hint">{t("timeline.filtersHint")}</p> : null}
              {feed.moreError ? (
                <p className="ac-more__err" role="alert">
                  {t("timeline.olderFailed", { error: feed.moreError })}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default ActivityPage;

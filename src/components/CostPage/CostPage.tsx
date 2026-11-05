import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchTokenHistory } from "../../api/client";
import { fetchLlmTokenTotals } from "../../api/llmTokenClient";
import { fetchModelPrices } from "../../api/costClient";
import type { ModelPrice } from "../../api/costTypes";
import type { TokenHistory, TokenHistoryRow } from "../../api/types";
import { formatTokensCompact } from "../../shared/tokenFormat";
import { StackedBarChart, type BarBucket, type BarSeries } from "../ui/StackedBarChart";
import {
  RANGES,
  bucketLabel,
  bucketTitle,
  entriesFromTotals,
  rangeLabel,
  rangePhrase,
  rowsIn,
  tallyOf,
  trackedBuckets,
  windowFor,
  type Entry,
  type RangeKey,
  type RangeSpec,
  type Tally,
} from "../TokensPage/tokenStats";
import { blendedPerMillion, costBuckets, costOf, filterModels, fmtMoney, priceLabel } from "./costStats";
import "../../styles/tokens.css";
import "../../styles/cost.css";

const POLL_MS = 30_000;
const fmt = formatTokensCompact;
const MODEL_KEY = "sparkdash.cost.model";

interface Usage {
  history: TokenHistory;
  /** Lifetime totals per model; null when that endpoint failed (All time then falls back to retained days). */
  lifetime: Entry[] | null;
}

interface Prices {
  models: ModelPrice[];
  at: number | null;
  stale: boolean;
}

export function CostPage() {
  const { t, i18n } = useTranslation("cost");
  const { t: tTok } = useTranslation("tokens");
  const locale = i18n.resolvedLanguage;
  const [range, setRange] = useState<RangeKey>("7d");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [pricesError, setPricesError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [modelId, setModelId] = useState<string>(() => {
    try {
      return localStorage.getItem(MODEL_KEY) || "";
    } catch {
      return "";
    }
  });

  // Usage polls; prices load once (and on retry) so a slow or dead price source
  // never holds the usage view hostage.
  useEffect(() => {
    let cancelled = false;
    const run = () => {
      Promise.all([
        fetchTokenHistory(),
        fetchLlmTokenTotals("all")
          .then((r) => r.series || [])
          .catch(() => null),
      ])
        .then(([history, lifetimeSeries]) => {
          if (cancelled) return;
          setUsage({ history, lifetime: lifetimeSeries ? entriesFromTotals(lifetimeSeries) : null });
          setError(null);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : t("errors.usageFallback"));
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
    let cancelled = false;
    fetchModelPrices()
      .then((res) => {
        if (cancelled) return;
        setPrices({ models: res.models ?? [], at: res.fetchedAt ?? null, stale: res.stale ?? false });
        setPricesError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setPricesError(e instanceof Error ? e.message : t("errors.pricesFallback"));
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const selectModel = useCallback((id: string) => {
    setModelId(id);
    try {
      localStorage.setItem(MODEL_KEY, id);
    } catch {
      /* private mode: the pick just does not survive a reload */
    }
  }, []);

  const price = useMemo(() => prices?.models.find((m) => m.id === modelId) ?? null, [prices, modelId]);

  const view = useMemo(() => {
    if (!usage || !price) return null;
    const { history, lifetime } = usage;
    const at = Date.now();
    const w = windowFor(range, history, at);
    const inRange: TokenHistoryRow[] = rowsIn(w.spec.unit === "hour" ? history.hour : history.day, w.keys);
    const useLifetime = range === "all" && lifetime != null;
    const priced: readonly Entry[] = useLifetime ? lifetime : inRange;
    // Days the average is spread over: the range length, or — All time — every
    // day tracking has recorded (the Token totals rule), not a fixed 30.
    const days =
      w.spec.count ?? (useLifetime ? trackedBuckets(w.firstKey, "day", at) ?? w.keys.length : w.keys.length);
    return {
      w,
      inRange,
      days,
      cost: costOf(priced, price),
      tally: tallyOf(priced),
      buckets: costBuckets(inRange, w.keys, price),
      useLifetime,
    };
  }, [usage, range, price]);

  const spec = RANGES.find((r) => r.key === range) ?? RANGES[1];
  const hourly = spec.unit === "hour";
  const period = rangePhrase(spec.key, tTok);

  const series: BarSeries[] = [
    { id: "input", label: t("series.input"), color: "var(--color-accent)" },
    { id: "output", label: t("series.output"), color: "var(--color-violet)" },
  ];
  const chartBuckets: BarBucket[] = (view?.buckets ?? []).map((b) => ({
    key: b.key,
    label: bucketLabel(b.key, spec.unit, undefined, locale),
    title: bucketTitle(b.key, spec.unit, undefined, tTok, locale),
    values: { input: b.input, output: b.output },
  }));

  return (
    <div className="tk cp">
      <header className="page-head">
        <div>
          <h1>{t("title")}</h1>
          <p className="page-head__sub">{t("subtitle")}</p>
        </div>
      </header>

      {error ? (
        <div className="panel tk-note tk-note--err" role="alert">
          <span>
            {usage ? t("errors.stale", { error }) : t("errors.load", { error })}
          </span>
          <button type="button" className="btn btn--sm" onClick={() => setTick((n) => n + 1)}>
            {t("retry")}
          </button>
        </div>
      ) : null}

      <section className="panel tk-card" aria-labelledby="cp-pick-title">
        <div className="tk-card__head">
          <div>
            <h2 id="cp-pick-title" className="tk-card__title">
              {t("pricedAs")}
            </h2>
            {price ? <PriceLine price={price} /> : <p className="tk-card__sub">{t("chooseHint")}</p>}
          </div>
          <ModelPicker models={prices?.models ?? []} selectedId={price?.id ?? null} onSelect={selectModel} />
        </div>
      </section>

      {view && price ? (
        <>
          <CostTiles cost={view.cost} tally={view.tally} range={spec} days={view.days} />

          <section className="panel tk-card" aria-labelledby="cp-chart-title">
            <div className="tk-card__head">
              <div>
                <h2 id="cp-chart-title" className="tk-card__title">
                  {hourly ? t("chart.titleHour") : t("chart.titleDay")}
                </h2>
                <p className="tk-card__sub">
                  {view.useLifetime ? t("chart.subLifetime", { period, model: price.id }) : t("chart.sub", { period, model: price.id })}
                </p>
              </div>
              <div className="tk-card__tools">
                <div className="seg" role="group" aria-label={t("chart.rangeAria")}>
                  {RANGES.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      className={r.key === range ? "is-on" : undefined}
                      aria-pressed={r.key === range}
                      onClick={() => setRange(r.key)}
                    >
                      {rangeLabel(r.key, tTok)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <StackedBarChart
              buckets={chartBuckets}
              series={series}
              height={240}
              format={fmtMoney}
              unit={t("chart.unit")}
              empty={t("chart.empty")}
              ariaLabel={hourly ? t("chart.ariaHour", { model: price.id }) : t("chart.ariaDay", { model: price.id })}
            />
            <ul className="legend tk-legend">
              {series.map((s) => (
                <li key={s.id} style={{ "--c": s.color } as React.CSSProperties}>
                  <span>{s.label}</span>
                  <em className="mono">{fmtMoney(s.id === "input" ? view.cost.inputCost : view.cost.outputCost)}</em>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel tk-card tk-about" aria-labelledby="cp-about-title">
            <h2 id="cp-about-title" className="tk-card__title">
              {t("about.title")}
            </h2>
            <ul>
              <li>
                {t("about.rates", {
                  input: fmtMoney(price.inputCostPerToken * 1_000_000),
                  output: fmtMoney(price.outputCostPerToken * 1_000_000),
                })}
              </li>
              <li>
                {price.cacheReadCostPerToken != null
                  ? t("about.cacheRate", {
                      rate: fmtMoney(price.cacheReadCostPerToken * 1_000_000),
                      savings: fmtMoney(view.cost.cacheSavings),
                      period,
                    })
                  : t("about.noCacheRate")}
              </li>
              <li>
                {t("about.sourceBefore")}
                <a
                  href="https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("about.sourceLink")}
                </a>
                {t("about.refreshedDaily")}
                {prices?.at ? t("about.lastFetched", { date: new Date(prices.at).toLocaleString(locale) }) : ""}
                {prices?.stale ? t("about.staleNote") : ""}
                {t("about.sourceEnd")}
              </li>
              <li>{t("about.counters")}</li>
            </ul>
          </section>
        </>
      ) : usage ? (
        pricesError ? (
          <div className="panel tk-note tk-note--err" role="status">
            <b>{t("pricesError")}</b> {pricesError}
            <button type="button" className="btn btn--sm" onClick={() => setTick((n) => n + 1)}>
              {t("retry")}
            </button>
          </div>
        ) : prices && prices.models.length === 0 ? (
          <div className="panel tk-note" role="status">
            <b>{t("noPrices.title")}</b>{t("noPrices.body")}
            <button type="button" className="btn btn--sm" onClick={() => setTick((n) => n + 1)}>{t("retry")}</button>
          </div>
        ) : prices ? (
          <div className="panel tk-note" role="status">{t("chooseToCompare")}</div>
        ) : (
          <div className="panel tk-note" role="status">
            {t("loadingPrices")}
          </div>
        )
      ) : (
        <div className="panel tk-note" role="status">
          {t("loading")}
        </div>
      )}
    </div>
  );
}

function PriceLine({ price }: { price: ModelPrice }) {
  const { t } = useTranslation("cost");
  // Digits stay en-US so prices and sizes read the same in every browser.
  const ctx = [
    price.provider,
    price.maxInputTokens ? t("contextSize", { k: Math.round(price.maxInputTokens / 1000).toLocaleString("en-US") }) : null,
  ].filter(Boolean);
  return (
    <p className="tk-card__sub">
      <span className="mono">{price.id}</span>
      {ctx.length ? ` · ${ctx.join(" · ")}` : ""} · {priceLabel(price, t)}
    </p>
  );
}

function CostTiles({
  cost,
  tally,
  range,
  days,
}: {
  cost: { inputCost: number; outputCost: number; cacheSavings: number; totalCost: number };
  tally: Tally;
  range: RangeSpec;
  /** Buckets the per-day average is spread over (All time: every tracked day). */
  days: number;
}) {
  const { t } = useTranslation("cost");
  const { t: tTok } = useTranslation("tokens");
  const period = rangePhrase(range.key, tTok);
  const hourly = range.unit === "hour";
  const blended = blendedPerMillion(cost.totalCost, tally.total);
  const outputShare = cost.totalCost > 0 ? cost.outputCost / cost.totalCost : 0;
  // The engine published no cached-prompt counter: the cached share is unknown, not
  // zero. Saying "0 of them cached" would read as a measured cache miss and hide that
  // every prompt token is priced at the full input rate, which overstates the bill.
  const cacheUnknown = tally.cacheReported === false;
  return (
    <section className="tk-tiles" aria-label={t("tiles.aria", { period })}>
      <Tile label={t("tiles.total")} value={fmtMoney(cost.totalCost)} sub={t("tiles.totalSub", { period })} title={cost.totalCost.toFixed(6)} />
      <Tile
        label={t("series.input")}
        value={fmtMoney(cost.inputCost)}
        sub={
          cacheUnknown
            ? t("tiles.inputSubUnknown", { prompt: fmt(tally.prompt) })
            : t("tiles.inputSub", { prompt: fmt(tally.prompt), cached: fmt(tally.cached) })
        }
        title={cost.inputCost.toFixed(6)}
      />
      <Tile
        label={t("series.output")}
        value={fmtMoney(cost.outputCost)}
        sub={t("tiles.outputSub", { tokens: fmt(tally.generated), pct: (outputShare * 100).toFixed(0) })}
        title={cost.outputCost.toFixed(6)}
      />
      <Tile
        label={t("tiles.savings")}
        value={cost.cacheSavings > 0 ? fmtMoney(cost.cacheSavings) : "—"}
        sub={
          cost.cacheSavings > 0
            ? t("tiles.savingsSub")
            : cacheUnknown
              ? t("tiles.savingsUnknown")
              : t("tiles.savingsNoDiscount")
        }
      />
      <Tile
        label={hourly ? t("tiles.avgHour") : t("tiles.avgDay")}
        value={fmtMoney(cost.totalCost / Math.max(1, days))}
        unit={hourly ? t("tiles.perHour") : t("tiles.perDay")}
        sub={
          hourly
            ? t("tiles.acrossHours", { count: days })
            : range.count == null
              ? t("tiles.acrossDaysTracked", { count: days })
              : t("tiles.acrossDays", { count: days })
        }
      />
      <Tile
        label={t("tiles.blended")}
        value={blended == null ? "—" : `$${blended.toFixed(2)}`}
        unit="/ 1M tok"
        sub={t("tiles.blendedSub", { tokens: fmt(tally.total) })}
      />
    </section>
  );
}

function Tile({ label, value, unit, sub, title }: { label: string; value: string; unit?: string; sub?: string; title?: string }) {
  return (
    <div className="tk-tile" title={title}>
      <span className="eyebrow">{label}</span>
      <div className="big-num">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {sub ? <p className="tk-tile__sub">{sub}</p> : null}
    </div>
  );
}

/** Searchable dropdown over the whole catalog (thousands of chat models). */
function ModelPicker({
  models,
  selectedId,
  onSelect,
}: {
  models: ModelPrice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation("cost");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selected = models.find((m) => m.id === selectedId) ?? null;
  const results = useMemo(() => filterModels(models, query), [models, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setActive(0);
  }, [open]);

  const pick = (m: ModelPrice) => {
    onSelect(m.id);
    setOpen(false);
  };

  return (
    <div className="cp-picker" ref={rootRef}>
      <button type="button" className="cp-toggle" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="cp-toggle__id">{selected ? selected.id : t("picker.choose")}</span>
        {selected ? <span className="cp-toggle__price">{priceLabel(selected, t)}</span> : null}
      </button>
      {open ? (
        <div className="cp-pop" role="listbox" aria-label={t("picker.catalogAria")}>
          <div className="cp-search">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                else if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
                else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
                else if (e.key === "Enter") {
                  const m = results[active];
                  if (m) pick(m);
                  e.preventDefault();
                }
              }}
              placeholder={t("picker.searchPlaceholder", { n: models.length })}
              aria-label={t("picker.searchAria")}
            />
          </div>
          <ul className="cp-list">
            {results.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={m.id === selectedId}
                  className={`cp-item${i === active ? " is-active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(m)}
                >
                  <span className="cp-item__id">{m.id}</span>
                  <span className="cp-item__meta">{priceLabel(m, t)}</span>
                </button>
              </li>
            ))}
            {results.length === 0 ? <li className="cp-empty">{t("picker.noMatch", { query })}</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * LlmTokenTotals — per-model cumulative prompt/completion token table.
 * Local-only component: lives in its own file, rendered by LlmPanel via one
 * anchor line + one import line (see docs/LOCAL-MODS.md).
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchLlmTokenTotals } from "../../api/llmTokenClient";
import { formatTokensCompact } from "../../shared/tokenFormat";
import { formatSince } from "../../shared/formatSince";
import type { LlmTokenRange, LlmTokenSeriesTotals } from "../../api/llmTokenTypes";
import { tokenRowTitle, unreportedOf } from "./tokenTotalsCopy";

const POLL_MS = 60_000;

export function LlmTokenTotals({ sparkId, llmPort }: { sparkId: string; llmPort: number }) {
  const { t } = useTranslation("llm");
  const rangeOptions: Array<{ value: LlmTokenRange; label: string }> = [
    { value: "all", label: t("tokens.rangeAll") },
    { value: "today", label: t("tokens.range24h") },
    { value: "6h", label: t("tokens.range6h") },
    { value: "1h", label: t("tokens.range1h") },
    { value: "7d", label: t("tokens.range7d") },
    { value: "14d", label: t("tokens.range14d") },
    { value: "30d", label: t("tokens.range30d") },
  ];
  const [series, setSeries] = useState<LlmTokenSeriesTotals[] | null>(null);
  const [range, setRange] = useState<LlmTokenRange>("all");

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchLlmTokenTotals(range)
        .then((res) => {
          if (!cancelled) setSeries(res.series || []);
        })
        .catch(() => {
          if (!cancelled) setSeries([]);
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sparkId, llmPort, range]);

  if (!series || series.length === 0) return null;

  const rows = series
    .filter((s) => s.sparkId === sparkId && s.port === llmPort)
    .flatMap((s) => s.models)
    .map((m) => ({ ...m, unreportedPromptTokens: unreportedOf(m) }));

  if (rows.length === 0 && range === "all") return null;

  return (
    <div className="sp-section">
      <div className="sp-section__head">
        <span className="min-w-0" title={t("tokens.ledgerTitle")}>
          <span className="eyebrow block">{t("tokens.heading")}</span>
          <span className="sp-muted block">{t("tokens.ledgerHint")}</span>
        </span>
        <div className="flex items-center gap-2">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as LlmTokenRange)}
            aria-label={t("tokens.rangeAria")}
            className="sp-select"
          >
            {rangeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="sp-tok-cols">
            <span className="inline-block w-14 text-right">{t("tokens.cached")}</span>

            <span className="inline-block w-14 text-right">{t("tokens.prefill")}</span>

            <span className="inline-block w-16 text-right">{t("tokens.generated")}</span>
          </span>
        </div>
      </div>
      <div className="sp-tok-rows">
        {rows.length === 0 ? (
          <p className="sp-muted">{t("tokens.empty")}</p>
        ) : (
          rows.map((row) => {
          const seen = formatSince(row.lastSeenAt);
          return (
            <div
              key={row.modelId}
              className="flex items-center justify-between gap-2 text-[11px]"
              title={seen ? t("tokens.rowSeen", { title: tokenRowTitle(row, t), since: seen }) : tokenRowTitle(row, t)}
            >
              <span
                className="min-w-0 flex-1 truncate text-text"
                title={row.modelId}
              >
                {row.modelId}
              </span>
              <span className="shrink-0 font-tabular text-muted">
                <span className="inline-block w-14 text-right">
                  {row.cachedTokens > 0 ? formatTokensCompact(row.cachedTokens) : "—"}
                </span>

                <span className="inline-block w-14 text-right">
                  {formatTokensCompact(row.promptTokens - row.cachedTokens - row.unreportedPromptTokens)}
                </span>

                <span className="inline-block w-16 text-right text-text">
                  {formatTokensCompact(row.completionTokens)}
                </span>
              </span>
            </div>
          );
        })
        )}
      </div>
    </div>
  );
}

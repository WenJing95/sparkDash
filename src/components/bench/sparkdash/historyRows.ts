import type { TFunction } from "i18next";
import type { DecodeBenchJob, PrefillBenchJob, QualityBenchJob } from "../../../api/types";
import { formatContextSize } from "../../../shared/prefillBench.js";
import { i18n } from "../../../i18n";

/** One fact in a history row's secondary line; worded at render time so it follows the UI language. */
export type HistoryDetailPart =
  | { kind: "peakAt"; concurrency: number }
  | { kind: "perStream"; tps: string }
  | { kind: "sampling"; temp: number; thinking: boolean; topK: number | null }
  | { kind: "startCtx"; size: string }
  | { kind: "bestAt"; size: string }
  | { kind: "categories"; count: number };

function partText(t: TFunction<"benchPages">, p: HistoryDetailPart): string {
  switch (p.kind) {
    case "peakAt":
      return t("rows.peakAt", { concurrency: p.concurrency });
    case "perStream":
      return t("rows.perStream", { tps: p.tps });
    case "sampling":
      return (
        (p.thinking ? t("rows.samplingOn", { temp: p.temp }) : t("rows.samplingOff", { temp: p.temp })) +
        (p.topK != null ? t("rows.topK", { topK: p.topK }) : "")
      );
    case "startCtx":
      return t("rows.startCtx", { size: p.size });
    case "bestAt":
      return t("rows.bestAt", { size: p.size });
    case "categories":
      return t("rows.categories", { count: p.count });
    default:
      return "";
  }
}

/** The secondary line of a history row, in the language of `t`. */
export function historyDetailText(t: TFunction<"benchPages">, parts: readonly HistoryDetailPart[]): string {
  return parts.map((p) => partText(t, p)).join(" · ");
}

/** English wording for the plain `detail` string (tests and text consumers); the table renders `detailParts`. */
const EN: TFunction<"benchPages"> = i18n.getFixedT("en", "benchPages");

function withDetail<T extends Omit<HistoryRow, "detail">>(row: T): T & { detail: string } {
  return { ...row, detail: historyDetailText(EN, row.detailParts) };
}

/** One line of a bench page's run-history table. */
export interface HistoryRow {
  id: string;
  startedAt: number;
  status: "running" | "completed" | "failed" | "cancelled";
  /** Run label (quality) or the bench's own shape, e.g. "×1, 2, 4". */
  label: string;
  model: string | null;
  /** Endpoint port the run used, when the history spans several (quality). */
  port?: number | null;
  /** The number to compare runs by, already formatted. */
  headline: string;
  /** Secondary facts for the same run, in English. */
  detail: string;
  /** The same facts as data, worded in the UI language when rendered. */
  detailParts: HistoryDetailPart[];
}

function aggregate(r: DecodeBenchJob["results"][number]): number {
  return r.aggregateDecodeTps > 0 ? r.aggregateDecodeTps : r.meanDecodeTps;
}

/** Peak aggregate decode tok/s over the levels that produced tokens. */
export function decodeHistoryRow(job: DecodeBenchJob): HistoryRow {
  const ok = job.results.filter((r) => r.totalDecodeTokens > 0 || r.totalCompletionTokens > 0);
  const best = ok.reduce<DecodeBenchJob["results"][number] | null>(
    (b, r) => (b == null || aggregate(r) > aggregate(b) ? r : b),
    null
  );
  const single = ok.find((r) => r.concurrency === 1);
  const cfg = job.config;
  const parts: (HistoryDetailPart | null)[] = [
    best ? { kind: "peakAt", concurrency: best.concurrency } : null,
    single ? { kind: "perStream", tps: single.meanDecodeTps.toFixed(1) } : null,
    {
      kind: "sampling",
      temp: typeof cfg?.temperature === "number" ? cfg.temperature : 0,
      thinking: typeof cfg?.thinking === "boolean" ? cfg.thinking : false,
      topK: cfg?.topK != null ? cfg.topK : null,
    },
    cfg.contextTokens ? { kind: "startCtx", size: formatContextSize(cfg.contextTokens) } : null,
  ];
  return withDetail({
    id: job.benchId,
    startedAt: job.startedAt,
    status: job.status,
    label: `×${job.config.concurrencies.join(", ")}`,
    model: job.config.modelId ?? job.results.find((r) => r.model)?.model ?? null,
    headline: best ? `${aggregate(best).toFixed(1)} tok/s` : "—",
    detailParts: parts.filter((p): p is HistoryDetailPart => p != null),
  });
}

/** Fastest prefill tok/s over the context sizes that completed. */
export function prefillHistoryRow(job: PrefillBenchJob): HistoryRow {
  const ok = job.results.filter((r) => r.prefillTps > 0);
  const best = ok.reduce<PrefillBenchJob["results"][number] | null>(
    (b, r) => (b == null || r.prefillTps > b.prefillTps ? r : b),
    null
  );
  const sizes = job.config.contextSizes;
  return withDetail({
    id: job.benchId,
    startedAt: job.startedAt,
    status: job.status,
    label: sizes.length ? sizes.map(formatContextSize).join(", ") : "—",
    model: job.config.modelId ?? job.results.find((r) => r.model)?.model ?? null,
    headline: best ? `${best.prefillTps.toFixed(1)} tok/s` : "—",
    detailParts: best ? [{ kind: "bestAt", size: formatContextSize(best.targetTokens) }] : [],
  });
}

export function qualityHistoryRow(job: QualityBenchJob): HistoryRow {
  const overall = job.results?.overallPct;
  const cats = Object.keys(job.results?.categories ?? {}).length;
  return withDetail({
    id: job.benchId,
    startedAt: job.startedAt,
    status: job.status,
    label: job.config.label || "—",
    model: job.config.modelId ?? null,
    port: Number.isInteger(job.config.port) ? job.config.port : null,
    headline: overall == null ? "—" : `${overall.toFixed(1)}%`,
    detailParts: cats ? [{ kind: "categories", count: cats }] : [],
  });
}

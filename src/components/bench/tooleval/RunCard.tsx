import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { previewToolEval, probeToolEval } from "../../../api/client";
import type { SparkSnapshot, ToolEvalProbeResponse, ToolEvalRunRequest } from "../../../api/types";
import { Tag } from "../../ui/Tag";
import type { PreviewState } from "./hooks";
import { CopyButton, Notice } from "./parts";

interface RunCardProps {
  spark: SparkSnapshot;
  type: string;
  request: ToolEvalRunRequest;
  preview: PreviewState;
  /** Client-side + server validation messages for the whole form (shown as a list). */
  problems: string[];
  installed: boolean;
  busyReason: string | null;
  starting: boolean;
  onStart: () => void;
  baseUrl: string;
  /** Option values for the probe (base URL). */
  probeOptions: Record<string, unknown>;
  port?: number;
  hasScenarios: boolean;
  startError: string | null;
}

/** Live command line, validation summary, connection check, scenario preview and the Start button. */
export function RunCard({ spark, type, request, preview, problems, installed, busyReason, starting, onStart, baseUrl, probeOptions, port, hasScenarios, startError }: RunCardProps) {
  const { t } = useTranslation("toolEval");
  const [probe, setProbe] = useState<{ loading: boolean; res: ToolEvalProbeResponse | null; error: string | null }>({ loading: false, res: null, error: null });
  const [dry, setDry] = useState<{ loading: boolean; output: string | null; error: string | null }>({ loading: false, output: null, error: null });

  const runProbe = async () => {
    setProbe({ loading: true, res: null, error: null });
    try {
      setProbe({ loading: false, res: await probeToolEval(spark.id, probeOptions, port), error: null });
    } catch (e) {
      setProbe({ loading: false, res: null, error: e instanceof Error ? e.message : String(e) });
    }
  };
  const runDry = async () => {
    setDry({ loading: true, output: null, error: null });
    try {
      const r = await previewToolEval(spark.id, { ...request, dryRun: true });
      setDry({ loading: false, output: r.dryRun ? r.dryRun.output || (r.dryRun.error ?? t("terminal.empty")) : t("terminal.empty"), error: r.dryRun && !r.dryRun.ok ? r.dryRun.error ?? t("run.exited", { code: r.dryRun.exitCode }) : null });
    } catch (e) {
      setDry({ loading: false, output: null, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const invalid = problems.length > 0 || preview.status === "invalid";
  const reason = !installed ? t("run.installFirst") : invalid ? t("run.fixFirst") : busyReason;
  const disabled = Boolean(reason) || starting || preview.status === "error";
  const probeOutput = probe.res?.output?.trim() ?? "";

  return (
    <aside className="panel te-card te-runcard" aria-label={t("run.aria")}>
      <div className="te-card__head">
        <h2>{t("run.command")}</h2>
        {preview.status === "loading" ? <span className="te-faint" aria-live="polite">{t("run.updating")}</span> : null}
        {preview.status === "ok" ? <Tag tone="good">{t("run.valid")}</Tag> : null}
        {invalid ? <Tag tone="bad">{t("run.needsAttention")}</Tag> : null}
      </div>
      <p className="te-target">
        <Trans t={t} i18nKey="run.target" values={{ name: spark.name, url: baseUrl }} components={{ b: <b />, mono: <span className="mono" /> }} />
      </p>
      <div className="te-cmd">
        <div className="te-cmd__head">
          <span className="eyebrow">{t("run.commandLine")}</span>
          {preview.command ? <CopyButton text={preview.command} /> : null}
        </div>
        <pre className="te-cmd__body" aria-live="polite">
          {preview.command ?? (invalid ? t("run.fixToSee") : preview.status === "error" ? t("run.previewUnavailable") : "…")}
        </pre>
        <p className="te-faint te-cmd__foot">
          {preview.usesSavedKey ? t("run.usesSavedKey") : ""}
          {t("run.keyNote")}
        </p>
      </div>
      {preview.status === "error" ? <Notice tone="bad" title={t("run.previewFailed")}>{preview.error}</Notice> : null}
      {preview.errors.length || problems.length ? (
        <ul className="te-form-errors" role="alert">
          {[...new Set([...problems, ...preview.errors])].map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {startError ? <Notice tone="bad" title={t("run.couldNotStart")}>{startError}</Notice> : null}

      <div className="te-actions te-actions--stack">
        <button type="button" className="btn btn--primary te-start" disabled={disabled} onClick={onStart} aria-describedby={reason ? "te-start-reason" : undefined}>
          {starting ? t("live.phase.init") : type === "tool-eval" ? t("run.startEvaluation") : t("run.startBenchmark")}
        </button>
        {reason ? (
          <p className="te-faint" id="te-start-reason">
            {reason}
          </p>
        ) : null}
        <div className="te-actions">
          <button type="button" className="btn btn--sm" onClick={runProbe} disabled={probe.loading || !installed}>
            {probe.loading ? t("common.checking") : t("run.checkConnection")}
          </button>
          {hasScenarios ? (
            <button type="button" className="btn btn--sm" onClick={runDry} disabled={dry.loading || !installed || invalid}>
              {dry.loading ? t("run.loading") : t("run.previewScenarios")}
            </button>
          ) : null}
        </div>
      </div>

      {probe.res || probe.error ? (
        <div className="te-probe" role="status">
          <Tag tone={probe.res?.ok ? "good" : "bad"}>{probe.res?.ok ? t("run.reachable") : t("run.notReachable")}</Tag>
          <span className="te-faint mono">{probe.res?.target}</span>
          {probeOutput || probe.res?.error || probe.error ? <pre>{probeOutput || probe.res?.error || probe.error}</pre> : null}
        </div>
      ) : null}
      {dry.output != null || dry.error ? (
        <div className="te-probe" role="status">
          <div className="te-probe__head">
            <b>{t("run.wouldRun")}</b>
            {dry.output ? <CopyButton text={dry.output} /> : null}
          </div>
          {dry.error ? <p className="te-bad">{dry.error}</p> : null}
          {dry.output ? <pre>{dry.output}</pre> : null}
        </div>
      ) : null}
    </aside>
  );
}

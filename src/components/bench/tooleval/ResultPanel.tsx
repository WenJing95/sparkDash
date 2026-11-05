import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ToolEvalLine, ToolEvalRun } from "../../../api/types";
import { Tag } from "../../ui/Tag";
import { GenericResult, GenericValue } from "./GenericResult";
import { explainErrorCode, fmtDate, fmtDuration, toolNotes } from "./format";
import { useToolEvalResult } from "./hooks";
import { hasScenarioData, isObj, normalizeToolResult } from "./normalize";
import { CopyButton, Notice, RunTerminal, Skeleton } from "./parts";
import { buildToolEvalShareCard } from "../../SparkPage/benchShareCard";
import { ShowCardButton } from "./ShowCardButton";
import { statusLabel, statusTone } from "./status";
import { ToolResult } from "./ToolResult";

/** Run facts: when, how long, what it ran against, the command and the (redacted) options. */
export function RunMeta({ run, actions }: { run: ToolEvalRun; actions?: ReactNode }) {
  const { t } = useTranslation("toolEval");
  const dur = run.finishedAt ? (run.finishedAt - run.startedAt) / 1000 : null;
  const optionCount = Object.keys(run.options ?? {}).length;
  return (
    <div className="te-runmeta">
      <div className="te-runmeta__tags">
        <Tag tone={statusTone(run.status)}>{statusLabel(t, run.status)}</Tag>
        <span className="te-faint">{fmtDate(run.startedAt)}</span>
        {dur != null ? <span className="te-faint">{t("result.took", { time: fmtDuration(dur) })}</span> : null}
        {run.model ? <Tag tone="neutral">{run.model}</Tag> : null}
        <span className="te-faint mono">{run.id}</span>
        {actions ? <span className="te-runmeta__actions">{actions}</span> : null}
      </div>
      <div className="te-cmd">
        <div className="te-cmd__head">
          <span className="eyebrow">{t("run.command")}</span>
          <CopyButton text={run.command} />
        </div>
        <pre className="te-cmd__body">{run.command}</pre>
      </div>
      {optionCount ? (
        <details className="te-disclosure">
          <summary>
            <span>{t("result.optionsUsed", { count: optionCount })}</span>
          </summary>
          <div className="te-disclosure__body">
            <GenericValue value={run.options} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

interface ResultPanelProps {
  sparkId: string;
  /** Display name of the unit, printed on the share card. */
  sparkName?: string;
  type: string;
  run: ToolEvalRun;
  /** Output captured while this page followed the run (only available for runs started or watched in this visit). */
  lines?: ToolEvalLine[];
  errorCode?: { code: string; message: string | null } | null;
  /** Bumped when the run settles so the result is re-read. */
  version?: number;
}

/** The result of one run: headline renderers for tool-call data, metric-first for everything else, and failure explanations. */
export function ResultPanel({ sparkId, sparkName, type, run, lines, errorCode, version }: ResultPanelProps) {
  const { t } = useTranslation("toolEval");
  const wantsResult = run.status === "completed" || run.status === "stopped" || run.status === "failed";
  const state = useToolEvalResult(sparkId, wantsResult ? run.id : null, version);
  const tool = state.result ? normalizeToolResult(state.result) : null;
  const scenarios = state.result ? hasScenarioData(state.result) : false;
  const isToolType = type === "tool-eval" || type === "context-pressure";
  const failed = run.status === "failed" || run.status === "stopped" || run.status === "gone";
  const stripped = isObj(state.result) && scenarios ? Object.fromEntries(Object.entries(state.result).filter(([k]) => k !== "scores")) : state.result;

  return (
    <div className="te-result">
      <RunMeta run={run} actions={
          scenarios && tool && isToolType ? (
            <ShowCardButton
              kind="tool-eval"
              build={() => buildToolEvalShareCard(tool, run, { sparkName, te: t })}
              dialogLabel={t("result.cardDialog")}
              imgAlt={tool.score != null ? t("result.cardAltScore", { score: tool.score.toFixed(1) }) : t("result.cardAlt")}
              title={t("result.cardTitle")}
            />
          ) : null
        } />
      {failed ? (
        <Notice tone={run.status === "failed" ? "bad" : "warn"} title={run.status === "failed" ? (run.exitCode != null ? t("live.failedExit", { code: run.exitCode }) : t("live.failed")) : run.status === "stopped" ? t("live.stoppedTitle") : t("result.goneTitle")}>
          {errorCode
            ? explainErrorCode(errorCode.code, errorCode.message, t)
            : run.status === "gone"
              ? t("result.goneBody")
              : t("result.incomplete")}
        </Notice>
      ) : null}
      {!failed && lines && lines.length ? (
        <>
          {toolNotes(lines, t).length ? (
            <Notice tone="info" title={t("live.goodToKnow")}>
              {toolNotes(lines, t).map((n) => (
                <p key={n.key}>{n.text}</p>
              ))}
            </Notice>
          ) : null}
        </>
      ) : null}
      {failed && lines && lines.length ? (
        <details className="te-disclosure" open>
          <summary>
            <span>{t("result.output")}</span>
          </summary>
          <div className="te-disclosure__body">
            <RunTerminal lines={lines} />
          </div>
        </details>
      ) : null}
      {run.status === "running" ? <Notice tone="info">{t("result.notFinished")}</Notice> : null}
      {state.loading ? <Skeleton lines={5} /> : null}
      {state.error && wantsResult ? (
        <Notice tone={failed ? "info" : "bad"} title={failed ? t("result.noSaved") : t("result.loadError")} actions={failed ? null : <button type="button" className="btn btn--sm" onClick={state.reload}>{t("common.retry")}</button>}>
          {state.error}
        </Notice>
      ) : null}
      {state.result != null && !state.loading ? (
        <>
          {scenarios && tool ? <ToolResult data={tool} raw={state.result} /> : null}
          {(!isToolType || !scenarios) && !(scenarios && isToolType) ? <GenericResult result={stripped} /> : null}
          {scenarios && isToolType && type === "context-pressure" ? <GenericResult result={stripped} compact /> : null}
        </>
      ) : null}
    </div>
  );
}

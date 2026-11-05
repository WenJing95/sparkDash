import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { SparkSnapshot } from "../../api/types";
import { shutdownSpark, wakeSpark } from "../../api/client";
import { ConfirmShutdownDialog } from "../ConfirmShutdownDialog";
import { openHermesUpdateDialog } from "../../hooks/useHermesUpdateDialog";
import { EditIcon, PowerOffIcon, PowerOnIcon, RotateIcon } from "../ui/icons";

interface SparkActionsProps {
  spark: SparkSnapshot;
  onEdit?: () => void;
  /** Classes for the button-cluster wrapper (controls responsive visibility). */
  className?: string;
}

/**
 * Work a shutdown would interrupt, from signals already in the snapshot:
 * in-flight LLM requests, a running ComfyUI job, a Hermes update.
 */
export function shutdownWarnings(spark: SparkSnapshot, t: TFunction<"spark">): string[] {
  const out: string[] = [];
  const ports = spark.llmPorts ?? [];
  (spark.metrics.llm ?? []).forEach((l, i) => {
    if (!l?.available) return;
    const running = Math.round(l.requestsRunning ?? 0);
    const waiting = Math.round(l.requestsWaiting ?? 0);
    const busy = running + waiting > 0 ? running + waiting : (l.slotsActive ?? 0) > 0 ? (l.slotsActive ?? 0) : 0;
    if (busy > 0) {
      const port = ports[i];
      out.push(port != null ? t("actions.inFlightOnPort", { count: busy, port }) : t("actions.inFlight", { count: busy }));
    }
  });
  const job = spark.metrics.comfy?.activeJob;
  if (job) out.push(job.title ? t("actions.comfyJobTitled", { title: job.title }) : t("actions.comfyJob"));
  if (spark.hermes?.status === "running") out.push(t("actions.hermesInProgress"));
  return out;
}

/**
 * Update Hermes / Edit / Power action cluster.
 * Rendered twice: inline in the SparkHeader (desktop) and as a standalone row
 * just above "Resources" on mobile. Owning the shutdown dialog + transient
 * power message here keeps the two placements in sync.
 */
export function SparkActions({ spark, onEdit, className }: SparkActionsProps) {
  const { t } = useTranslation("spark");
  const online = spark.online;
  const [powerLoading, setPowerLoading] = useState(false);
  const [powerMsg, setPowerMsg] = useState<{ text: string; tone: "ok" | "err" } | null>(null);
  const [shutdownOpen, setShutdownOpen] = useState(false);

  const hermes = spark.hermes;
  const hermesRunning = hermes?.status === "running";

  function handleHermesUpdate() {
    openHermesUpdateDialog({
      sparkId: spark.id,
      sparkName: spark.name,
      currentVersion: hermes?.version ?? null,
    });
  }

  async function handleShutdown() {
    setPowerLoading(true);
    setPowerMsg(null);
    try {
      const res = await shutdownSpark(spark.id);
      setPowerMsg({ text: res.message || t("actions.shutdownInitiated"), tone: "ok" });
    } catch (err: unknown) {
      setPowerMsg({
        text: err instanceof Error ? err.message : t("actions.shutdownFailed"),
        tone: "err",
      });
    } finally {
      setPowerLoading(false);
      setTimeout(() => setPowerMsg(null), 5000);
    }
  }

  async function handleWake() {
    setPowerLoading(true);
    setPowerMsg(null);
    try {
      const res = await wakeSpark(spark.id);
      setPowerMsg({ text: res.message || t("actions.wakeSent"), tone: "ok" });
    } catch (err: unknown) {
      setPowerMsg({
        text: err instanceof Error ? err.message : t("actions.wakeFailed"),
        tone: "err",
      });
    } finally {
      setPowerLoading(false);
      setTimeout(() => setPowerMsg(null), 5000);
    }
  }

  return (
    <>
      <div className={className}>
        {powerMsg && (
          <span className={`sp-flash ${powerMsg.tone === "ok" ? "text-success" : "text-danger"}`}>
            {powerMsg.text}
          </span>
        )}
        {hermesRunning && (
          <span
            className="sp-flash text-warning"
            title={t("actions.hermesUpdatingTitle")}
          >
            <RotateIcon className="h-3.5 w-3.5 animate-spin" />
            {t("actions.hermesUpdating")}
          </span>
        )}
        {!hermesRunning && hermes?.monitoring && hermes.status === "error" && (
          <span
            className="sp-flash max-w-[16rem] truncate text-danger"
            title={hermes.error || t("actions.hermesUpdateFailed")}
          >
            {t("actions.hermesUpdateFailed")}
          </span>
        )}
        {!hermesRunning && hermes?.monitoring && hermes.installed !== false && (
          <button
            type="button"
            onClick={() => void handleHermesUpdate()}
            disabled={powerLoading}
            title={
              hermes.updateAvailable === true
                ? hermes.behindCommits
                  ? t("actions.updateHermesRunBehindTitle", { commits: hermes.behindCommits })
                  : t("actions.updateHermesRunTitle")
                : t("actions.updateHermesOpenTitle")
            }
            className={`btn ${hermes.updateAvailable === true ? "btn--warn" : ""}`}
          >
            <RotateIcon className="h-3.5 w-3.5" />
            {t("actions.updateHermes")}
            {hermes.version && <span className="sp-btn-sub mono">v{hermes.version.replace(/^v/i, "")}</span>}
            {hermes.updateAvailable === true && (
              <span
                className="sp-badge"
                title={
                  hermes.behindCommits != null
                    ? t("actions.behind", { count: hermes.behindCommits })
                    : t("actions.updateAvailable")
                }
              >
                {hermes.behindCommits != null ? hermes.behindCommits : "!"}
              </span>
            )}
          </button>
        )}
        {onEdit && (
          <button type="button" onClick={onEdit} className="btn">
            <EditIcon className="h-3.5 w-3.5" />
            {t("actions.edit")}
          </button>
        )}
        {online ? (
          <button
            type="button"
            onClick={() => setShutdownOpen(true)}
            disabled={powerLoading}
            title={t("actions.shutdownTitle")}
            className="btn btn--danger"
          >
            <PowerOffIcon className="h-3.5 w-3.5" />
            {t("actions.shutDown")}
          </button>
        ) : spark.kind === "host" ? (
          <button
            type="button"
            onClick={() => void handleWake()}
            disabled={powerLoading}
            title={t("actions.wakeTitle")}
            className="btn"
          >
            <PowerOnIcon className="h-3.5 w-3.5" />
            {t("actions.wake")}
          </button>
        ) : (
          <span
            className="sp-muted"
            title={t("actions.noWolTitle")}
          >
            {t("actions.noWol")}
          </span>
        )}
      </div>

      <ConfirmShutdownDialog
        open={shutdownOpen}
        onClose={() => setShutdownOpen(false)}
        onConfirm={handleShutdown}
        title={t("actions.confirmTitle", { name: spark.name })}
        description={t("actions.confirmDescription", { name: spark.name })}
        confirmLabel={t("actions.shutDown")}
        warnings={shutdownWarnings(spark, t)}
      />
    </>
  );
}
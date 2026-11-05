import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SparkSnapshot } from "../api/types";
import { shutdownAllSparks } from "../api/client";
import { ConfirmShutdownDialog } from "./ConfirmShutdownDialog";
import { shutdownWarningsText } from "./OverviewPage/fleetStats";
import { PowerOffIcon } from "./ui/icons";

/**
 * "Shut down all" with its confirmation and result message. Used in the Overview header (desktop)
 * and in the mobile Sparks sheet, so the flow exists once.
 */
export function ShutdownAll({ sparks, className = "" }: { sparks: SparkSnapshot[]; className?: string }) {
  const { t } = useTranslation("common");
  const { t: to } = useTranslation("overview");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Counts (or the raw server error) are kept, not text, so the message follows a language switch.
  const [msg, setMsg] = useState<
    { kind: "result"; ok: number; fail: number; skipped: number } | { kind: "error"; error: string | null } | null
  >(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onlineCount = sparks.filter((s) => s.online).length;

  async function run() {
    if (onlineCount === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await shutdownAllSparks();
      const ok = res.results.filter((r) => r.ok).length;
      const fail = res.results.filter((r) => !r.ok && !r.skipped).length;
      const skipped = res.results.filter((r) => r.skipped).length;
      setMsg({ kind: "result", ok, fail, skipped });
    } catch (err: unknown) {
      setMsg({ kind: "error", error: err instanceof Error ? err.message : null });
    } finally {
      setBusy(false);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setMsg(null), 6000);
    }
  }

  let msgText = "";
  if (msg?.kind === "result") {
    const parts = [t("shutdown.resultShutDown", { n: msg.ok })];
    if (msg.fail) parts.push(t("shutdown.resultFailed", { n: msg.fail }));
    if (msg.skipped) parts.push(t("shutdown.resultSkipped", { n: msg.skipped }));
    msgText = parts.join(t("shutdown.resultSeparator"));
  } else if (msg?.kind === "error") {
    msgText = msg.error ?? t("shutdown.batchFailed");
  }
  const msgOk = msg?.kind === "result" && msg.fail === 0;

  return (
    <>
      {msg ? (
        <span className={`ov-batchmsg ${msgOk ? "is-ok" : "is-err"}`} role="status">
          {msgText}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy || onlineCount === 0}
        title={t("shutdown.allTitle")}
        className={`btn btn--danger ${className}`}
      >
        <PowerOffIcon className="h-3.5 w-3.5" />
        {t("shutdown.all")}
      </button>
      <ConfirmShutdownDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={run}
        title={t("shutdown.allDialogTitle")}
        description={t("shutdown.allDescription", { count: onlineCount })}
        confirmLabel={t("shutdown.all")}
        warnings={shutdownWarningsText(to, sparks)}
      />
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { fetchGpuClock, fetchGpuClockCommand, resetGpuClock, setGpuClock } from "../api/client";
import type { GpuClockStatus } from "../api/types";

const MIN_CAP_MHZ = 300;

type Ready = Extract<GpuClockStatus, { supported: true }>;

/** Highest clock a boot hook applies, e.g. "0,2200" -> 2200. */
function bootMax(status: Ready): number | null {
  const m = /^\d+,(\d+)$/.exec(status.service.clocks ?? status.cron.clocks ?? "");
  return m ? Number(m[1]) : null;
}

/** A result line: raw text from the server, or the dashboard's own result rendered in the current language. */
type Message =
  | { ok: false; raw: string }
  | { ok: false; kind: "refused" }
  | { ok: true; kind: "capped"; mhz: number }
  | { ok: true; kind: "cappedKept"; mhz: number; persistKind: string }
  | { ok: true; kind: "removed" };

function messageText(t: TFunction<"gpuClock">, m: Message): string {
  if ("raw" in m) return m.raw;
  switch (m.kind) {
    case "refused": return t("refused");
    case "capped": return t("result.capped", { mhz: m.mhz });
    case "cappedKept":
      return m.persistKind === "cron" ? t("result.cappedKeptCron", { mhz: m.mhz }) : t("result.cappedKeptService", { mhz: m.mhz });
    case "removed": return t("result.removed");
  }
}

/** Command for running the change by hand: the command is shown as the server built it. */
type Manual = { kind: "apply"; mhz: number; persist: boolean; command: string } | { kind: "reset"; command: string };

function manualTitle(t: TFunction<"gpuClock">, m: Manual): string {
  if (m.kind === "reset") return t("manual.titleRemove");
  return m.persist ? t("manual.titleApplyKeep", { mhz: m.mhz }) : t("manual.titleApply", { mhz: m.mhz });
}

/**
 * GPU clock cap for one Spark (Edit unit). Acts immediately on the unit with the
 * saved connection settings: it is not part of the Save button.
 */
export function GpuClockSection({ sparkId }: { sparkId: string }) {
  const [status, setStatus] = useState<GpuClockStatus | null>(null);
  /** Raw error text from the server; "" means it gave none and the local fallback is shown. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [maxInput, setMaxInput] = useState("");
  const [persist, setPersist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  /** Command for running the change by hand on the unit (plain sudo, asks for the password). */
  const [manual, setManual] = useState<Manual | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Typed sudo password: kept in this component's state only, sent with one request, then cleared. */
  const [sudoPw, setSudoPw] = useState("");
  /** Only the newest request may write state: a slow answer for an older unit must not win. */
  const latest = useRef(0);
  const sparkRef = useRef(sparkId);
  sparkRef.current = sparkId;
  const { t } = useTranslation("gpuClock");

  const syncInputs = (s: GpuClockStatus) => {
    if (!s.supported) return;
    const cap = s.capMHz ?? bootMax(s);
    setMaxInput(cap != null ? String(cap) : "");
    setPersist(s.service.installed || s.cron.installed);
  };

  const load = useCallback(
    async (opts: { sync: boolean }) => {
      const mine = ++latest.current;
      try {
        const s = await fetchGpuClock(sparkId);
        if (mine !== latest.current) return;
        setStatus(s);
        setLoadError(null);
        if (opts.sync) syncInputs(s);
      } catch (err) {
        if (mine !== latest.current) return;
        // Keep what is on screen after a failed refresh; the message says what went wrong.
        setLoadError(err instanceof Error ? err.message : "");
      }
    },
    [sparkId]
  );

  useEffect(() => {
    setStatus(null);
    setLoadError(null);
    setMessage(null);
    setMaxInput("");
    setPersist(false);
    setManual(null);
    setManualError(null);
    setSudoPw("");
    setBusy(false);
    void load({ sync: true });
    return () => {
      latest.current += 1;
    };
  }, [load]);

  if (!status) {
    return (
      <div className="gpu-clock">
        <span className="field-label">{t("title")}</span>
        <p className={`field-hint${loadError !== null ? " is-warn" : ""}`} role="status">
          {loadError === null ? t("reading") : loadError || t("readFailed")}
        </p>
      </div>
    );
  }
  if (!status.supported) {
    return (
      <div className="gpu-clock">
        <span className="field-label">{t("title")}</span>
        <p className="field-hint">{status.reason || t("notAvailable")}</p>
      </div>
    );
  }

  const hwMax = status.hwMaxMHz;
  const maxMHz = Number(maxInput);
  const valid =
    maxInput.trim() !== "" &&
    Number.isInteger(maxMHz) &&
    maxMHz >= MIN_CAP_MHZ &&
    (hwMax == null || maxMHz <= hwMax);
  const sudoMissing = status.sudo === "no";
  /** A password typed here crosses the network: only over https or from the machine itself. */
  const secure =
    (typeof window === "undefined" || window.isSecureContext !== false) && status.passwordAllowed !== false;
  const needPw = sudoMissing && secure;
  const pwOk = !needPw || sudoPw.length > 0;
  const pwArg = needPw ? sudoPw : undefined;
  /**
   * No boot hook is reachable here at all: the checkbox says so instead of refusing on Apply.
   * Without passwordless sudo the status cannot probe for one, so a typed password decides it on the unit.
   */
  const cannotPersist = !sudoMissing && status.persistKind === "none";

  const run = async (action: () => Promise<Message>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await action());
    } catch (err) {
      setMessage(err instanceof Error && err.message ? { ok: false, raw: err.message } : { ok: false, kind: "refused" });
    } finally {
      // A slow answer for the unit you just left must not wipe what you type for this one.
      if (sparkRef.current === sparkId) {
        setBusy(false);
        setSudoPw("");
        await load({ sync: true });
      }
    }
  };

  const apply = () => {
    const question = status.persistKind === "cron" ? t("confirmPersistCron") : t("confirmPersistService");
    if (persist && !confirm(question)) return;
    void run(async () => {
      const out = await setGpuClock(sparkId, { maxMHz, persist, ...(pwArg ? { sudoPassword: pwArg } : {}) });
      return persist
        ? { ok: true, kind: "cappedKept", mhz: maxMHz, persistKind: out.persistKind }
        : { ok: true, kind: "capped", mhz: maxMHz };
    });
  };

  const remove = () => {
    if (!confirm(t("confirmRemove"))) return;
    void run(async () => {
      await resetGpuClock(sparkId, pwArg);
      return { ok: true, kind: "removed" };
    });
  };

  const showCommand = async (kind: "apply" | "reset") => {
    setManualError(null);
    setCopied(false);
    try {
      const q = kind === "apply" ? ({ action: "apply", maxMHz, persist } as const) : ({ action: "reset" } as const);
      const { command } = await fetchGpuClockCommand(sparkId, q);
      setManual(kind === "apply" ? { kind: "apply", mhz: maxMHz, persist, command } : { kind: "reset", command });
    } catch (err) {
      setManual(null);
      setManualError(err instanceof Error ? err.message : "");
    }
  };

  const copyCommand = async () => {
    if (!manual) return;
    try {
      await navigator.clipboard.writeText(manual.command);
      setCopied(true);
    } catch {
      // Plain-http dashboards have no clipboard API: the text box below is selectable.
      setCopied(false);
    }
  };

  return (
    <div className="gpu-clock">
      <label className="field-label" htmlFor="gpu-clock-max">
        {t("title")}
      </label>
      <p className="gpu-clock__now" data-testid="gpu-clock-now">
        {status.capMHz != null ? (
          <>
            {t("now.cappedAt")}<b>{status.capMHz} MHz</b>
            {hwMax != null ? t("now.hwMax", { mhz: hwMax }) : ""}
          </>
        ) : (
          <>{t("now.noCap")}{hwMax != null ? t("now.hwMax", { mhz: hwMax }) : ""}</>
        )}
        {status.service.installed
          ? t("now.bootService", {
              state:
                status.service.enabled === "enabled"
                  ? t("now.enabled")
                  : status.service.enabled || t("now.installed"),
            }) + (status.service.clocks ? t("now.clocks", { clocks: status.service.clocks }) : "")
          : status.cron.installed
            ? t("now.cronJob") + (status.cron.clocks ? t("now.clocks", { clocks: status.cron.clocks }) : "")
            : t("now.notKept")}
      </p>
      {status.cron.installed && status.cron.failed ? (
        <p className="field-hint is-warn" role="alert" data-testid="gpu-clock-boot-failed">
          {t("bootFailedBefore")}<code>sudo -n nvidia-smi -lgc</code>{t("bootFailedAfter")}
        </p>
      ) : null}
      <div className="gpu-clock__row">
        <input
          id="gpu-clock-max"
          type="number"
          min={MIN_CAP_MHZ}
          max={hwMax ?? undefined}
          inputMode="numeric"
          placeholder={hwMax != null ? `${MIN_CAP_MHZ}–${hwMax}` : "MHz"}
          value={maxInput}
          onChange={(e) => setMaxInput(e.target.value)}
          disabled={busy}
        />
        <span className="gpu-clock__unit">{t("mhzMax")}</span>
        <button type="button" className="btn btn--sm" onClick={apply} disabled={busy || !valid || !pwOk || (sudoMissing && !secure)}>
          {busy ? t("working") : t("apply")}
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={remove} disabled={busy || !pwOk || (sudoMissing && !secure)}>
          {t("removeLimit")}
        </button>
      </div>
      <label className="gpu-clock__check">
        <input
          type="checkbox"
          checked={persist}
          onChange={(e) => setPersist(e.target.checked)}
          disabled={busy || (cannotPersist && !persist)}
        />
        {cannotPersist
          ? t("persist.unavailable")
          : status.persistKind === "cron"
            ? t("persist.cron")
            : t("persist.service")}
      </label>
      {needPw && (
        <div>
          <label className="field-label" htmlFor="gpu-clock-sudo-pw">
            {t("sudo.label")}
          </label>
          <input
            id="gpu-clock-sudo-pw"
            type="password"
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            value={sudoPw}
            onChange={(e) => setSudoPw(e.target.value)}
            disabled={busy}
            placeholder={t("sudo.placeholder")}
          />
          <p className="field-hint">
            {t("sudo.hint")}
          </p>
        </div>
      )}
      {sudoMissing && !secure && (
        <p className="field-hint is-warn">
          {t("insecure.before")}<code>nvidia-smi -lgc</code>{t("insecure.and")}<code>-rgc</code>{t("insecure.after")}
        </p>
      )}
      {!sudoMissing && (
        <p className="field-hint">
          {status.sudo === "root" ? t("runs.rootBefore") : t("runs.sudoBefore")}
          <code>nvidia-smi -lgc 0,MAX</code>
          {status.sudo === "root" ? t("runs.rootAfter") : t("runs.sudoAfter")}
        </p>
      )}
      {cannotPersist ? (
        <p className="field-hint is-warn">
          {t("cannotPersist")}
        </p>
      ) : null}
      {maxInput.trim() !== "" && !valid && (
        <p className="field-hint is-warn">
          {hwMax != null ? t("range.between", { min: MIN_CAP_MHZ, max: hwMax }) : t("range.from", { min: MIN_CAP_MHZ })}
        </p>
      )}
      <details className="gpu-clock__manual" open={(sudoMissing && !secure) || manual != null}>
        <summary>{t("manual.summary")}</summary>
        <p className="field-hint">
          {t("manual.hintBefore")}<code>sudo</code>{t("manual.hintAfter")}
        </p>
        <div className="gpu-clock__row">
          <button type="button" className="btn btn--sm" onClick={() => void showCommand("apply")} disabled={!valid}>
            {t("manual.showApply")}
          </button>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => void showCommand("reset")}>
            {t("manual.showRemove")}
          </button>
        </div>
        {manualError !== null && <p className="field-hint is-warn" role="status">{manualError || t("manual.buildFailed")}</p>}
        {manual && (
          <>
            <p className="gpu-clock__now">{manualTitle(t, manual)}</p>
            <textarea className="gpu-clock__command" readOnly rows={8} value={manual.command} aria-label={t("manual.commandAria")} onFocus={(e) => e.currentTarget.select()} />
            <div className="gpu-clock__row">
              <button type="button" className="btn btn--sm" onClick={() => void copyCommand()}>
                {copied ? t("manual.copied") : t("manual.copy")}
              </button>
            </div>
          </>
        )}
      </details>
      {loadError !== null && (
        <p className="field-hint is-warn" role="status">
          {t("refreshFailed", { error: loadError || t("readFailed") })}
        </p>
      )}
      {message && (
        <p className={`field-hint ${message.ok ? "is-ok" : "is-warn"}`} role="status">
          {messageText(t, message)}
        </p>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  deleteSpark,
  fetchSparks,
  setSparkPassword,
  testSpark,
  testSparkConfig,
  updateSpark,
} from "../api/client";
import type { SparkConfig, SparkRole, SparkTestResponse } from "../api/types";
import { UNIT_TYPE_OPTIONS, unitTypeOf, unitTypePatch, type UnitType } from "../shared/deviceKind";
import { unitTypeLabel } from "./addSparkSteps";
import { resolveSparkRole } from "../api/sparkRole";
import { useModalPresence } from "../hooks/useModalPresence";
import { useOverlayClose } from "../hooks/useOverlayClose";
import { InfoIcon } from "./ui/icons";
import { TestResultList } from "./TestResultList";
import { GpuClockSection } from "./GpuClockSection";
import { XIcon } from "./ui/icons";
import "../styles/dialogs.css";

interface EditSparkDialogProps {
  open: boolean;
  sparkId: string | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted?: (id: string) => void;
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
}

export function EditSparkDialog({
  open,
  sparkId,
  onClose,
  onSaved,
  onDeleted,
}: EditSparkDialogProps) {
  const [config, setConfig] = useState<SparkConfig | null>(null);
  /** Snapshot of the Spark config as last fetched from the server. Used to
   *  detect form-vs-saved divergence so Test can target what the user is
   *  actually looking at (vs. the stored config the registered test route
   *  would read). */
  const [savedConfig, setSavedConfig] = useState<SparkConfig | null>(null);
  /** All Sparks — used for the worker head picker. */
  const [allSparks, setAllSparks] = useState<SparkConfig[]>([]);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<SparkTestResponse | null>(null);
  /** Raw server error text, shown as received. */
  const [error, setError] = useState<string | null>(null);
  /** Dashboard-side message, kept as a code so it follows a language switch. */
  const [localError, setLocalError] = useState<"notFound" | "enterPasswordFirst" | "passwordRequired" | null>(null);
  const [savedPasswordNote, setSavedPasswordNote] = useState<"encrypted" | "saved" | null>(null);
  const { t } = useTranslation("sparkForm");

  useEscape(onClose);

  const { mounted, visible } = useModalPresence(open);
  const overlayClose = useOverlayClose(onClose);

  // Prevent background scroll while the tall form is open (iOS)
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  useEffect(() => {
    if (!open || !sparkId) {
      setConfig(null);
      setSavedConfig(null);
      setAllSparks([]);
      setPassword("");
      setTestResult(null);
      setError(null);
      setLocalError(null);
      setSavedPasswordNote(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchSparks()
      .then((res) => {
        if (cancelled) return;
        setAllSparks(res.sparks);
        const found = res.sparks.find((s) => s.id === sparkId) || null;
        setConfig(found);
        setSavedConfig(found);
        if (!found) setLocalError("notFound");
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sparkId]);

  if (!mounted) return null;

  const role: SparkRole = resolveSparkRole(config ?? {});

  const update = (patch: Partial<SparkConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const setRole = (next: SparkRole) => {
    update({
      role: next,
      workerNode: next === "worker",
      // Leaving Worker: turn monitoring back on (worker forces it false in state).
      llmMonitoring: next === "worker" ? false : next === "head" ? true : true,
    });
  };

  const updateSsh = (patch: Partial<SparkConfig["ssh"]>) => {
    setConfig((prev) => (prev ? { ...prev, ssh: { ...prev.ssh, ...patch } } : prev));
  };

  const needsPassword =
    !config?.isLocal && config?.ssh.auth === "pass" && !config.ssh.hasPassword && !password;

  // The server drops the saved password when the SSH target changes.
  const sshTargetChanged =
    config != null &&
    savedConfig != null &&
    (config.isLocal !== savedConfig.isLocal ||
      (config.ssh.host || config.lanIp) !== (savedConfig.ssh?.host || savedConfig.lanIp) ||
      config.ssh.user !== savedConfig.ssh?.user);

  /** Persist password immediately (host can be offline). */
  const persistPasswordIfEntered = async () => {
    if (!config || !password) return false;
    await setSparkPassword(config.id, password);
    setConfig((prev) =>
      prev
        ? { ...prev, ssh: { ...prev.ssh, hasPassword: true } }
        : prev
    );
    setSavedPasswordNote("encrypted");
    setPassword(""); // clear field — keep as stored secret
    return true;
  };

  const handleTest = async () => {
    if (!config) return;
    if (!config.isLocal && config.ssh.auth === "pass" && !config.ssh.hasPassword && !password) {
      setLocalError("enterPasswordFirst");
      return;
    }
    setTesting(true);
    setTestResult(null);
    setError(null);
    setLocalError(null);
    try {
      // Always store password before testing so a failed SSH still keeps the secret
      if (password) {
        await setSparkPassword(config.id, password);
        setConfig((prev) =>
          prev ? { ...prev, ssh: { ...prev.ssh, hasPassword: true } } : prev
        );
        setSavedPasswordNote("saved");
      }

      // Decide which route to hit. The registered route (`POST /api/sparks/:id/test`)
      // is preferred — it reads the already-stored password from server memory so the
      // secret never transits the wire twice. BUT it tests the *persisted* Spark
      // config, while the user may be staring at a form with unsaved edits (e.g. a
      // new LAN IP). When any host-side field diverges from what's on disk, fall
      // back to the ephemeral test path so we test what the user is actually
      // looking at. Password-only changes do NOT count as dirty: the password was
      // already persisted above via setSparkPassword, so the registered route can
      // read it from memory — sending it again via testSparkConfig would duplicate
      // the wire transit (the exact pattern H7 was written to remove).
      const formDirty =
        !savedConfig ||
        config.lanIp !== savedConfig.lanIp ||
        (config.cx7Ip ?? null) !== (savedConfig.cx7Ip ?? null) ||
        config.isLocal !== savedConfig.isLocal ||
        (config.ssh?.host || config.lanIp) !== (savedConfig.ssh?.host || savedConfig.lanIp) ||
        config.ssh?.user !== savedConfig.ssh?.user ||
        config.ssh?.auth !== savedConfig.ssh?.auth ||
        (config.ssh?.port ?? 22) !== (savedConfig.ssh?.port ?? 22) ||
        (config.kind ?? "spark") !== (savedConfig.kind ?? "spark") ||
        (config.platform ?? "linux") !== (savedConfig.platform ?? "linux") ||
        config.role !== savedConfig.role ||
        Boolean(config.llmMonitoring) !== Boolean(savedConfig.llmMonitoring) ||
        Boolean(config.comfyMonitoring) !== Boolean(savedConfig.comfyMonitoring) ||
        Boolean(config.hermesMonitoring) !== Boolean(savedConfig.hermesMonitoring) ||
        Boolean(config.tailscaleMonitoring) !== Boolean(savedConfig.tailscaleMonitoring) ||
        (config.comfyPort ?? 8188) !== (savedConfig.comfyPort ?? 8188);

      const result = formDirty
        ? await testSparkConfig({
            ...config,
            ssh: {
              ...config.ssh,
              host: config.ssh.host || config.lanIp,
              password,
            },
          })
        : await testSpark(config.id);

      setTestResult(result);
      // Keep it for Save when the SSH target changed (the edit has to resend it).
      if (password && !sshTargetChanged) setPassword("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    if (!config.isLocal && config.ssh.auth === "pass" && (!config.ssh.hasPassword || sshTargetChanged) && !password) {
      setLocalError("passwordRequired");
      return;
    }
    setSaving(true);
    setError(null);
    setLocalError(null);
    try {
      // Save password first so it is never lost if the rest of the update fails
      if (password && !sshTargetChanged) {
        await persistPasswordIfEntered();
      }

      const patch: Partial<SparkConfig> = {
        name: config.name,
        kind: config.kind ?? "spark",
        platform: config.platform ?? "linux",
        lanIp: config.lanIp,
        cx7Ip: config.cx7Ip,
        macAddress: config.macAddress || null,
        isLocal: config.isLocal,
        role,
        workerNode: role === "worker",
        workerLabel: role === "worker" ? (config.workerLabel?.trim() || null) : null,
        workerHeadId: role === "worker" ? (config.workerHeadId?.trim() || null) : null,
        llmMonitoring:
          role === "worker" ? false : role === "head" ? true : config.llmMonitoring !== false,
        comfyMonitoring: Boolean(config.comfyMonitoring),
        comfyPort: (() => {
          const n = Number(config.comfyPort);
          return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 8188;
        })(),
        hermesMonitoring: Boolean(config.hermesMonitoring),
        tailscaleMonitoring: Boolean(config.tailscaleMonitoring),
        ssh: {
          host: config.ssh.host || config.lanIp,
          user: config.ssh.user,
          auth: config.ssh.auth,
          port: (() => {
            const n = Number(config.ssh.port);
            return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 22;
          })(),
          ...(password && sshTargetChanged ? { password } : {}),
        },
      };
      await updateSpark(config.id, patch);
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!config) return;
    const question =
      config.kind === "host"
        ? t("edit.confirmRemoveHost", { name: config.name })
        : t("edit.confirmRemoveSpark", { name: config.name });
    if (!confirm(question)) return;
    setSaving(true);
    setError(null);
    setLocalError(null);
    try {
      await deleteSpark(config.id);
      onDeleted?.(config.id);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className={`modal-overlay${visible ? " is-open" : ""}`}
      {...overlayClose}
    >
      <div
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-spark-title"
      >
        <div className="modal-sheet__header">
          <h2 className="modal-sheet__title" id="edit-spark-title">
            {config?.kind === "host" ? t("edit.titleHost") : t("edit.titleSpark")}
          </h2>
          <button type="button" className="modal-sheet__close" onClick={onClose} aria-label={t("close")}>
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="modal-sheet__body">
          {loading && <p className="text-xs text-muted">{t("loading")}</p>}

          {config && !loading && (
            <div className="space-y-3">
              <div>
                <label className="field-label">{t("unitType.label")}</label>
                <select
                  value={unitTypeOf(config)}
                  onChange={(e) => update(unitTypePatch(e.target.value as UnitType, config))}
                >
                  {UNIT_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{unitTypeLabel(t, o.value)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label">{t("edit.name")}</label>
                <input
                  type="text"
                  value={config.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </div>

              <div>
                <label className="field-label">
                  {config.isLocal
                    ? config.kind === "host"
                      ? t("edit.lanIpOptionalHost")
                      : t("edit.lanIpOptional")
                    : t("lanIpRequired")}
                </label>
                <input
                  type="text"
                  value={config.lanIp}
                  onChange={(e) => update({ lanIp: e.target.value })}
                />
                {config.isLocal && !config.lanIp && (
                  <p className="field-hint">
                    {config.kind === "host" ? t("localHintHost") : t("localHintSpark")}
                  </p>
                )}
              </div>

              {config.kind !== "host" && (
                <div>
                  <label className="field-label">{t("cx7Ip")}</label>
                  <input
                    type="text"
                    value={config.cx7Ip || ""}
                    onChange={(e) => update({ cx7Ip: e.target.value || null })}
                  />
                </div>
              )}

              {config.kind === "host" && (
              <div>
                <label className="field-label">
                  {t("edit.macLabel")}
                </label>
                <input
                  type="text"
                  value={config.macAddress || ""}
                  onChange={(e) => update({ macAddress: e.target.value || null })}
                  placeholder={
                    config.detectedMacAddress
                      ? t("edit.macPlaceholderDetected", { mac: config.detectedMacAddress })
                      : t("edit.macPlaceholder")
                  }
                />
                <p className="field-hint">
                  {config.detectedMacAddress
                    ? t("edit.macHintDetected", { mac: config.detectedMacAddress })
                    : t("edit.macHint")}
                </p>
              </div>
              )}

              {config.platform !== "windows" && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={config.isLocal}
                    onChange={(e) => update({ isLocal: e.target.checked })}
                  />
                  {t("edit.thisHost")}
                </label>
              )}

              <div>
                <label className="field-label field-label--row">
                  <span>{t("edit.role")}</span>
                  <span
                    className="inline-flex shrink-0 cursor-help text-muted hover:text-text"
                    title={t("edit.roleTip")}
                    aria-label={t("edit.roleTipAria")}
                  >
                    <InfoIcon className="h-3.5 w-3.5" />
                  </span>
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as SparkRole)}
                >
                  <option value="head">{t("role.head")}</option>
                  <option value="worker">{t("role.worker")}</option>
                  <option value="standalone">{t("role.standalone")}</option>
                </select>
              </div>

              {role === "standalone" && (
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={config.llmMonitoring !== false}
                    onChange={(e) => update({ llmMonitoring: e.target.checked })}
                    
                  />
                  <span>{t("edit.llmMonitoring")}</span>
                  <span
                    className="inline-flex shrink-0 cursor-help text-muted hover:text-text"
                    title={t("edit.llmMonitoringTip")}
                    aria-label={t("edit.llmMonitoringAria")}
                  >
                    <InfoIcon className="h-3.5 w-3.5" />
                  </span>
                </label>
              )}

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <label className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(config.comfyMonitoring)}
                    onChange={(e) =>
                      update({
                        comfyMonitoring: e.target.checked,
                        comfyPort: config.comfyPort ?? 8188,
                      })
                    }
                    
                  />
                  <span>{t("edit.comfyMonitoring")}</span>
                  <span
                    className="inline-flex shrink-0 cursor-help text-muted hover:text-text"
                    title={t("edit.comfyTip")}
                    aria-label={t("edit.comfyAria")}
                  >
                    <InfoIcon className="h-3.5 w-3.5" />
                  </span>
                </label>
                {/* Compact “port 8188” control on the same row. */}
                <div
                  className={`ml-auto flex items-center gap-1 font-tabular ${
                    config.comfyMonitoring ? "text-text" : "pointer-events-none opacity-40"
                  }`}
                  title={t("edit.comfyPortTitle")}
                >
                  <span className="select-none text-muted" aria-hidden>
                    {t("edit.port")}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    inputMode="numeric"
                    disabled={!config.comfyMonitoring}
                    aria-label={t("edit.comfyPortAria")}
                    value={config.comfyPort ?? 8188}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (Number.isInteger(n) && n >= 1 && n <= 65535) {
                        update({ comfyPort: n });
                      }
                    }}
                    onBlur={() => {
                      const n = Number(config.comfyPort);
                      if (!Number.isInteger(n) || n < 1 || n > 65535) {
                        update({ comfyPort: 8188 });
                      }
                    }}
                    className="w-14 border-0 bg-transparent px-0.5 py-0.5 text-center font-tabular text-xs text-inherit outline-none focus:rounded focus:bg-surface-elevated focus:ring-1 focus:ring-accent disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {config.platform !== "windows" && (
                <>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={Boolean(config.hermesMonitoring)}
                    onChange={(e) => update({ hermesMonitoring: e.target.checked })}
                  
                  />
                  <span>Hermes Agent</span>
                  <span
                    className="inline-flex shrink-0 cursor-help text-muted hover:text-text"
                    title={t("edit.hermesTip")}
                    aria-label={t("edit.hermesAria")}
                  >
                    <InfoIcon className="h-3.5 w-3.5" />
                  </span>
                </label>
                <p className="field-hint">
                  {t("edit.hermesHintBefore")}
                  <code className="rounded bg-surface-elevated px-1">hermes update</code>
                  {t("edit.hermesHintAfter")}
                </p>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <label className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(config.tailscaleMonitoring)}
                      onChange={(e) => update({ tailscaleMonitoring: e.target.checked })}
                    
                    />
                    <span>{t("edit.tailnet")}</span>
                    <span
                      className="inline-flex shrink-0 cursor-help text-muted hover:text-text"
                      title={t("edit.tailnetTip")}
                      aria-label={t("edit.tailnetAria")}
                    >
                      <InfoIcon className="h-3.5 w-3.5" />
                    </span>
                  </label>
                </div>
                </>
              )}

              {role === "worker" && (
                <div className="space-y-3">
                  <div>
                    <label className="field-label">
                      {t("edit.workerLabel")}
                    </label>
                    <input
                      type="text"
                      value={config.workerLabel || ""}
                      onChange={(e) => update({ workerLabel: e.target.value || null })}
                      placeholder={t("edit.workerLabelPlaceholder")}
                    />
                    <p className="field-hint">
                      {t("edit.workerLabelHint")}
                    </p>
                  </div>

                  <div>
                    <label className="field-label">{t("edit.headSpark")}</label>
                    <select
                      value={config.workerHeadId || ""}
                      onChange={(e) => update({ workerHeadId: e.target.value || null })}
                    >
                      <option value="">{t("edit.none")}</option>
                      {config.workerHeadId &&
                        !allSparks.some((s) => s.id === config.workerHeadId) && (
                          <option value={config.workerHeadId}>
                            {t("edit.missingSpark", { id: config.workerHeadId })}
                          </option>
                        )}
                      {allSparks
                        .filter((s) => s.id !== config.id)
                        .map((s) => {
                          const sRole = resolveSparkRole(s);
                          return (
                            <option key={s.id} value={s.id}>
                              {sRole === "head"
                                ? t("edit.headOption", { name: s.name })
                                : sRole === "worker"
                                  ? t("edit.workerOption", { name: s.name })
                                  : s.name}
                            </option>
                          );
                        })}
                    </select>
                    <p className="field-hint">
                      {t("edit.headSparkHint")}
                    </p>
                  </div>
                </div>
              )}

              {!config.isLocal && (
                <>
                  <div>
                    <label className="field-label">{t("sshUser")}</label>
                    <input
                      type="text"
                      value={config.ssh.user}
                      onChange={(e) => updateSsh({ user: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="field-label" htmlFor="edit-spark-ssh-port">
                      {t("sshPort")}
                    </label>
                    <input
                      id="edit-spark-ssh-port"
                      type="number"
                      min={1}
                      max={65535}
                      inputMode="numeric"
                      value={config.ssh.port ?? 22}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        updateSsh({
                          port: Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 22,
                        });
                      }}
                    />
                    <p className="field-hint">{t("edit.sshPortHint")}</p>
                  </div>

                  <div>
                    <label className="field-label">{t("sshAuth")}</label>
                    <select
                      value={config.ssh.auth}
                      onChange={(e) => updateSsh({ auth: e.target.value as "key" | "pass" })}
                    >
                      <option value="key">{t("authKey")}</option>
                      <option value="pass">{t("authPassword")}</option>
                    </select>
                    {config.ssh.auth === "key" && (
                      <p className="field-hint">
                        {t("edit.keyHint")}
                      </p>
                    )}
                  </div>

                  {config.ssh.auth === "pass" && (
                    <div>
                      <label className="field-label">
                        {config.ssh.hasPassword ? t("edit.sshPasswordKeep") : t("edit.sshPasswordRequired")}
                      </label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        placeholder={config.ssh.hasPassword ? "••••••••" : t("edit.enterPassword")}
                      />
                      {config.ssh.hasPassword ? (
                        <p className="field-hint">
                          {t("edit.passwordStored")}
                        </p>
                      ) : (
                        <p className="field-hint is-warn">
                          {t("edit.passwordEnterOnce")}
                        </p>
                      )}
                      {savedPasswordNote && (
                        <p className="field-hint is-ok">
                          {savedPasswordNote === "encrypted" ? t("edit.passwordSavedEncrypted") : t("edit.passwordSaved")}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}

              {sparkId && config.kind !== "host" && config.platform !== "windows" && config.platform !== "darwin" && (
                <GpuClockSection sparkId={sparkId} />
              )}
            </div>
          )}

          {testResult && <TestResultList result={testResult} />}

          {localError && (
            <div className="modal-sheet__error">
              {localError === "notFound"
                ? t("edit.notFound")
                : localError === "enterPasswordFirst"
                  ? t("edit.enterPasswordFirst")
                  : t("edit.passwordRequiredSave")}
            </div>
          )}
          {error && (
            <div className="modal-sheet__error">{error}</div>
          )}
        </div>

        <div className="modal-sheet__footer">
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving || loading || !config}
            className="btn btn--danger"
          >
            {saving ? t("removing") : t("remove")}
          </button>
          <div className="modal-sheet__footer-actions">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || loading || (!config?.isLocal && !config?.lanIp) || needsPassword}
              className="btn"
            >
              {testing ? t("testing") : t("test")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn btn--ghost"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading || !config?.name || (!config?.isLocal && !config?.lanIp) || needsPassword}
              className="btn btn--primary"
            >
              {saving ? t("saving") : t("save")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

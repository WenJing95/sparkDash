import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { fetchAlerts, fetchAlertsConfig, testAlertChannel, updateAlertsConfig, updateSettings } from "../api/client";
import type { AlertChannel, AlertChannelType, AlertEvent, AlertInstance, AlertRule, AlertSeverity, AlertsConfig, Settings } from "../api/types";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useModalPresence } from "../hooks/useModalPresence";
import { formatSince } from "../shared/formatSince";
import { PlusIcon, XIcon } from "./ui/icons";
import { SettingRow, ToggleRow } from "./SettingRows";
import "../styles/dialogs.css";

interface AlertsDialogProps {
  open: boolean;
  onClose: () => void;
  /** The switch was saved: Settings mirrors it without marking itself dirty. */
  onSettingsSaved: (settings: Settings) => void;
}

/** Channel types; the label is a product name, and only the ntfy example URL has words to translate. */
const CHANNEL_TYPES: Array<{ value: AlertChannelType; label: string; placeholder: string | null }> = [
  { value: "ntfy", label: "ntfy", placeholder: null },
  { value: "discord", label: "Discord", placeholder: "https://discord.com/api/webhooks/…" },
  { value: "slack", label: "Slack", placeholder: "https://hooks.slack.com/services/…" },
  { value: "webhook", label: "Webhook (JSON)", placeholder: "https://example.com/hook" },
];

const REPEAT_OPTIONS = [0, 60, 240, 720, 1440];

function repeatLabel(t: TFunction<"alerts">, minutes: number): string {
  if (minutes === 0) return t("repeat.off");
  if (minutes === 60) return t("repeat.hour");
  if (minutes === 240) return t("repeat.hours4");
  if (minutes === 720) return t("repeat.hours12");
  if (minutes === 1440) return t("repeat.day");
  return t("repeat.minutes", { n: minutes });
}

const SOURCES: Array<AlertRule["source"]> = ["strip", "health"];

function sourceTitle(t: TFunction<"alerts">, source: AlertRule["source"]): string {
  return source === "health" ? t("sources.health.title") : t("sources.strip.title");
}

function sourceHelp(t: TFunction<"alerts">, source: AlertRule["source"]): string {
  return source === "health" ? t("sources.health.help") : t("sources.strip.help");
}

/** Editable rule values; `forSec` stays a string so a half-typed number is not clobbered. */
type RuleDraft = { enabled: boolean; forSec: string };
/** `message` is raw text from the server; `local` is the dashboard's own result, translated at render time. */
type TestState = { pending: boolean; ok?: boolean; message?: string; local?: "sent" | "failed" };

function ruleDraft(rule: AlertRule): RuleDraft {
  return {
    enabled: rule.overrides.enabled ?? rule.defaults.enabled,
    forSec: String(rule.overrides.forSec ?? rule.defaults.forSec),
  };
}

/** A rule whose wait is not a number; the dialog shows it in the current language. */
class WaitError extends Error {
  constructor(readonly ruleName: string) {
    super(ruleName);
  }
}

/** Only the values that differ from the rule's defaults are stored. */
function ruleOverrides(rule: AlertRule, draft: RuleDraft): { enabled?: boolean; forSec?: number } {
  const out: { enabled?: boolean; forSec?: number } = {};
  const forSec = Number(draft.forSec);
  if (!Number.isFinite(forSec) || draft.forSec.trim() === "") throw new WaitError(rule.name);
  if (draft.enabled !== rule.defaults.enabled) out.enabled = draft.enabled;
  if (forSec !== rule.defaults.forSec) out.forSec = forSec;
  return out;
}

const severityText = (t: TFunction<"alerts">, s: AlertSeverity) => (s === "critical" ? t("severity.critical") : t("severity.warning"));

export function AlertsDialog({ open, onClose, onSettingsSaved }: AlertsDialogProps) {
  const { t } = useTranslation("alerts");
  const titleId = useId();
  const { mounted, visible } = useModalPresence(open);
  const trapRef = useFocusTrap(mounted);
  const [config, setConfig] = useState<AlertsConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<Record<string, RuleDraft>>({});
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [repeat, setRepeat] = useState(0);
  const [recent, setRecent] = useState<AlertEvent[]>([]);
  const [active, setActive] = useState<AlertInstance[]>([]);
  const [tests, setTests] = useState<Record<number, TestState>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Local validation (a wait that is not a number), kept as data so it follows a language switch. */
  const [waitError, setWaitError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const applyConfig = useCallback((c: AlertsConfig) => {
    setConfig(c);
    setEnabled(c.enabled);
    setRepeat(c.repeatIntervalMin);
    setRules(Object.fromEntries(c.rules.map((r) => [r.id, ruleDraft(r)])));
    setChannels(c.channels.map((ch) => ({ ...ch })));
    setDirty(false);
  }, []);

  const loadStatus = useCallback(() => {
    fetchAlerts()
      .then((s) => {
        setRecent(s.recent);
        setActive(s.active);
        setNow(Date.now());
      })
      .catch(() => {
        /* the lists are a convenience; a config error (if any) is shown */
      });
  }, []);

  useEffect(() => {
    if (!open) {
      setConfig(null);
      setError(null);
      setWaitError(null);
      setTests({});
      setSavedNote(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchAlertsConfig()
      .then((c) => {
        if (!cancelled) applyConfig(c);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    loadStatus();
    return () => {
      cancelled = true;
    };
  }, [open, applyConfig, loadStatus]);

  // Keep "Firing now" and the recent list current while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(loadStatus, 10_000);
    return () => window.clearInterval(timer);
  }, [open, loadStatus]);

  // Capture phase, so the Settings dialog underneath does not close too.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  const touch = () => {
    setDirty(true);
    setSavedNote(false);
    setWaitError(null);
  };

  const toggleEnabled = async () => {
    setToggling(true);
    setError(null);
    try {
      const s = await updateSettings({ alertsEnabled: !enabled });
      setEnabled(Boolean(s.alertsEnabled));
      onSettingsSaved(s);
      loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setToggling(false);
    }
  };

  const setRule = (id: string, patch: Partial<RuleDraft>) => {
    setRules((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    touch();
  };

  const setChannel = (index: number, patch: Partial<AlertChannel>) => {
    setChannels((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    setTests((prev) => ({ ...prev, [index]: { pending: false } }));
    touch();
  };

  const addChannel = () => {
    setChannels((prev) => [...prev, { name: "", type: "ntfy", url: "", enabled: true, minSeverity: "warning" }]);
    touch();
  };

  const removeChannel = (index: number) => {
    setChannels((prev) => prev.filter((_, i) => i !== index));
    setTests({});
    touch();
  };

  const sendTest = async (index: number) => {
    const ch = channels[index];
    setTests((prev) => ({ ...prev, [index]: { pending: true } }));
    try {
      const r = await testAlertChannel(ch.id, { name: ch.name.trim() || "Test", type: ch.type, url: ch.url, enabled: true, minSeverity: ch.minSeverity });
      setTests((prev) => ({
        ...prev,
        [index]: r.ok
          ? { pending: false, ok: true, local: "sent" }
          : r.error
            ? { pending: false, ok: false, message: r.error }
            : { pending: false, ok: false, local: "failed" },
      }));
    } catch (err) {
      setTests((prev) => ({ ...prev, [index]: { pending: false, ok: false, message: err instanceof Error ? err.message : String(err) } }));
    } finally {
      loadStatus();
    }
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setWaitError(null);
    try {
      const ruleUpdate: Record<string, { enabled?: boolean; forSec?: number }> = {};
      for (const rule of config.rules) {
        const o = ruleOverrides(rule, rules[rule.id] ?? ruleDraft(rule));
        if (Object.keys(o).length) ruleUpdate[rule.id] = o;
      }
      const next = await updateAlertsConfig({
        repeatIntervalMin: repeat,
        rules: ruleUpdate,
        channels: channels.map(({ status: _status, hasUrl: _hasUrl, ...c }) => ({ ...c, name: c.name.trim(), url: c.url.trim() })),
      });
      applyConfig(next);
      setTests({});
      setSavedNote(true);
    } catch (err) {
      if (err instanceof WaitError) setWaitError(err.ruleName);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className={`modal-overlay${visible ? " is-open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={trapRef} className="modal-sheet modal-sheet--wide" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-sheet__header">
          <h2 className="modal-sheet__title" id={titleId}>
            {t("title")}
          </h2>
          <button type="button" className="modal-sheet__close" onClick={onClose} aria-label={t("close")}>
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="modal-sheet__body">
          {loading && <p className="bench-sheet__hint">{t("loading")}</p>}

          {config && !loading && (
            <>
              <ToggleRow
                title={t("send.title")}
                help={t("send.help")}
                checked={enabled}
                disabled={toggling}
                onChange={() => void toggleEnabled()}
              />

              {enabled && active.length > 0 && (
                <section className="alerts-section" aria-label={t("firing.title")}>
                  <h3 className="alerts-section__title">{t("firing.heading", { n: active.length })}</h3>
                  <ul className="alerts-list">
                    {active.map((a) => (
                      <li key={a.key} className={a.severity === "critical" ? "is-critical" : "is-warning"}>
                        <b>{a.unitName}</b> {a.label} · {formatSince(a.startsAt, now) ?? t("firing.now")}
                        <small>{a.summary}</small>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {!enabled && <p className="modal-sheet__lead alerts-off-note">{t("offNote")}</p>}

              <fieldset className="alerts-fieldset" disabled={!enabled}>
                {SOURCES.map((source) => (
                  <section key={source} className="alerts-section" aria-label={sourceTitle(t, source)}>
                    <h3 className="alerts-section__title">{sourceTitle(t, source)}</h3>
                    <p className="alerts-section__help">{sourceHelp(t, source)}</p>
                    {config.rules
                      .filter((r) => r.source === source)
                      .map((rule) => {
                        const draft = rules[rule.id] ?? ruleDraft(rule);
                        return (
                          <div key={rule.id} data-rule={rule.id}>
                            <ToggleRow
                              title={rule.name}
                              help={rule.description}
                              label={t("rule.toggle", { name: rule.name })}
                              checked={draft.enabled}
                              onChange={(v) => setRule(rule.id, { enabled: v })}
                            >
                              <label className="alerts-wait">
                                <span>{t("rule.after")}</span>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  aria-label={t("rule.waitAria", { name: rule.name })}
                                  value={draft.forSec}
                                  onChange={(e) => setRule(rule.id, { forSec: e.target.value })}
                                  className="field-input"
                                />
                                <span>s</span>
                              </label>
                            </ToggleRow>
                          </div>
                        );
                      })}
                  </section>
                ))}

                <section className="alerts-section" aria-label={t("channels.title")}>
                  <div className="alerts-section__head">
                    <h3 className="alerts-section__title">{t("channels.title")}</h3>
                    <button type="button" className="btn btn--sm" onClick={addChannel}>
                      <PlusIcon className="h-3.5 w-3.5" />
                      {t("channels.add")}
                    </button>
                  </div>
                  <p className="alerts-section__help">
                    {t("channels.help")}
                  </p>
                  {channels.length === 0 && <p className="alerts-section__help">{t("channels.empty")}</p>}
                  {channels.map((ch, i) => {
                    const meta = CHANNEL_TYPES.find((type) => type.value === ch.type) ?? CHANNEL_TYPES[0];
                    const test = tests[i];
                    return (
                      <div key={ch.id ?? `new-${i}`} className="alerts-channel" data-channel={i}>
                        <div className="alerts-channel__row">
                          <input
                            type="text"
                            aria-label={t("channels.nameAria")}
                            placeholder={t("channels.namePlaceholder")}
                            value={ch.name}
                            maxLength={60}
                            onChange={(e) => setChannel(i, { name: e.target.value })}
                            className="field-input alerts-channel__name"
                          />
                          <select aria-label={t("channels.typeAria")} value={ch.type} onChange={(e) => setChannel(i, { type: e.target.value as AlertChannelType })}>
                            {CHANNEL_TYPES.map((type) => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                          <select aria-label={t("channels.severityAria")} value={ch.minSeverity} onChange={(e) => setChannel(i, { minSeverity: e.target.value as AlertSeverity })}>
                            <option value="warning">{t("channels.warningUp")}</option>
                            <option value="critical">{t("channels.criticalOnly")}</option>
                          </select>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={ch.enabled}
                            aria-label={t("channels.enabledAria", { name: ch.name || i + 1 })}
                            onClick={() => setChannel(i, { enabled: !ch.enabled })}
                            className={`toggle-track relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors${ch.enabled ? " is-on" : ""}`}
                          >
                            <span className={`toggle-dot inline-block h-4 w-4 transform rounded-full shadow transition-transform ${ch.enabled ? "translate-x-4" : "translate-x-0"}`} />
                          </button>
                        </div>
                        <input
                          type="text"
                          aria-label={t("channels.urlAria")}
                          placeholder={meta.placeholder ?? t("channels.ntfyPlaceholder")}
                          value={ch.url}
                          spellCheck={false}
                          autoComplete="off"
                          onChange={(e) => setChannel(i, { url: e.target.value })}
                          className="field-input field-input--mono"
                        />
                        {ch.id && ch.url.includes("…") && <p className="field-hint">{t("channels.urlHidden")}</p>}
                        {ch.id && !ch.url && ch.hasUrl === false && <p className="field-hint is-warn">{t("channels.urlMissing")}</p>}
                        <div className="alerts-channel__actions">
                          <button type="button" className="btn btn--sm" onClick={() => void sendTest(i)} disabled={!ch.url.trim() || test?.pending}>
                            {test?.pending ? t("channels.sending") : t("channels.sendTest")}
                          </button>
                          <button type="button" className="btn btn--sm btn--ghost" onClick={() => removeChannel(i)}>
                            {t("channels.remove")}
                          </button>
                          {test && !test.pending && (test.message || test.local) && (
                            <span role="status" className={`field-hint ${test.ok ? "is-ok" : "is-warn"}`}>
                              {test.message ?? (test.local === "sent" ? t("channels.sent") : t("channels.failed"))}
                            </span>
                          )}
                          {!test?.message && !test?.local && ch.status?.lastError && (
                            <span className="field-hint is-warn" title={ch.status.lastErrorAt ? new Date(ch.status.lastErrorAt).toLocaleString() : undefined}>
                              {t("channels.lastFailed", { error: ch.status.lastError })}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </section>

                <SettingRow title={t("repeat.title")} help={t("repeat.help")} htmlFor="alerts-repeat">
                  <select
                    id="alerts-repeat"
                    value={repeat}
                    onChange={(e) => {
                      setRepeat(Number(e.target.value));
                      touch();
                    }}
                  >
                    {(REPEAT_OPTIONS.includes(repeat) ? REPEAT_OPTIONS : [...REPEAT_OPTIONS, repeat]).map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {repeatLabel(t, minutes)}
                      </option>
                    ))}
                  </select>
                </SettingRow>
              </fieldset>

              <section className="alerts-section" aria-label={t("recent.title")}>
                <h3 className="alerts-section__title">{t("recent.title")}</h3>
                <p className="alerts-section__help">{t("recent.help")}</p>
                {recent.length === 0 ? (
                  <p className="alerts-section__help">{t("recent.empty")}</p>
                ) : (
                  <ul className="alerts-list">
                    {recent.slice(0, 50).map((e) => (
                      <li key={e.id} className={e.status === "resolved" ? "is-ok" : e.severity === "critical" ? "is-critical" : "is-warning"}>
                        {e.status === "resolved" ? t("recent.resolved") : severityText(t, e.severity)} · <b>{e.unitName}</b> {e.label} · {t("recent.ago", { since: formatSince(e.at, now) ?? "—" })}
                        <small>{e.summary}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>

        {waitError !== null && (
          <div className="modal-sheet__error alerts-error" role="alert">
            {t("waitNotNumber", { name: waitError })}
          </div>
        )}
        {error && (
          <div className="modal-sheet__error alerts-error" role="alert">
            {error}
          </div>
        )}

        <div className="modal-sheet__footer">
          <span className="field-hint" role="status">
            {savedNote ? t("saved") : dirty ? t("unsaved") : ""}
          </span>
          <div className="modal-sheet__footer-actions">
            <button type="button" onClick={onClose} className="btn btn--ghost">
              {t("close")}
            </button>
            <button type="button" onClick={() => void save()} disabled={!config || !enabled || saving || !dirty} className="btn btn--primary">
              {saving ? t("saving") : t("save")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

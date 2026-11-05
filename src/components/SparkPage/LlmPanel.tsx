import { benchId } from "../../constants";
import { BenchIcon } from "../bench/BenchIcon";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ConversationRow, LlmMetrics, LlmBenchTarget } from "../../api/types";
import { setLlmApiKey, updateLlmPort, updateLlmPorts } from "../../api/client";
import { TrendLine } from "../ui/TrendLine";
import { Panel } from "../ui/Panel";
import { Tag, type TagTone } from "../ui/Tag";
import { BotIcon, ExpandIcon, FlaskIcon, GearIcon, InfoIcon, ServerIcon } from "../ui/icons";
import {
  useMetricsHistory,
  useMetricsHistoryTail,
  avgPositive,
} from "../../hooks/metricsStore";
import { BenchmarkDialog } from "./BenchmarkDialog";
import { PrefillBenchDialog } from "./PrefillBenchDialog";
import { QualityBenchDialog } from "./QualityBenchDialog";
import { LlmDailyChart } from "./LlmDailyChart";
import { LlmTokenTotals } from "./LlmTokenTotals";
import { parseLlmTargetInput } from "../../shared/llmTarget.js";
import { llmTargetErrorText } from "../../shared/llmTargetText";
import { backendLabel } from "../../shared/llmBackends.js";
import { LlmTrendChart } from "./LlmTrendChart";
import type { BenchKind } from "./BenchSwitcher";
import { engineStateLabel } from "./llmEngineState";
import { isLlmIdle } from "../../shared/llmIdle";
import { formatSince } from "../../shared/formatSince";
import { measuredGenerationTps } from "../../shared/llmRate";
import { ConversationList } from "./ConversationList";

interface LlmPanelProps {
  llm: LlmMetrics | null;
  sparkId: string;
  /** Unit display name — lands on the benchmark share card. */
  sparkName?: string;
  llmPort: number;
  llmPorts?: number[];
  hasApiKey?: boolean;
  /** Show "Copy image" in the benchmark dialogs (Settings, off by default). */
  shareImage?: boolean;
  onRemovePort?: (port: number) => void;
  className?: string;
  conversations?: ConversationRow[];
  onAddHarness?: () => void;
}

type MetricInfoId = "kvCache" | "requests" | "ttftMean" | "ttftP95" | "preempts" | "prefixCache" | "e2eP95" | "itlP95" | "mtpAccept";

function metricInfo(id: MetricInfoId, t: TFunction<"llm">): string {
  switch (id) {
    case "kvCache": return t("metricInfo.kvCache");
    case "requests": return t("metricInfo.requests");
    case "ttftMean": return t("metricInfo.ttftMean");
    case "ttftP95": return t("metricInfo.ttftP95");
    case "preempts": return t("metricInfo.preempts");
    case "prefixCache": return t("metricInfo.prefixCache");
    case "e2eP95": return t("metricInfo.e2eP95");
    case "itlP95": return t("metricInfo.itlP95");
    case "mtpAccept": return t("metricInfo.mtpAccept");
  }
}

/** Panel save errors written here stay codes so they follow the language; server errors are shown as sent. */
type SaveError = { code: "portRange" } | { code: "portTaken"; port: number } | { code: "saveFailed" } | { raw: string };

/** Compact token counts for the KV pool tile (883552 → 884k). */
function formatKvTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const v = Math.round((n / 1_000_000) * 10) / 10;
    return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (abs >= 1000) {
    const v = abs >= 10_000 ? Math.round(n / 1000) : Math.round((n / 1000) * 10) / 10;
    return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}k`;
  }
  return Math.round(n).toLocaleString();
}

function formatKvBytes(n: number): string {
  const gib = n / 1024 ** 3;
  if (gib >= 10) return `${Math.round(gib)} GB`;
  if (gib >= 1) {
    const v = Math.round(gib * 10) / 10;
    return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)} GB`;
  }
  return `${Math.round(n / 1024 ** 2)} MB`;
}

const REMOTE_STORAGE_KEY = "sparkdash.remote-bench-target";

function readStoredRemote(): { host: string; port: string; tls: boolean } {
  try {
    const raw = localStorage.getItem(REMOTE_STORAGE_KEY);
    if (!raw) return { host: "", port: "443", tls: true };
    const v = JSON.parse(raw) as { host?: string; port?: number; tls?: boolean };
    return {
      host: typeof v.host === "string" ? v.host : "",
      port: v.port != null ? String(v.port) : "443",
      tls: v.tls !== false,
    };
  } catch {
    return { host: "", port: "443", tls: true };
  }
}

/** Decode / Prefill / Quality / Showcase launchers — shown even when the live probe is empty
 *  (remote loopback-bound servers can still be benched via SSH tunnel). */
function LlmLaunchers({
  sparkId,
  llmPort,
  modelId,
  onLaunch,
  onRemoteLaunch,
}: {
  sparkId: string;
  llmPort: number;
  modelId?: string | null;
  onLaunch: (kind: BenchKind) => void;
  onRemoteLaunch: (kind: BenchKind, target: LlmBenchTarget) => void;
}) {
  const { t } = useTranslation("llm");
  const { t: tc } = useTranslation("common");
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [hostDraft, setHostDraft] = useState(() => readStoredRemote().host);
  const [portDraft, setPortDraft] = useState(() => readStoredRemote().port);
  const [tls, setTls] = useState(() => readStoredRemote().tls);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const persist = (target: LlmBenchTarget) => {
    try {
      localStorage.setItem(REMOTE_STORAGE_KEY, JSON.stringify(target));
    } catch {
      /* ignore */
    }
  };

  const applyHostBlur = () => {
    if (!hostDraft.trim()) return;
    try {
      const p = parseLlmTargetInput(hostDraft, portDraft, tls);
      setHostDraft(p.host);
      setPortDraft(String(p.port));
      setTls(p.tls);
      setRemoteError(null);
    } catch {
      /* leave as typed until Run */
    }
  };

  const launchRemote = (kind: BenchKind) => {
    try {
      const p = parseLlmTargetInput(hostDraft, portDraft, tls);
      persist(p);
      setHostDraft(p.host);
      setPortDraft(String(p.port));
      setTls(p.tls);
      setRemoteError(null);
      onRemoteLaunch(kind, p);
    } catch (err: unknown) {
      setRemoteError(err instanceof Error ? err.message : String(err));
    }
  };

  const localHint = t("launchers.localHint");

  return (
    <div className="sp-launchers">
      <div className="sp-btns">
        {(
          [
            ["decode", t("launchers.decode"), t("launchers.decodeTitle", { hint: localHint })],
            ["prefill", t("launchers.prefill"), t("launchers.prefillTitle", { hint: localHint })],
            ["quality", t("launchers.quality"), t("launchers.qualityTitle")],
            ["tool-eval", t("launchers.toolEval"), t("launchers.toolEvalTitle")],
          ] as const
        ).map(([type, label, title]) => (
          <button
            key={type}
            type="button"
            // Opens the benchmark's own page, already set to this Spark.
            onClick={() => window.dispatchEvent(new CustomEvent("sparkdash:navigate", { detail: { id: benchId(type), spark: sparkId } }))}
            className="btn btn--sm"
            title={title}
          >
            <BenchIcon id={type} className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            const params = new URLSearchParams();
            if (llmPort) params.set("port", String(llmPort));
            if (modelId) params.set("model", modelId);
            const q = params.toString() ? `?${params.toString()}` : "";
            window.open(`/showcase/${encodeURIComponent(sparkId)}${q}`, "_blank", "noopener,noreferrer");
          }}
          className="btn btn--sm"
        >
          <ExpandIcon className="h-3.5 w-3.5" />
          {t("launchers.showcase")}
        </button>
        <button
          type="button"
          onClick={() => {
            setRemoteOpen((v) => !v);
            setRemoteError(null);
          }}
          className={`btn btn--sm btn--ghost sp-btns__end ${remoteOpen ? "is-on" : ""}`}
          aria-expanded={remoteOpen}
          title={t("launchers.remoteTitle")}
        >
          <ServerIcon className="h-3.5 w-3.5" />
          {t("launchers.remote")}
        </button>
      </div>
      {remoteOpen && (
        <div className="sp-remote">
          <p className="sp-hint">
            {t("launchers.remoteHint")}
          </p>
          <label className="sp-field">
            <span className="eyebrow">{t("launchers.host")}</span>
            <input
              type="text"
              value={hostDraft}
              onChange={(e) => setHostDraft(e.target.value)}
              onBlur={applyHostBlur}
              placeholder="https://name.tailxxxxx.ts.net/v1/models"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="sp-input"
            />
          </label>
          <div className="sp-field-row">
            <label className="sp-field sp-field--grow">
              <span className="eyebrow">{t("launchers.port")}</span>
              <input
                type="number"
                min={1}
                max={65535}
                inputMode="numeric"
                value={portDraft}
                onChange={(e) => setPortDraft(e.target.value)}
                className="sp-input"
              />
            </label>
            <label className="sp-check">
              <input
                type="checkbox"
                checked={tls}
                onChange={(e) => {
                  const next = e.target.checked;
                  setTls(next);
                  if (next && portDraft === "8888") setPortDraft("443");
                  if (!next && portDraft === "443") setPortDraft("8888");
                }}
              />
              HTTPS
            </label>
          </div>
          {remoteError && <p className="sp-error">{llmTargetErrorText(tc, remoteError)}</p>}
          <div className="sp-btns">
            <button type="button" onClick={() => launchRemote("decode")} className="btn btn--sm">
              {t("launchers.decode")}
            </button>
            <button type="button" onClick={() => launchRemote("prefill")} className="btn btn--sm">
              {t("launchers.prefill")}
            </button>
            <button type="button" onClick={() => launchRemote("quality")} className="btn btn--sm">
              {t("launchers.quality")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const POSTURE_TONE: Record<NonNullable<LlmMetrics["posture"]>["level"], TagTone> = {
  ok: "good",
  warn: "warn",
  danger: "bad",
};

/** Exposure / auth posture from the unauthenticated probe (issue #17). */
function PostureBadge({ posture }: { posture: NonNullable<LlmMetrics["posture"]> }) {
  return (
    <Tag tone={POSTURE_TONE[posture.level]} title={posture.detail}>
      {posture.label}
    </Tag>
  );
}

/** Small (i) next to a metric label; one open tooltip at a time. */
function MetricInfoTip({
  id,
  label,
  text,
  openId,
  setOpenId,
  /** Anchor tooltip to the right so edge columns don’t clip off-screen */
  align = "left",
}: {
  id: string;
  label: string;
  text: string;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  align?: "left" | "right";
}) {
  const { t } = useTranslation("llm");
  const open = openId === id;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => setOpenId(null), 2000);
  }, [clearTimer, setOpenId]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return (
    <div className="sp-tile__label">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => {
          if (open) {
            clearTimer();
            setOpenId(null);
          } else {
            setOpenId(id);
            scheduleClose();
          }
        }}
        onMouseEnter={() => {
          clearTimer();
          setOpenId(id);
        }}
        onMouseLeave={scheduleClose}
        className="relative cursor-pointer opacity-60 hover:opacity-100"
        aria-label={t("panel.infoAria", { label })}
      >
        <InfoIcon className="h-2.5 w-2.5" />
        {open && (
          <div
            onMouseEnter={clearTimer}
            onMouseLeave={scheduleClose}
            className={`absolute top-full z-20 mt-1 w-52 max-w-[min(13rem,calc(100vw-1.5rem))] rounded-xl border border-border-strong bg-surface-elevated px-3 py-2 text-left text-[11px] font-normal normal-case leading-snug text-text shadow-lg ${
              align === "right" ? "right-0 left-auto" : "left-0 right-auto"
            }`}
          >
            {text}
          </div>
        )}
      </button>
    </div>
  );
}

export function LlmPanel({
  llm,
  sparkId,
  sparkName,
  llmPort,
  llmPorts,
  hasApiKey = false,
  shareImage = false,
  onRemovePort,
  className,
  conversations = [],
  onAddHarness,
}: LlmPanelProps) {
  const { t } = useTranslation("llm");
  // Tail keyed by port so multi-port LLM sparklines stay distinct (8b).
  const genHistory = useMetricsHistoryTail(sparkId, `llm:${llmPort}.tps`);
  const prefillHistory = useMetricsHistoryTail(sparkId, `llm:${llmPort}.prefill`);
  const cachedPrefillHistory = useMetricsHistoryTail(sparkId, `llm:${llmPort}.prefillCached`);
  const uncachedPrefillHistory = useMetricsHistoryTail(sparkId, `llm:${llmPort}.prefillUncached`);

  // Full series (~1 h) for running averages over busy (>0) samples only.
  const genFull = useMetricsHistory(sparkId, `llm:${llmPort}.tps`);
  const prefillFull = useMetricsHistory(sparkId, `llm:${llmPort}.prefill`);
  const cachedFull = useMetricsHistory(sparkId, `llm:${llmPort}.prefillCached`);
  const uncachedFull = useMetricsHistory(sparkId, `llm:${llmPort}.prefillUncached`);
  const genAvg = useMemo(() => avgPositive(genFull), [genFull]);
  const prefillAvg = useMemo(() => avgPositive(prefillFull), [prefillFull]);
  const cachedPrefillAvg = useMemo(() => avgPositive(cachedFull), [cachedFull]);
  const uncachedPrefillAvg = useMemo(() => avgPositive(uncachedFull), [uncachedFull]);
  const [showSettings, setShowSettings] = useState(false);
  const [portDraft, setPortDraft] = useState(String(llmPort));
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [engineInfoOpen, setEngineInfoOpen] = useState(false);
  const [openBench, setOpenBench] = useState<BenchKind | null>(null);
  const [remoteTarget, setRemoteTarget] = useState<LlmBenchTarget | null>(null);
  const launchLocal = useCallback((kind: BenchKind) => {
    setRemoteTarget(null);
    setOpenBench(kind);
  }, []);
  const launchRemote = useCallback((kind: BenchKind, target: LlmBenchTarget) => {
    setRemoteTarget(target);
    setOpenBench(kind);
  }, []);
  /** Which vLLM metric info tip is open (kvCache | requests | ttftP95 | preempts). */
  const [metricInfoId, setMetricInfoId] = useState<string | null>(null);
  const engineInfoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearEngineInfoTimer = useCallback(() => {
    if (engineInfoTimer.current != null) {
      clearTimeout(engineInfoTimer.current);
      engineInfoTimer.current = null;
    }
  }, []);

  const startEngineInfoTimer = useCallback(() => {
    clearEngineInfoTimer();
    engineInfoTimer.current = setTimeout(() => setEngineInfoOpen(false), 2000);
  }, [clearEngineInfoTimer]);

  const generationTps = llm?.generationTps ?? 0;
  const prefillTps = llm?.prefillTps ?? 0;
  const isStrata = llm?.backend === "strata";
  const isTensorFold = llm?.backend === "tensorfold";
  const completedPrefill = llm?.prefillTpsSource?.startsWith("completed-") === true;
  const showPrefillSplit = llm?.cachedPrefillTps != null || llm?.uncachedPrefillTps != null;
  const cachedPrefillTps = llm?.cachedPrefillTps ?? 0;
  const uncachedPrefillTps = llm?.uncachedPrefillTps ?? 0;
  const available = llm?.available ?? false;
  // The endpoint answered but its stats could not be read: show no rate rather than 0.
  const measured = llm?.measurementValid !== false;
  // While nothing is flowing, say when the endpoint last served.
  const idleSince = formatSince(llm?.lastActiveAt);
  const idleNote = available && measured && isLlmIdle({ generationTps, prefillTps, prefillActive: llm?.prefillActive, decodeActive: llm?.decodeActive })
    ? idleSince ? t("panel.idleSince", { since: idleSince }) : t("panel.idle")
    : null;

  // Keep draft in sync when server pushes a different port (other tab / reload)
  useEffect(() => {
    if (!showSettings) {
      setPortDraft(String(llmPort));
      setApiKeyDraft("");
      setClearApiKey(false);
    }
  }, [llmPort, showSettings]);

  const parsedPort = (() => {
    const n = parseInt(portDraft, 10);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
    return n;
  })();

  const portDirty = parsedPort !== null && parsedPort !== llmPort;
  const portInvalid = portDraft.trim() !== "" && parsedPort === null;
  const apiKeyDirty = apiKeyDraft.trim() !== "" || clearApiKey;
  const settingsDirty = portDirty || apiKeyDirty;

  const handleSaveSettings = async () => {
    if (parsedPort === null) {
      setSaveError({ code: "portRange" });
      return;
    }
    if (!settingsDirty) {
      setShowSettings(false);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (portDirty) {
        const currentPorts =
          Array.isArray(llmPorts) && llmPorts.length > 0 ? llmPorts : [llmPort];
        if (currentPorts.includes(parsedPort) && parsedPort !== llmPort) {
          setSaveError({ code: "portTaken", port: parsedPort });
          setSaving(false);
          return;
        }
        // Rename this panel's port in-place so sibling ports (and their keys) survive
        if (currentPorts.length > 1) {
          const next = currentPorts.map((p) => (p === llmPort ? parsedPort : p));
          await updateLlmPorts(sparkId, next);
        } else {
          await updateLlmPort(sparkId, parsedPort);
        }
      }
      const keyPort = parsedPort;
      if (clearApiKey) {
        await setLlmApiKey(sparkId, keyPort, "");
      } else if (apiKeyDraft.trim() !== "") {
        await setLlmApiKey(sparkId, keyPort, apiKeyDraft.trim());
      }
      setApiKeyDraft("");
      setClearApiKey(false);
      setShowSettings(false);
    } catch (err) {
      setSaveError(err instanceof Error ? { raw: err.message } : { code: "saveFailed" });
    } finally {
      setSaving(false);
    }
  };

  const fmtTps = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(1));
  const fmtAvg = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));
  const isVllm = llm != null && (llm.backend === "vllm" || llm.backend === "q27" || llm.backend === "radiance" || llm.backend === "flare" || llm.backend === "locals" || llm.backend === "splash");
  // FreeToken reports KV use, active requests and a TTFT mean in /v1/stats; the tiles below are null-gated.
  const isFreeToken = llm?.backend === "freetoken";
  const showEngineTiles = isVllm || isFreeToken || isStrata;
  const kvTone =
    llm?.kvCacheUsage == null
      ? ""
      : llm.kvCacheUsage >= 0.8
        ? "text-danger"
        : llm.kvCacheUsage >= 0.5
          ? "text-warning"
          : "text-success";
  const contextLabel = llm?.contextLength
    ? t("panel.ctx", { size: llm.contextLength >= 1000 ? `${Math.round(llm.contextLength / 1024)}k` : String(llm.contextLength) })
    : null;
  const backend = backendLabel(llm?.backend ?? null);

  const tile = (id: MetricInfoId, label: string, value: string, opts?: { tone?: string; sub?: string; align?: "left" | "right" }) => (
    <div className="sp-tile" key={id}>
      <b className={opts?.tone ?? ""}>{value}</b>
      <MetricInfoTip
        id={id}
        label={label}
        text={metricInfo(id, t)}
        openId={metricInfoId}
        setOpenId={setMetricInfoId}
        align={opts?.align}
      />
      {opts?.sub && <small>{opts.sub}</small>}
    </div>
  );

  const kvValue =
    llm?.kvCacheUsage != null
      ? `${(llm.kvCacheUsage * 100).toFixed(0)}%`
      : llm?.kvCacheTokensAvailable != null
        ? t("tiles.kvFree", { tokens: formatKvTokens(llm.kvCacheTokensAvailable) })
        : llm?.kvCacheTokens != null
          ? formatKvTokens(llm.kvCacheTokens)
          : null;
  const kvSub = [
    llm?.kvCacheUsage != null && llm?.kvCacheTokensAvailable != null
      ? t("tiles.kvFree", { tokens: formatKvTokens(llm.kvCacheTokensAvailable) })
      : null,
    llm?.kvCacheTokens != null ? t("tiles.kvPool", { tokens: formatKvTokens(llm.kvCacheTokens) }) : null,
    llm?.kvCacheMemoryBytes != null ? formatKvBytes(llm.kvCacheMemoryBytes) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Panel
      title={t("panel.title")}
      accent={available}
      icon={<BotIcon />}
      className={`panel-llm ${className ?? ""}`}
      bodyClassName="sp-stack"
      actions={
        <div className="sp-actions">
          {available && backend && (
            <>
              {llm?.via === "ssh-tunnel" && (
                <Tag title={t("panel.viaSshTitle")}>
                  {t("panel.viaSsh")}
                </Tag>
              )}
              <Tag
                tone="info"
                title={
                  llm?.engineVersion
                    ? t("panel.backendVersionTitle", { backend, version: llm.engineVersion })
                    : t("panel.backendTitle", { backend })
                }
              >
                {backend} · :{llmPort}
                {llm?.engineVersion ? ` · v${llm.engineVersion}` : ""}
              </Tag>
            </>
          )}
          {onRemovePort && (
            <button
              type="button"
              title={t("panel.removePortTitle", { port: llmPort })}
              onClick={() => onRemovePort(llmPort)}
              className="btn btn--sm btn--danger"
            >
              <span aria-hidden>×</span>
              <span>{t("panel.remove")}</span>
            </button>
          )}
          <button
            type="button"
            title={showSettings ? t("panel.done") : t("panel.settingsTitle")}
            onClick={() => {
              if (showSettings) {
                setPortDraft(String(llmPort));
                setApiKeyDraft("");
                setClearApiKey(false);
                setSaveError(null);
              }
              setShowSettings(!showSettings);
            }}
            disabled={saving}
            className={`btn btn--sm btn--ghost ${showSettings ? "is-on" : ""}`}
          >
            <GearIcon />
            <span>{showSettings ? t("panel.done") : t("panel.settings")}</span>
          </button>
        </div>
      }
    >
      {showSettings ? (
        <div className="sp-stack">
          <p className="sp-hint">
            {t("settings.hint")}
          </p>
          <label className="sp-field">
            <span className="eyebrow">{t("settings.port")}</span>
            <input
              type="number"
              min={1}
              max={65535}
              inputMode="numeric"
              value={portDraft}
              onChange={(e) => {
                setPortDraft(e.target.value);
                setSaveError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSaveSettings();
                }
              }}
              className="sp-input"
            />
          </label>
          <div className="sp-btns" role="group" aria-label={t("settings.presetsAria")}>
            <span className="eyebrow">{t("settings.presets")}</span>
            <button
              type="button"
              title={t("settings.presetLmStudioTitle")}
              onClick={() => setPortDraft("1234")}
              className="btn btn--sm"
            >
              LM Studio :1234
            </button>
            <button
              type="button"
              title={t("settings.presetOllamaTitle")}
              onClick={() => setPortDraft("11434")}
              className="btn btn--sm"
            >
              Ollama :11434
            </button>
            <button
              type="button"
              title={t("settings.presetTensorFoldTitle")}
              onClick={() => setPortDraft("8888")}
              className="btn btn--sm"
            >
              TensorFold :8888
            </button>
          </div>
          <label className="sp-field">
            <span className="eyebrow">{t("settings.apiKey")}</span>
            <input
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={apiKeyDraft}
              disabled={clearApiKey}
              placeholder={hasApiKey && !clearApiKey ? t("settings.apiKeySaved") : t("settings.apiKeyPlaceholder")}
              onChange={(e) => {
                setApiKeyDraft(e.target.value);
                setClearApiKey(false);
                setSaveError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSaveSettings();
                }
              }}
              className="sp-input"
            />
          </label>
          {hasApiKey && (
            <label className="sp-check">
              <input
                type="checkbox"
                checked={clearApiKey}
                onChange={(e) => {
                  setClearApiKey(e.target.checked);
                  if (e.target.checked) setApiKeyDraft("");
                  setSaveError(null);
                }}
              />
              {t("settings.clearApiKey")}
            </label>
          )}
          {portInvalid && <p className="sp-error">{t("settings.portInvalid")}</p>}
          {saveError && (
            <p className="sp-error">
              {"raw" in saveError
                ? saveError.raw
                : saveError.code === "portTaken"
                  ? t("settings.portTaken", { port: saveError.port })
                  : saveError.code === "portRange"
                    ? t("settings.portRange")
                    : t("settings.saveFailed")}
            </p>
          )}
          <div className="sp-btns sp-btns--end">
            <button
              type="button"
              onClick={() => {
                setPortDraft(String(llmPort));
                setApiKeyDraft("");
                setClearApiKey(false);
                setSaveError(null);
                setShowSettings(false);
              }}
              disabled={saving}
              className="btn btn--sm"
            >
              {t("settings.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void handleSaveSettings()}
              disabled={saving || portInvalid || !settingsDirty}
              className="btn btn--sm btn--primary"
            >
              {saving ? t("settings.saving") : t("settings.save")}
            </button>
          </div>
        </div>
      ) : !available ? (
        <div className="sp-stack">
          <div className="sp-chips">
            {llm?.posture ? <PostureBadge posture={llm.posture} /> : <span className="sdot sdot--off" />}
            <p className="sp-muted">
              {llm?.posture?.auth === "protected"
                ? t("panel.postureOnPort", { label: llm.posture.label, port: llmPort })
                : t("panel.noModel", { port: llmPort })}
            </p>
          </div>
          <LlmLaunchers
            sparkId={sparkId}
            llmPort={llmPort}
            modelId={llm?.modelId}
            onLaunch={launchLocal}
            onRemoteLaunch={launchRemote}
          />
          <LlmDailyChart sparkId={sparkId} llmPort={llmPort} />
          <LlmTokenTotals sparkId={sparkId} llmPort={llmPort} />
        </div>
      ) : (
        <div className="sp-stack">
          <div className="sp-model">
            <div className="eyebrow">
              <span>{t("panel.model")}</span>
              {contextLabel && <span>{contextLabel}</span>}
            </div>
            <code title={llm?.modelId ?? undefined}>{llm?.modelId ?? "—"}</code>
            {llm?.modelPath && llm.modelPath !== llm.modelId && !llm.modelPath.includes("models--") && (
              <small title={llm.modelPath}>{llm.modelPath}</small>
            )}
          </div>

          <div className="sp-decode">
            <div
              className="sp-metric"
              title={
                isStrata
                  ? t("panel.decodeStrataTitle")
                  : undefined
              }
            >
              <span className="eyebrow">{isTensorFold ? t("panel.decodeAggregate") : t("panel.decode")}</span>
              <div className="big-num sp-big-lg">
                {!measured ? (
                  <span title={llm?.measurementError ?? undefined}>—</span>
                ) : isStrata && llm?.decodeActive && generationTps <= 0 ? (
                  <>
                    <span className="ov-tps__dots" aria-hidden />
                    <small>{t("panel.decoding")}</small>
                  </>
                ) : (
                  <>
                    {fmtTps(generationTps)}
                    <small>tok/s</small>
                  </>
                )}
              </div>
              <TrendLine data={genHistory} height={44} color="var(--color-accent)" />
              {genAvg != null && <span className="sp-avg mono">{t("panel.avg", { value: fmtAvg(genAvg) })}</span>}
              {isStrata && llm?.generationTpsSource === "slot-mean" && <span className="sp-avg">{t("panel.activeSlotMean")}</span>}
              {measured && llm?.perStreamTps != null && (
                <span
                  className="sp-avg mono"
                  title={isTensorFold
                    ? t("panel.perStreamTensorFoldTitle")
                    : t("panel.perStreamTitle")}
                >
                  {isTensorFold
                    ? t("panel.perStreamLastCompletions", { tps: fmtTps(llm.perStreamTps) })
                    : t("panel.perStream", { tps: fmtTps(llm.perStreamTps) })}
                </span>
              )}
              {!measured && (
                <span className="sp-avg" title={t("panel.notMeasuredTitle")}>
                  {t("panel.notMeasured", { reason: llm?.measurementError ?? t("panel.unknown") })}
                </span>
              )}
              {idleNote && (
                <span className="sp-avg" data-llm-idle>
                  {idleNote}
                </span>
              )}
            </div>
            <div
              className="sp-metric"
              title={
                isStrata
                  ? t("panel.prefillStrataTitle")
                  : llm?.backend === "tensorfold" && llm.uncachedPrefillTps != null
                    ? t("panel.prefillTensorFoldTitle")
                    : t("panel.prefillTitle")
              }
            >
              <span className="eyebrow">{completedPrefill ? t("panel.prefillLastCompleted") : t("panel.prefill")}</span>
              <div className="big-num sp-big-lg">
                {!measured ? (
                  <span title={llm?.measurementError ?? undefined}>—</span>
                ) : llm?.prefillActive && prefillTps <= 0 ? (
                  <>
                    <span className="ov-tps__dots" aria-hidden />
                    <small title={isStrata ? t("panel.prefillingStrataTitle") : t("panel.prefillingTitle")}>{t("panel.prefilling")}</small>
                  </>
                ) : isTensorFold && prefillTps <= 0 && !completedPrefill ? (
                  <span title={t("panel.noPrefillMeasurementTitle")}>—</span>
                ) : (
                  <>
                    {fmtTps(prefillTps)}
                    <small>tok/s</small>
                  </>
                )}
              </div>
              <TrendLine data={prefillHistory} height={44} color="var(--color-info)" />
              {prefillAvg != null && <span className="sp-avg mono">{t("panel.avg", { value: fmtAvg(prefillAvg) })}</span>}
              {isStrata && prefillTps > 0 && <span className="sp-avg">{t("panel.lastReportedMean")}</span>}
              {isTensorFold && !completedPrefill && prefillTps <= 0 && <span className="sp-avg">{t("panel.notMeasuredLive")}</span>}
              {measured && completedPrefill && (
                <span className="sp-avg" title={t("panel.effectiveRateTitle")}>
                  {t("panel.effectiveRate")}
                </span>
              )}
            </div>
          </div>
          {showPrefillSplit && (
            <div className="sp-decode sp-decode--split">
              <div
                className="sp-metric"
                title={t("panel.cachedPrefillTitle")}
              >
                <span className="eyebrow">{t("panel.cachedPrefill")}</span>
                <div className="big-num sp-big-md">
                  {fmtTps(cachedPrefillTps)}
                  <small>tok/s</small>
                </div>
                <TrendLine data={cachedPrefillHistory} height={30} color="var(--color-muted)" />
                {cachedPrefillAvg != null && <span className="sp-avg mono">{t("panel.avg", { value: fmtAvg(cachedPrefillAvg) })}</span>}
              </div>
              <div
                className="sp-metric"
                title={t("panel.uncachedPrefillTitle")}
              >
                <span className="eyebrow">{t("panel.uncachedPrefill")}</span>
                <div className="big-num sp-big-md">
                  {fmtTps(uncachedPrefillTps)}
                  <small>tok/s</small>
                </div>
                <TrendLine data={uncachedPrefillHistory} height={30} color="var(--color-violet)" />
                {uncachedPrefillAvg != null && <span className="sp-avg mono">{t("panel.avg", { value: fmtAvg(uncachedPrefillAvg) })}</span>}
              </div>
            </div>
          )}

          <div className="sp-tiles">
            {showEngineTiles && kvValue != null && tile("kvCache", t("tiles.kvCache"), kvValue, { tone: kvTone, sub: kvSub || undefined })}
            {showEngineTiles &&
              llm?.requestsRunning != null &&
              tile(
                "requests",
                t("tiles.requests"),
                `${Math.round(llm.requestsRunning)} / ${llm.requestsWaiting != null ? Math.round(llm.requestsWaiting) : "—"}`,
                { align: "right" }
              )}
            {isFreeToken && llm?.ttftSeconds != null && tile("ttftMean", t("tiles.ttftMean"), `${Math.round(llm.ttftSeconds * 1000)} ms`)}
            {showEngineTiles && llm?.ttftP95Seconds != null && tile("ttftP95", t("tiles.ttftP95"), `${Math.round(llm.ttftP95Seconds * 1000)} ms`)}
            {showEngineTiles &&
              llm?.preemptionsTotal != null &&
              tile("preempts", t("tiles.preempts"), Math.round(llm.preemptionsTotal).toLocaleString(), { align: "right" })}
            {showEngineTiles &&
              llm?.prefixCacheHitRate != null &&
              tile("prefixCache", t("tiles.prefixCache"), `${(llm.prefixCacheHitRate * 100).toFixed(0)}%`)}
            {showEngineTiles && llm?.e2eP95Seconds != null && tile("e2eP95", t("tiles.e2eP95"), `${llm.e2eP95Seconds.toFixed(2)}s`, { align: "right" })}
            {showEngineTiles && llm?.itlP95Seconds != null && tile("itlP95", t("tiles.itlP95"), `${Math.round(llm.itlP95Seconds * 1000)} ms`)}
            {showEngineTiles &&
              llm?.mtpAcceptanceRate != null &&
              tile("mtpAccept", t("tiles.mtpAccept"), llm.mtpAcceptanceRate.toFixed(2), { align: "right" })}
            <div className="sp-tile">
              <b>
                {(llm?.slotsTotal ?? 0) > 0
                  ? `${llm?.slotsActive ?? "?"} / ${llm?.slotsTotal ?? 0}`
                  : (llm?.slotsActive ?? 0) > 0
                    ? t("panel.slotsRunning", { n: llm?.slotsActive })
                    : "—"}
              </b>
              <span>{t("panel.slots")}</span>
            </div>
            <div className="sp-tile">
              <b>{llm?.contextLength ? llm.contextLength.toLocaleString() : "—"}</b>
              <span>{t("panel.context")}</span>
            </div>
            <div className="sp-tile">
              {(() => {
                const engine = engineStateLabel(llm, t);
                return (
                  <b className={engine.muted ? "text-muted" : undefined} title={engine.title}>
                    {engine.text}
                  </b>
                );
              })()}
              <div className="sp-tile__label">
                <span>{t("panel.engine")}</span>
                <button
                  type="button"
                  onClick={() => {
                    setEngineInfoOpen((v) => {
                      if (!v) startEngineInfoTimer();
                      return !v;
                    });
                  }}
                  onMouseEnter={clearEngineInfoTimer}
                  onMouseLeave={startEngineInfoTimer}
                  className="relative cursor-pointer opacity-60 hover:opacity-100"
                  aria-label={t("panel.engineInfoAria")}
                >
                  <InfoIcon className="h-2.5 w-2.5" />
                  {engineInfoOpen && (
                    <div
                      onMouseEnter={clearEngineInfoTimer}
                      onMouseLeave={startEngineInfoTimer}
                      className="absolute left-0 top-full z-10 mt-1 w-56 rounded-xl border border-border-strong bg-surface-elevated px-3 py-2 text-left text-[11px] font-normal normal-case text-text shadow-lg"
                    >
                      {t("panel.engineInfo")}
                    </div>
                  )}
                </button>
              </div>
            </div>
            <div className="sp-tile" title={t("tokens.engineGeneratedTitle")}>
              <b>{llm && llm.totalOutputTokens > 0 ? llm.totalOutputTokens.toLocaleString() : "—"}</b>
              <span>{t("tokens.engineGenerated")}</span>
            </div>
          </div>

          <LlmLaunchers
            sparkId={sparkId}
            llmPort={llmPort}
            modelId={llm?.modelId}
            onLaunch={launchLocal}
            onRemoteLaunch={launchRemote}
          />
          {llm?.posture && (
            <div className="sp-chips">
              <PostureBadge posture={llm.posture} />
            </div>
          )}
          <LlmDailyChart sparkId={sparkId} llmPort={llmPort} />
          <LlmTrendChart sparkId={sparkId} llmPort={llmPort} />
          <LlmTokenTotals sparkId={sparkId} llmPort={llmPort} />
        </div>
      )}

      <ConversationList conversations={conversations} onAddHarness={onAddHarness} />

      <BenchmarkDialog
        open={openBench === "decode"}
        onClose={() => setOpenBench(null)}
        onSwitchBench={setOpenBench}
        sparkId={sparkId}
        llmPort={llmPort}
        modelId={remoteTarget ? null : llm?.modelId ?? null}
        models={remoteTarget || (available && llm?.backend === "llama.cpp") ? undefined : llm?.models}
        remoteTarget={remoteTarget}
        shareImage={shareImage}
        sparkName={sparkName ?? null}
        engine={remoteTarget ? null : llm?.backend ?? null}
        posture={remoteTarget ? null : llm?.posture ?? null}
        liveTps={remoteTarget ? null : measuredGenerationTps(llm)}
      />
      <PrefillBenchDialog
        open={openBench === "prefill"}
        onClose={() => setOpenBench(null)}
        onSwitchBench={setOpenBench}
        sparkId={sparkId}
        llmPort={llmPort}
        modelId={remoteTarget ? null : llm?.modelId ?? null}
        contextLength={remoteTarget ? null : llm?.contextLength ?? null}
        remoteTarget={remoteTarget}
        shareImage={shareImage}
        sparkName={sparkName ?? null}
        engine={remoteTarget ? null : llm?.backend ?? null}
        posture={remoteTarget ? null : llm?.posture ?? null}
      />
      <QualityBenchDialog
        open={openBench === "quality"}
        onClose={() => setOpenBench(null)}
        onSwitchBench={setOpenBench}
        sparkId={sparkId}
        llmPort={llmPort}
        modelId={remoteTarget ? null : llm?.modelId ?? null}
        contextLength={remoteTarget ? null : llm?.contextLength ?? null}
        remoteTarget={remoteTarget}
        sparkName={sparkName ?? null}
        engine={remoteTarget ? null : llm?.backend ?? null}
        posture={remoteTarget ? null : llm?.posture ?? null}
      />
    </Panel>
  );
}

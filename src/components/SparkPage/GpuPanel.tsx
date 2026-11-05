import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { GpuDevice, GpuMetrics } from "../../api/types";
import { Sparkline } from "../ui/Sparkline";
import { Panel } from "../ui/Panel";
import { Ring } from "../ui/Ring";
import { Tag, type TagTone } from "../ui/Tag";
import { ActivityIcon } from "../ui/icons";
import { MetricBar } from "../ui/MetricBar";
import { VramBreakdownBar } from "../ui/VramBreakdownBar";
import { shortProcessName } from "../../shared/processName";
import { useMetricsHistoryTail } from "../../hooks/metricsStore";
import { formatMb } from "../../shared/formatBytes";
import { shortGpuName } from "../../shared/gpuName";
import { GpuHistoryChart, GPU_CHART_WINDOWS } from "./GpuHistoryChart";
import {
  computeVramBreakdown,
  headroomTextClass,
  type VramBreakdownContext,
} from "../../shared/vramBreakdown";

interface GpuPanelProps {
  gpu: GpuMetrics | null;
  /**
   * Draw the VRAM bars as an engine / system / free breakdown judged by
   * headroom (Settings → Detailed VRAM breakdown). null: the plain bar.
   */
  vramContext?: VramBreakdownContext | null;
  sparkId: string;
  temperatureUnit: "celsius" | "fahrenheit";
  /** GPU chip name for the title (e.g. "GB10"). */
  chip?: string | null;
  /**
   * Hide the VRAM bar and process list — set when the Unified memory panel
   * (which shows both) sits right below this one.
   */
  hideMemory?: boolean;
  className?: string;
}

function celsiusToFahrenheit(c: number): number {
  return Math.round(c * 9 / 5 + 32);
}

function throttleTag(reason: string | undefined, t: TFunction<"spark">): { label: string; tone: TagTone } {
  const r = reason ?? "ok";
  if (r === "thermal") return { label: t("gpu.throttleThermal"), tone: "bad" };
  if (r === "power") return { label: t("gpu.throttlePower"), tone: "neutral" };
  if (r === "hw") return { label: t("gpu.throttleHw"), tone: "warn" };
  if (r === "unknown") return { label: t("gpu.throttleUnknown"), tone: "warn" };
  return { label: t("gpu.throttleNone"), tone: "good" };
}

function tempTag(celsius: number, t: TFunction<"spark">): { label: string; tone: TagTone } {
  if (celsius > 85) return { label: t("gpu.tempHot"), tone: "bad" };
  if (celsius > 65) return { label: t("gpu.tempWarm"), tone: "warn" };
  return { label: t("gpu.tempNormal"), tone: "good" };
}

function tempColorFor(celsius: number, idle = "var(--color-text)"): string {
  return celsius > 85 ? "var(--color-danger)" : celsius > 65 ? "var(--color-warning)" : idle;
}

/** One physical GPU on a multi-card host: name, throttle chip, usage/temp sparklines, VRAM. */
function GpuDeviceRow({
  device: d,
  vramContext,
  sparkId,
  temperatureUnit,
}: {
  device: GpuDevice;
  vramContext: VramBreakdownContext | null;
  sparkId: string;
  temperatureUnit: "celsius" | "fahrenheit";
}) {
  const { t } = useTranslation("spark");
  // One card's own VRAM and processes; its KV pool is not knowable per card.
  const breakdown = vramContext && d.metricAvailability?.vramUsed !== false && d.metricAvailability?.vramTotal !== false
    ? computeVramBreakdown(d.vram, d.processes, {
        model: "discrete",
        unified: null,
        serving: vramContext.serving,
      })
    : null;
  const usageHistory = useMetricsHistoryTail(sparkId, `gpu.${d.index}.usage`);
  const tempHistory = useMetricsHistoryTail(sparkId, `gpu.${d.index}.temp`);
  const temp = temperatureUnit === "fahrenheit" ? celsiusToFahrenheit(d.temperature) : d.temperature;
  const tempLabel = d.metricAvailability?.temperature === false
    ? "—"
    : temperatureUnit === "fahrenheit" ? `${temp}°F` : `${temp}°C`;
  const tempColor = tempColorFor(d.temperature, "var(--color-accent)");
  const chip = throttleTag(d.throttle?.reason, t);
  const short = shortGpuName(d.name);
  return (
    <div className="sp-device space-y-1.5" title={d.throttle?.detail ?? undefined}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-medium text-text" title={d.name ?? undefined}>
          {d.vendor === "amd" ? `AMD GPU ${d.physicalIndex ?? d.index}` : `GPU ${d.physicalIndex ?? d.index}`}
          {short ? ` · ${short}` : ""}
        </span>
        <Tag tone={chip.tone}>{chip.label}</Tag>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted">{t("gpu.usage")}</span>
        <div className="flex items-center gap-2">
          <Sparkline data={usageHistory} color="var(--color-accent)" width={84} height={16} />
          <span className="font-tabular text-text">{d.metricAvailability?.usage === false ? "—" : `${d.usage}%`}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted">{t("gpu.temperature")}</span>
        <div className="flex items-center gap-2">
          <Sparkline data={tempHistory} color={tempColor} width={84} height={16} />
          <span className="font-tabular" style={{ color: tempColor }}>{tempLabel}</span>
        </div>
      </div>
      <div className="flex justify-between gap-2 text-xs">
        <span className="text-muted">{t("gpu.power")}</span>
        <span className="font-tabular text-text">
          {d.metricAvailability?.powerDraw === false ? "—" : `${d.power.draw}W`} / {d.metricAvailability?.powerLimit === false ? "—" : `${d.power.limit}W`}
        </span>
      </div>
      {d.vramSource === "pci-bar" ? (
        <div className="flex justify-between text-xs" title={t("gpu.vramUnreadableTitle")}>
          <span className="text-muted">{t("gpu.vram")}</span>
          <span className="font-tabular text-text">{t("gpu.vramTotal", { size: formatMb(d.vram.total) })}</span>
        </div>
      ) : breakdown ? (
        <VramBreakdownBar label={t("gpu.vram")} breakdown={breakdown} showLegend />
      ) : d.metricAvailability?.vramUsed === false || d.metricAvailability?.vramTotal === false ? (
        <div className="flex justify-between text-xs"><span className="text-muted">{t("gpu.vram")}</span><span className="font-tabular text-text">—</span></div>
      ) : d.vram.total > 0 ? (
        <MetricBar
          label={t("gpu.vram")}
          value={d.vram.used}
          max={d.vram.total}
          caption={`${formatMb(d.vram.used).replace(/ (GB|MB)$/, "")} / ${formatMb(d.vram.total)}`}
        />
      ) : (
        <div className="flex justify-between text-xs">
          <span className="text-muted">{t("gpu.vram")}</span>
          <span className="font-tabular text-text">
            {d.vram.used > 0 ? t("gpu.vramUsed", { size: formatMb(d.vram.used) }) : "—"}
          </span>
        </div>
      )}
    </div>
  );
}

export function GpuPanel({
  gpu,
  vramContext = null,
  sparkId,
  temperatureUnit,
  chip,
  hideMemory = false,
  className,
}: GpuPanelProps) {
  const { t } = useTranslation("spark");
  const [windowId, setWindowId] = useState<(typeof GPU_CHART_WINDOWS)[number]["id"]>("30m");
  const windowMs = GPU_CHART_WINDOWS.find((w) => w.id === windowId)?.ms ?? GPU_CHART_WINDOWS[0].ms;

  const temperature = gpu?.temperature ?? 0;
  const metrics = gpu?.metricAvailability;
  const temperatureAvailable = metrics?.temperature ?? true;
  const displayTemp = temperatureUnit === "fahrenheit" ? celsiusToFahrenheit(temperature) : temperature;
  const tempUnit = temperatureUnit === "fahrenheit" ? "°F" : "°C";
  const usage = gpu?.usage ?? 0;
  const powerDraw = gpu?.power?.draw ?? 0;
  const powerLimit = gpu?.power?.limit ?? 0;
  const systemDraw = gpu?.power?.systemDraw;

  const vramUsed = gpu?.vram?.used ?? 0;
  const vramTotal = gpu?.vram?.total ?? 0;
  const devices = gpu?.gpus ?? [];
  const multiGpu = devices.length > 1;
  const vramAvailable = metrics?.vramUsed !== false && metrics?.vramTotal !== false;
  const breakdown =
    gpu && vramAvailable && vramContext ? computeVramBreakdown(gpu.vram, gpu.processes, vramContext) : null;

  const thr = gpu?.throttle;
  const thermal = thr?.reason === "thermal";
  const throttle = throttleTag(thr?.reason, t);
  const temp = tempTag(temperature, t);
  const ringColor = thermal ? "var(--color-danger)" : "var(--color-accent)";
  const clock =
    thr?.smClockMHz != null
      ? { value: (thr.smClockMHz / 1000).toFixed(2), unit: "GHz" }
      : thr?.smClockPct != null
        ? { value: String(Math.round(thr.smClockPct)), unit: "%" }
        : { value: "—", unit: "" };

  return (
    <Panel
      title={chip ? `GPU · ${chip}` : "GPU"}
      icon={<ActivityIcon />}
      className={`panel-gpu ${className ?? ""}`}
      bodyClassName="sp-stack"
      actions={
        <div className="seg" role="group" aria-label={t("gpu.chartWindow")}>
          {GPU_CHART_WINDOWS.map((w) => (
            <button
              key={w.id}
              type="button"
              className={w.id === windowId ? "is-on" : ""}
              aria-pressed={w.id === windowId}
              onClick={() => setWindowId(w.id)}
            >
              {w.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="sp-gpu-top">
        <Ring
          value={usage}
          size={140}
          strokeWidth={11}
          color={ringColor}
          label={metrics?.usage === false ? "—" : `${usage}%`}
          caption={t("gpu.utilization")}
          className="sp-gpu-top__ring"
        />
        <div className="sp-stat">
          <span className="eyebrow">{t("gpu.temperature")}</span>
          <div className="big-num">
            {temperatureAvailable ? displayTemp : "—"}
            {temperatureAvailable ? <small>{tempUnit}</small> : null}
          </div>
          <Tag tone={temp.tone}>{temp.label}</Tag>
        </div>
        <div className="sp-stat">
          <span className="eyebrow">{multiGpu ? t("gpu.powerAllCards") : t("gpu.powerDraw")}</span>
          <div className="big-num">
            {metrics?.powerDraw === false ? "—" : powerDraw}
            {metrics?.powerDraw === false ? null : <small>{metrics?.powerLimit === false ? "W" : powerLimit > 0 ? `/ ${powerLimit} W` : "W"}</small>}
          </div>
          {systemDraw != null && systemDraw > 0 ? (
            <span className="sp-stat__sub mono">{t("gpu.systemDraw", { watts: systemDraw })}</span>
          ) : null}
        </div>
        <div className="sp-stat" title={thr?.detail ?? undefined}>
          <span className="eyebrow">{t("gpu.smClock")}</span>
          <div className="big-num">
            {clock.value}
            <small>{clock.unit}</small>
          </div>
          <Tag tone={throttle.tone}>{throttle.label}</Tag>
          {thr?.clockCapMHz != null ? (
            <span className="sp-stat__sub mono" title={t("gpu.capTitle")}>
              {t("gpu.cap", { mhz: thr.clockCapMHz })}
            </span>
          ) : null}
        </div>
      </div>

      <GpuHistoryChart sparkId={sparkId} gpu={gpu} windowMs={windowMs} />
      {!multiGpu && (
        <div className="legend">
          <span className="c-accent">{t("gpu.legendUtilization")}</span>
          <span className="c-violet">{t("gpu.legendPower")}</span>
          <span className="c-info">{t("gpu.legendTemperature")}</span>
        </div>
      )}

      {/* Per-card breakdown — only when the host has more than one GPU */}
      {multiGpu && (
        <div className="sp-section">
          <div className="eyebrow">{t("gpu.gpuCount", { n: devices.length })}</div>
          <div className="sp-devices">
            {devices.map((d) => (
              <GpuDeviceRow
                key={d.uuid ?? d.index}
                device={d}
                vramContext={vramContext}
                sparkId={sparkId}
                temperatureUnit={temperatureUnit}
              />
            ))}
          </div>
        </div>
      )}

      {/* GPU-allocated memory (shown here only when the Unified memory panel is not) */}
      {gpu && !hideMemory && (
        <div className="sp-section">
          {!vramAvailable ? (
            <div className="sp-stat"><span className="eyebrow">{t("gpu.vram")}</span><span className="mono">—</span></div>
          ) : breakdown ? (
            <>
              <VramBreakdownBar
                label={
                  multiGpu
                    ? t("gpu.vramAllCards")
                    : breakdown.systemMB != null
                      ? t("gpu.unifiedMemory")
                      : t("gpu.vram")
                }
                breakdown={breakdown}
                showLegend
              />
              <div className="sp-row">
                <span className="text-muted">{t("gpu.available")}</span>
                <span className={`mono ${headroomTextClass(breakdown.tone)}`}>
                  {formatMb(breakdown.freeMB)}
                </span>
              </div>
            </>
          ) : vramTotal > 0 ? (
            <>
              <MetricBar
                label={multiGpu ? t("gpu.vramAllCards") : t("gpu.vram")}
                value={vramUsed}
                max={vramTotal}
                color="bg-info"
                caption={`${formatMb(vramUsed).replace(/ (GB|MB)$/, "")} / ${formatMb(vramTotal)}`}
              />
              {gpu.vram.available > 0 && (
                <div className="sp-row">
                  <span className="text-muted">{t("gpu.available")}</span>
                  <span className="mono text-text">{formatMb(gpu.vram.available)}</span>
                </div>
              )}
            </>
          ) : (
            <div className="sp-row">
              <span className="text-muted">{t("gpu.vram")}</span>
              <span className="mono text-text">{vramUsed > 0 ? t("gpu.vramUsed", { size: formatMb(vramUsed) }) : "—"}</span>
            </div>
          )}
        </div>
      )}

      {(gpu?.nvErrNoMemory ?? 0) > 0 && (
        <div
          className="sp-row"
          title={t("gpu.nvErrTitle")}
        >
          <span className="text-muted">{t("gpu.nvErr")}</span>
          <span className="mono font-semibold text-danger">{gpu?.nvErrNoMemory}</span>
        </div>
      )}

      {/* Top GPU processes by VRAM usage */}
      {gpu && !hideMemory && gpu.processes && gpu.processes.length > 0 && (
        <GpuProcessTable processes={gpu.processes} />
      )}
    </Panel>
  );
}

/** Per-process memory table (PID · process · memory). Shared with the Unified memory panel. */
export function GpuProcessTable({
  processes,
}: {
  processes: NonNullable<GpuMetrics["processes"]>;
}) {
  const { t } = useTranslation("spark");
  return (
    <table className="sp-table">
      <thead>
        <tr>
          <th>PID</th>
          <th>{t("gpu.process")}</th>
          <th className="r">{t("gpu.memory")}</th>
        </tr>
      </thead>
      <tbody>
        {processes.map((proc) => (
          <tr key={proc.pid}>
            <td className="mono">{proc.pid}</td>
            <td title={`${proc.name} (PID ${proc.pid})`}>
              <span className="sp-table__name">{shortProcessName(proc.name)}</span>
            </td>
            <td className="r mono">{formatMb(proc.vramMB)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

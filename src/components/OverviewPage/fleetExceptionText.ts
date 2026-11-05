import type { TFunction } from "i18next";
import type { SparkSnapshot } from "../../api/types";
import { formatTemperature } from "../../shared/fleetExceptions";

export type FleetExceptionId = "offline" | "throttle" | "disk" | "llm" | "tailnet";

/**
 * What the shared fleetExceptions() module decided, kept as data so the browser
 * can word it in the current language (the shared module's English stays for the server).
 */
export type FleetExceptionFacts = {
  id: FleetExceptionId;
  /** Throttle only: thermal (true) or hardware slowdown (false). */
  thermal?: boolean;
  /** Throttle only: the driver's own reason text, shown as reported. */
  rawDetail?: string;
  /** Throttle only: GPU temperature already formatted in the chosen unit. */
  temp?: string;
  /** Throttle only: SM clock in GHz, one decimal. */
  smClockGHz?: string;
  smClockPct?: number;
};

/** Read the same snapshot fields fleetExceptions() reads, for one exception it reported. */
export function fleetExceptionFacts(id: FleetExceptionId, spark: SparkSnapshot, unit: "celsius" | "fahrenheit"): FleetExceptionFacts {
  if (id !== "throttle") return { id };
  const gpu = spark.metrics?.gpu;
  const th = gpu?.throttle;
  return {
    id,
    thermal: !!th?.thermal,
    ...(th?.detail ? { rawDetail: th.detail } : {}),
    ...(gpu?.temperature ? { temp: formatTemperature(gpu.temperature, unit) } : {}),
    ...(th?.smClockMHz ? { smClockGHz: (th.smClockMHz / 1000).toFixed(1) } : {}),
    ...(th?.smClockMHz && th.smClockPct != null ? { smClockPct: Math.round(th.smClockPct) } : {}),
  };
}

/** The exception's short label in the current language (follows the unit name: "spark-1 is thermal throttling"). */
export function fleetExceptionLabel(t: TFunction<"overview">, facts: FleetExceptionFacts): string {
  switch (facts.id) {
    case "offline":
      return t("alerts.offline");
    case "throttle":
      return facts.thermal ? t("alerts.thermal") : t("alerts.hwSlowdown");
    case "disk":
      return t("alerts.disk");
    case "llm":
      return t("alerts.llm");
    case "tailnet":
      return t("alerts.tailnet");
  }
}

/** The exception's detail line in the current language; the driver's reason text is kept as reported. */
export function fleetExceptionDetail(t: TFunction<"overview">, facts: FleetExceptionFacts): string | undefined {
  if (facts.id !== "throttle") return undefined;
  const bits: string[] = [];
  if (facts.rawDetail) bits.push(facts.rawDetail);
  if (facts.temp) bits.push(t("alerts.gpuAt", { temp: facts.temp }));
  if (facts.smClockGHz) {
    bits.push(
      facts.smClockPct != null
        ? t("alerts.smClockPct", { ghz: facts.smClockGHz, pct: facts.smClockPct })
        : t("alerts.smClock", { ghz: facts.smClockGHz })
    );
  }
  return bits.length ? bits.join(" · ") : undefined;
}

/**
 * Label and detail of one strip row in the current language. Rows the browser can see
 * live are re-worded; a server-only row (e.g. a Health finding) keeps the server's text.
 */
export function fleetAlertText(
  t: TFunction<"overview">,
  alert: { label: string; detail?: string; exception?: FleetExceptionFacts }
): { label: string; detail?: string } {
  if (!alert.exception) return { label: alert.label, ...(alert.detail ? { detail: alert.detail } : {}) };
  const detail = fleetExceptionDetail(t, alert.exception);
  return { label: fleetExceptionLabel(t, alert.exception), ...(detail ? { detail } : {}) };
}

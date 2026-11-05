import type { TFunction } from "i18next";
import type { ActivityEvent } from "../../api/types";
import { tzOffsetMinutes } from "../../shared/timeZone";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type RelativeTime =
  | { kind: "now" }
  | { kind: "m" | "h" | "d"; n: number }
  | { kind: "date"; month: number; day: number };

function relativeTime(ts: number, now: number): RelativeTime {
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return { kind: "now" };
  const min = Math.floor(sec / 60);
  if (min < 60) return { kind: "m", n: Math.max(1, min) };
  const hr = Math.floor(min / 60);
  if (hr < 24) return { kind: "h", n: hr };
  const day = Math.floor(hr / 24);
  if (day < 7) return { kind: "d", n: day };
  // Month and day in the Settings time zone (else the browser's), via the same offset the charts use.
  const d = new Date(ts + tzOffsetMinutes(ts) * 60_000);
  return { kind: "date", month: d.getUTCMonth(), day: d.getUTCDate() };
}

/** Compact relative time: "now", "2m", "3h", "5d", then "Oct 5" after a week (English). */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const r = relativeTime(ts, now);
  if (r.kind === "now") return "now";
  if (r.kind === "date") return `${MONTHS[r.month]} ${r.day}`;
  return `${r.n}${r.kind}`;
}

/** formatRelativeTime in the current language; the compact m/h/d forms stay as they are. */
export function formatRelativeTimeText(t: TFunction<"overview">, ts: number, now: number = Date.now()): string {
  const r = relativeTime(ts, now);
  if (r.kind === "now") return t("time.now");
  if (r.kind !== "date") return `${r.n}${r.kind}`;
  const months = [
    t("time.months.jan"), t("time.months.feb"), t("time.months.mar"), t("time.months.apr"),
    t("time.months.may"), t("time.months.jun"), t("time.months.jul"), t("time.months.aug"),
    t("time.months.sep"), t("time.months.oct"), t("time.months.nov"), t("time.months.dec"),
  ];
  return t("time.date", { month: months[r.month], day: r.day });
}

/** Screen-reader name of an event's severity dot. */
export function severityLabel(t: TFunction<"overview">, severity: ActivityEvent["severity"]): string {
  switch (severity) {
    case "success":
      return t("activity.severity.success");
    case "warn":
      return t("activity.severity.warn");
    case "error":
      return t("activity.severity.error");
    case "info":
      return t("activity.severity.info");
    default:
      return String(severity);
  }
}

export function severityDotClass(severity: ActivityEvent["severity"]): string {
  switch (severity) {
    case "success":
      return "bg-success";
    case "warn":
      return "bg-warning";
    case "error":
      return "bg-danger";
    case "info":
      return "bg-accent";
    default:
      return "bg-muted";
  }
}

/** Split a message around the first occurrence of the spark name. */
export function splitMessage(
  message: string,
  sparkName?: string | null
): { before: string; name: string; after: string } {
  if (sparkName) {
    const i = message.indexOf(sparkName);
    if (i >= 0) {
      return {
        before: message.slice(0, i),
        name: sparkName,
        after: message.slice(i + sparkName.length),
      };
    }
  }
  return { before: message, name: "", after: "" };
}

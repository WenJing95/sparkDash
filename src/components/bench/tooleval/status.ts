import type { TFunction } from "i18next";
import type { ToolEvalRunStatus } from "../../../api/types";

export type StatusTone = "good" | "bad" | "warn" | "acc" | "neutral";

export function statusTone(status: ToolEvalRunStatus): StatusTone {
  switch (status) {
    case "completed":
      return "good";
    case "failed":
      return "bad";
    case "stopped":
    case "gone":
      return "warn";
    case "running":
      return "acc";
    default:
      return "neutral";
  }
}

export function statusLabel(t: TFunction<"toolEval">, status: ToolEvalRunStatus, watching = true): string {
  switch (status) {
    case "running":
      return watching ? t("status.running") : t("status.runningUnwatched");
    case "completed":
      return t("status.completed");
    case "failed":
      return t("status.failed");
    case "stopped":
      return t("status.stopped");
    case "gone":
      return t("status.gone");
    default:
      return status;
  }
}

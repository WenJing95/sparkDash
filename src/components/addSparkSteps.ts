import type { TFunction } from "i18next";
import type { SparkConfig, SparkRole } from "../api/types";
import type { UnitType } from "../shared/deviceKind";

/** Step ids; the dialog shows each one through its translated label. */
export const ADD_STEPS = ["connect", "role", "services"] as const;
export type AddStep = 0 | 1 | 2;

export type AddSparkDraft = Omit<SparkConfig, "id">;

/** Why the Connect step cannot advance, or null when it can. The dialog turns the code into text. */
export type ConnectProblem = "lanIpRequired" | "passwordRequired";
/** Why the Role step cannot advance, or null when it can. */
export type RoleProblem = "nameRequired";

/** Validation problem for the Connect step, or null when it can advance. */
export function validateConnect(config: AddSparkDraft): ConnectProblem | null {
  if (!config.isLocal && !config.lanIp.trim()) return "lanIpRequired";
  if (!config.isLocal && config.ssh.auth === "pass" && !config.ssh.password) {
    return "passwordRequired";
  }
  return null;
}

/** Validation problem for the Role step, or null when it can advance. */
export function validateRole(config: AddSparkDraft): RoleProblem | null {
  return config.name.trim() ? null : "nameRequired";
}

/** Whether the "Next" / "Add" button for `step` should be enabled. */
export function canAdvance(step: AddStep, config: AddSparkDraft): boolean {
  if (step === 0) return validateConnect(config) === null;
  if (step === 1) return validateRole(config) === null;
  return validateConnect(config) === null && validateRole(config) === null;
}

/** Role patch that keeps role, workerNode and llmMonitoring consistent. */
export function rolePatch(role: SparkRole): Partial<AddSparkDraft> {
  return { role, workerNode: role === "worker", llmMonitoring: role !== "worker" };
}

/** Comma-separated LLM ports -> valid ports only (1-65535, integers). */
export function parsePorts(text: string): number[] {
  return text
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 65535);
}

export function slugifyId(name: string, now: number = Date.now()): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `spark-${now}`;
}

/** Translated label for a Unit type choice (shared by the Add and Edit dialogs). */
export function unitTypeLabel(t: TFunction<"sparkForm">, type: UnitType): string {
  if (type === "host") return t("unitType.host");
  if (type === "windows") return t("unitType.windows");
  return t("unitType.spark");
}

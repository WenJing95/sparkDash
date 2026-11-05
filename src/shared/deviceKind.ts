import type { TFunction } from "i18next";
import type { SparkConfig } from "../api/types";

/** Short noun for a unit kind, matching the "Spark/GPU Host" wording used elsewhere. */
export function deviceKindNoun(kind: SparkConfig["kind"]): "Spark" | "GPU Host" {
  return kind === "host" ? "GPU Host" : "Spark";
}

/** The choices in the Unit type select. */
export type UnitType = "spark" | "host" | "windows";

export const UNIT_TYPE_OPTIONS: { value: UnitType; label: string }[] = [
  { value: "spark", label: "NVIDIA DGX Spark" },
  { value: "host", label: "Dedicated GPU host (Linux, nvidia-smi, not a Spark)" },
  { value: "windows", label: "Windows PC (NVIDIA GPU or AMD Strix Halo)" },
];

export function unitTypeOf(config: Pick<SparkConfig, "kind" | "platform">): UnitType {
  if (config.platform === "windows") return "windows";
  return config.kind === "host" ? "host" : "spark";
}

/** Config fields to set when the Unit type select changes. */
export function unitTypePatch(type: UnitType, current: Pick<SparkConfig, "platform">): Partial<SparkConfig> {
  if (type === "windows") return { kind: "host", platform: "windows", isLocal: false };
  // Keep a macOS platform set through the API; everything else is plain Linux.
  const platform = current.platform === "darwin" ? "darwin" : "linux";
  return { kind: type, platform };
}

/** Label for the final "add" button in the Add dialog. */
export function addDeviceLabel(kind: SparkConfig["kind"]): string {
  return `Add ${deviceKindNoun(kind)}`;
}

/** Title for the Edit dialog. */
export function editDeviceTitle(kind: SparkConfig["kind"]): string {
  return `Edit ${deviceKindNoun(kind)}`;
}

// ─── UI-language versions (the functions above stay English for existing callers and tests) ───

/** deviceKindNoun in the UI language. */
export function deviceKindNounText(t: TFunction<"common">, kind: SparkConfig["kind"]): string {
  return kind === "host" ? t("device.host") : t("device.spark");
}

/** UNIT_TYPE_OPTIONS with labels in the UI language. */
export function unitTypeOptions(t: TFunction<"common">): { value: UnitType; label: string }[] {
  return [
    { value: "spark", label: t("device.unitSpark") },
    { value: "host", label: t("device.unitHost") },
    { value: "windows", label: t("device.unitWindows") },
  ];
}

/** addDeviceLabel in the UI language. */
export function addDeviceLabelText(t: TFunction<"common">, kind: SparkConfig["kind"]): string {
  return kind === "host" ? t("device.addHost") : t("device.addSpark");
}

/** editDeviceTitle in the UI language. */
export function editDeviceTitleText(t: TFunction<"common">, kind: SparkConfig["kind"]): string {
  return kind === "host" ? t("device.editHost") : t("device.editSpark");
}

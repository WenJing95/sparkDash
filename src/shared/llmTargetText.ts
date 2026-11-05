import type { TFunction } from "i18next";

/**
 * parseLlmTargetInput (shared/llmTarget.js, also used by the server) throws fixed English
 * messages. Known ones are shown in the UI language; any other text is shown as thrown.
 */
export function llmTargetErrorText(t: TFunction<"common">, message: string): string {
  switch (message) {
    case "Enter a host":
      return t("llmTarget.enterHost");
    case "Invalid URL":
      return t("llmTarget.invalidUrl");
    default:
      return message;
  }
}

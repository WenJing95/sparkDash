import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

export type BenchKind = "decode" | "prefill" | "quality";

const KINDS: BenchKind[] = ["decode", "prefill", "quality"];

function kindLabel(kind: BenchKind, t: TFunction<"benchRun">): string {
  switch (kind) {
    case "decode":
      return t("switcher.decode");
    case "prefill":
      return t("switcher.prefill");
    default:
      return t("switcher.quality");
  }
}

/**
 * Segmented switch shown in every benchmark dialog header so Decode, Prefill and
 * Quality read as one tool. The parent (LlmPanel) owns which dialog is open and
 * swaps it when `onSwitch` fires. Hidden when no handler is supplied.
 */
export function BenchSwitcher({
  active,
  onSwitch,
  disabled = false,
}: {
  active: BenchKind;
  onSwitch?: (kind: BenchKind) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("benchRun");
  if (!onSwitch) return null;
  return (
    <div className="seg" role="tablist" aria-label={t("switcher.aria")}>
      {KINDS.map((k) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={k === active}
          className={k === active ? "is-on" : ""}
          disabled={disabled && k !== active}
          onClick={() => k !== active && onSwitch(k)}
        >
          {kindLabel(k, t)}
        </button>
      ))}
    </div>
  );
}

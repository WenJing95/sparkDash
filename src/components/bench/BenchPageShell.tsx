import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SparkSnapshot } from "../../api/types";
import { benchBlurb, benchFamily, benchLabel, benchTypeById } from "./benchCatalog";
import { SparkChips } from "./SparkChips";

interface BenchPageShellProps {
  type: string;
  spark: SparkSnapshot | null;
  sparks: readonly SparkSnapshot[];
  onSelectSpark: (id: string) => void;
  /** Extra controls on the right of the header. */
  tools?: ReactNode;
  /** Show the "Run on" Spark chips here. Pages that fold them into their own target row turn this off. */
  picker?: boolean;
  children: ReactNode;
}

/** Common header for every benchmark page: title and blurb, then a "Run on" Spark picker right under it. */
export function BenchPageShell({ type, spark, sparks, onSelectSpark, tools, picker = true, children }: BenchPageShellProps) {
  const { t } = useTranslation("benchPages");
  const bench = benchTypeById(type);
  return (
    <div className="bench-page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            {bench ? t("shell.benchmarksFamily", { family: benchFamily(t, bench.family) }) : t("shell.benchmarks")}
          </div>
          <h1>{bench ? benchLabel(t, bench) : t("shell.benchmark")}</h1>
          {bench ? <p className="page-head__sub">{benchBlurb(t, bench)}</p> : null}
        </div>
        <div className="page-head__tools">
          {tools}
        </div>
      </div>
      {picker ? (
        <div className="bench-runon">
          <span className="eyebrow">{t("shell.runOn")}</span>
          {sparks.length === 0 ? <span className="bench-runon__none">{t("shell.noSparks")}</span> : null}
          <SparkChips sparks={sparks} activeId={spark?.id ?? null} onSelect={onSelectSpark} />
        </div>
      ) : null}
      {children}
    </div>
  );
}

import { act } from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { setLocale } from "../../../i18n";
import { render } from "../../../testing/render";
import { BenchPageShell } from "../BenchPageShell";
import { BenchTargetFrame } from "./BenchTargetFrame";
import { HistoryTable } from "./pageParts";
import { qualityHistoryRow } from "./historyRows";
import type { QualityBenchJob } from "../../../api/types";

beforeEach(async () => {
  await setLocale("en");
});
afterEach(async () => {
  await act(() => setLocale("en"));
  localStorage.clear();
});

it("translates the benchmark page frame, empty state and history table", async () => {
  const job = {
    benchId: "q1",
    startedAt: 1,
    status: "failed",
    config: { label: "fp4 KV", modelId: "m" },
    results: { overallPct: 50, categories: { qa: {}, reason: {} } },
  } as unknown as QualityBenchJob;
  render(
    <BenchPageShell type="quality" spark={null} sparks={[]} onSelectSpark={() => {}}>
      <BenchTargetFrame spark={null}>{() => null}</BenchTargetFrame>
      <HistoryTable rows={[qualityHistoryRow(job)]} activeId={null} labelHeader="Label" onView={() => {}} busy={false} />
    </BenchPageShell>
  );
  expect(document.querySelector("h1")?.textContent).toBe("Quality");
  expect(document.body.textContent).toContain("No Spark to benchmark");
  expect(document.body.textContent).toContain("2 categories");
  await act(() => setLocale("zh-CN"));
  expect(document.querySelector("h1")?.textContent).toBe("质量测试");
  expect(document.querySelector(".bp-empty strong")?.textContent).toBe("没有可测试的 Spark");
  expect(document.body.textContent).toContain("没有可用的 Spark");
  expect(document.body.textContent).toContain("2 个分类");
  expect(document.querySelector(".bp-status")?.textContent).toBe("失败");
});

import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listPrefillBench } from "../../api/client";
import type { PrefillBenchJob, PrefillBenchSizeResult } from "../../api/types";
import { flush, render } from "../../testing/render";
import { PrefillBenchDialog } from "./PrefillBenchDialog";
import { setLocale } from "../../i18n";

vi.mock("../../api/client", () => ({
  cancelPrefillBench: vi.fn(),
  clearPrefillBenchHistory: vi.fn(),
  getPrefillBench: vi.fn(),
  listPrefillBench: vi.fn(),
  startPrefillBench: vi.fn(),
}));

const row: PrefillBenchSizeResult = {
  targetTokens: 4096, promptTokens: 4000, promptChars: 16000, prefillTps: 4000, method: "ttft",
  samples: 3, samplesRequested: 3, overheadMs: 100, ttftMs: 1000, ttftContentMs: null,
  completionTokens: 8, durationMs: 3300, model: "m", error: null,
};
const job: PrefillBenchJob = {
  benchId: "p1", sparkId: "s1", status: "completed", startedAt: 1, completedAt: 2,
  config: { port: 8888, modelId: "m", contextSizes: [4096] },
  progress: { currentContext: null, completedLevels: 1, totalLevels: 1, message: "Done" },
  results: [row], error: null, durationMs: 1000,
};
const defaults = { allowedContextSizes: [1024, 4096, 8192], defaultContextSizes: [4096], minContextSize: 256, maxContextSize: 300000 };

beforeEach(async () => {
  await setLocale("en");
  vi.mocked(listPrefillBench).mockResolvedValue({ active: null, last: job, history: [job], defaults });
});
afterEach(async () => {
  await act(() => setLocale("en"));
});

it("switches the prefill dialog to Chinese and back while numbers stay as measured", async () => {
  render(<PrefillBenchDialog open onClose={() => {}} sparkId="s1" llmPort={8888} modelId="m" contextLength={32768} />);
  await flush();
  const title = () => document.querySelector("#prefill-bench-title")?.textContent?.trim();
  const head = () => document.querySelector(".bench-results__head")?.textContent;
  expect(title()).toBe("Prefill benchmark");
  expect(head()).toBe("ContextPrefillTTFT");

  await act(() => setLocale("zh-CN"));
  expect(title()).toBe("预填充基准测试");
  expect(head()).toBe("上下文预填充TTFT");
  expect(document.querySelector(".bench-legend")?.textContent).toContain("置信度低");
  const resultRow = document.querySelector(".bench-result-row")!;
  expect(resultRow.textContent).toContain("4000.0");
  expect(resultRow.getAttribute("title")).toBe("预填充：Token 数 ÷（TTFT − 100 ms 开销，修正量不超过 TTFT 的一半） · 取 3 次采样中速率居中的一次");
  expect([...document.querySelectorAll("button")].some((b) => b.textContent === "再次运行")).toBe(true);

  await act(() => setLocale("en"));
  expect(title()).toBe("Prefill benchmark");
});

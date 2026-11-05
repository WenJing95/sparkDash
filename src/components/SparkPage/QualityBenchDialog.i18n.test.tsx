import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listQualityBench } from "../../api/client";
import { setLocale } from "../../i18n";
import { flush, render } from "../../testing/render";
import { QualityBenchDialog } from "./QualityBenchDialog";

vi.mock("../../api/client", () => ({
  cancelQualityBench: vi.fn(),
  clearQualityBenchHistory: vi.fn(),
  deleteQualityBenchRun: vi.fn(),
  getQualityBench: vi.fn(),
  listQualityBench: vi.fn(),
  startQualityBench: vi.fn(),
}));

beforeEach(async () => {
  await setLocale("en");
});
afterEach(async () => {
  await act(() => setLocale("en"));
  localStorage.clear();
});

it("shows the quality dialog in Simplified Chinese and keeps example prompts in English", async () => {
  vi.mocked(listQualityBench).mockResolvedValue({ active: null, last: null, history: [] } as never);
  render(<QualityBenchDialog open onClose={() => {}} sparkId="s1" llmPort={8888} modelId="m" contextLength={32768} />);
  await flush();
  const title = () => document.querySelector("#quality-bench-title")?.textContent?.trim();
  expect(title()).toBe("Quality benchmark");
  await act(() => setLocale("zh-CN"));
  expect(title()).toBe("质量测试");
  const buttons = [...document.querySelectorAll("button")].map((b) => b.textContent?.trim());
  expect(buttons).toContain("运行质量测试");
  expect(document.body.textContent).toContain("推理");
  const more = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "工作原理")!;
  await act(async () => more.click());
  expect(document.querySelector(".q-info__example")?.textContent).toBe("What is 17 * 23?");
});

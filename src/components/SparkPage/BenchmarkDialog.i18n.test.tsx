import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, flush } from "../../testing/render";
import { BenchmarkDialog } from "./BenchmarkDialog";
import { listDecodeBench } from "../../api/client";
import type { DecodeBenchJob, QualityBenchJob } from "../../api/types";
import { buildDecodeShareCard, buildQualityShareCard, paintShareCard, type ShareCardContext } from "./benchShareCard";
import { setLocale } from "../../i18n";

vi.mock("../../api/client", () => ({
  listDecodeBench: vi.fn(), startDecodeBench: vi.fn(), getDecodeBench: vi.fn(),
  cancelDecodeBench: vi.fn(), clearDecodeBenchHistory: vi.fn(),
}));
vi.mock("./BenchCopyButton", () => ({
  BenchCopyButton: ({ text }: { text: string }) => <button data-share-text={text}>copy</button>,
}));

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text);
const job = (): DecodeBenchJob => ({
  benchId: "saved", sparkId: "spark-a", status: "completed", startedAt: 1, completedAt: 2,
  config: { port: 8888, concurrencies: [1], maxTokens: 400, modelId: "alpha", promptType: "structured", temperature: 0.7, thinking: true },
  progress: { currentConcurrency: null, completedLevels: 1, totalLevels: 1, message: "Done" },
  results: [{ concurrency: 1, model: "alpha", totalDecodeTokens: 10, totalCompletionTokens: 11, aggregateDecodeTps: 42.5, meanDecodeTps: 42.5, meanTtftMs: 120, streamsOk: 1, streamsFailed: 0 } as DecodeBenchJob["results"][number]],
  error: null, durationMs: 1000,
});

/** Records the strings the card painter draws; enough of a 2D context for every card type. */
function textContext(): ShareCardContext & { texts: string[] } {
  const texts: string[] = [];
  const noop = () => {};
  const ctx = {
    texts, fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textAlign: "left", textBaseline: "alphabetic", lineCap: "butt",
    save: noop, restore: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, fill: noop, stroke: noop,
    fillRect: noop, roundRect: noop,
    fillText: (s: string) => { texts.push(s); },
    measureText: (s: string) => ({ width: s.length * 10 }),
    createLinearGradient: () => ({ addColorStop: noop }),
  };
  return ctx as unknown as ShareCardContext & { texts: string[] };
}

beforeEach(async () => {
  await setLocale("en");
  vi.mocked(listDecodeBench).mockResolvedValue({ active: null, last: job(), history: [], defaults: {
    allowedConcurrencies: [1, 2], defaultMaxTokens: 400, minMaxTokens: 64, maxMaxTokens: 2048,
    promptTypes: ["structured", "prose", "code", "json"], defaultPromptType: "structured",
  } });
});
afterEach(async () => {
  await act(() => setLocale("en"));
});

it("switches the decode dialog, its copied text and its validation message to Chinese and back", async () => {
  render(<BenchmarkDialog open onClose={() => {}} sparkId="spark-a" llmPort={8888} modelId="alpha" />);
  await flush();
  const title = () => document.querySelector("#bench-title")?.textContent?.trim();
  const shareText = () => document.querySelector("[data-share-text]")?.getAttribute("data-share-text") ?? "";
  expect(title()).toBe("Decode benchmark");
  expect(document.querySelector(".bench-status-meta")?.textContent).toBe("Structured · 400 tok · temp 0.7 · thinking on · 1 conc · 1.0 s");
  expect(shareText()).toBe("alpha | decode tok/s results (Structured, temp 0.7 · thinking on):\n\n×1  42.5 agg  42.5/str  · TTFT 120ms");

  await act(() => setLocale("zh-CN"));
  expect(title()).toBe("解码基准测试");
  expect(document.querySelector(".bench-status-pill")?.textContent).toBe("已完成");
  expect(button("再次运行")).toBeTruthy();
  expect(shareText()).toBe("alpha | 解码 tok/s 结果（结构化，温度 0.7 · 开启思考）：\n\n×1  总吞吐 42.5  单流 42.5  · TTFT 120ms");

  // A local validation message follows the language after it is shown.
  await act(async () => button("再次运行")!.click());
  const maxTokens = document.querySelector<HTMLInputElement>("#bench-max-tokens")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(maxTokens, "9"); maxTokens.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => button("运行基准测试")!.click());
  expect(document.querySelector(".bench-sheet__error")?.textContent).toBe("最大 Token 数必须是 64 到 2048 之间的整数");
  await act(() => setLocale("en"));
  expect(document.querySelector(".bench-sheet__error")?.textContent).toBe("Max tokens must be an integer between 64 and 2048");
  expect(title()).toBe("Decode benchmark");
});

it("builds and paints the share cards in the active language with numbers and model names unchanged", async () => {
  const src = { llmPort: 8888, modelId: "DeepSeek-v4.1", sparkName: "spark-38bd" };
  await setLocale("zh-CN");
  const card = buildDecodeShareCard(job(), src);
  expect(card.title).toBe("解码基准测试");
  expect(card.subtitle).toBe("端口 8888 · DeepSeek-v4.1");
  expect(card.status.label).toBe("已完成");
  expect(card.rows[0]).toMatchObject({ load: "×1", primary: "42.5", primaryUnit: "tok/s", detail: "TTFT 120ms · 1/1 个流" });

  const quality = buildQualityShareCard(
    { status: "completed", config: { label: "fp8 KV" }, durationMs: 1000,
      results: { overallPct: 80, categories: { qa: { passed: 8, total: 10, scored: 10, errors: 0, pct: 80 } } } } as unknown as QualityBenchJob,
    null, src, 0
  );
  const ctx = textContext();
  paintShareCard(ctx, quality);
  expect(ctx.texts).toContain("质量测试");
  expect(ctx.texts).toContain("总分");
  expect(ctx.texts).toContain("问答");
  expect(ctx.texts).toContain("8/10 题");

  await setLocale("en");
  expect(buildDecodeShareCard(job(), src).title).toBe("Decode benchmark");
});

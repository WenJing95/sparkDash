import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CostPage } from "./CostPage";
import { setLocale } from "../../i18n";
import { flush, render } from "../../testing/render";
import { bucketKeys } from "../TokensPage/tokenStats";

const today = bucketKeys("day", 1, Date.now())[0];
vi.mock("../../api/client", () => ({
  fetchTokenHistory: vi.fn(async () => ({
    generatedAt: Date.now(),
    retention: { days: 35, hours: 72 },
    firstDay: today,
    firstHour: null,
    hour: [],
    day: [{ t: today, sparkId: "s1", port: 8000, modelId: "local", promptTokens: 1000, completionTokens: 200, cachedTokens: 0 }],
  })),
}));
vi.mock("../../api/llmTokenClient", () => ({ fetchLlmTokenTotals: vi.fn(async () => ({ series: [] })) }));
vi.mock("../../api/costClient", () => ({
  fetchModelPrices: vi.fn(async () => ({
    source: "fixture",
    models: [{ id: "hosted-model", provider: "test", mode: "chat", inputCostPerToken: 0.0000003, outputCostPerToken: 0.0000125, cacheReadCostPerToken: null, cacheWriteCostPerToken: null, maxInputTokens: 128000, maxOutputTokens: null }],
  })),
}));

beforeEach(async () => {
  localStorage.clear();
  await setLocale("en");
});
afterEach(async () => {
  await act(() => setLocale("en"));
  localStorage.clear();
});

it("switches the Cost compare page to Chinese while prices keep their USD digits", async () => {
  localStorage.setItem("sparkdash.cost.model", "hosted-model");
  const { container } = render(<CostPage />);
  await flush();
  expect(container.querySelector("h1")?.textContent).toBe("Cost compare");
  expect(container.textContent).toContain("$0.3 / 1M in · $12.5 / 1M out");
  await act(() => setLocale("zh-CN"));
  expect(container.querySelector("h1")?.textContent).toBe("成本对比");
  expect(container.querySelector("#cp-about-title")?.textContent?.trim()).toBe("计价方式");
  expect(container.textContent).toContain("输入 $0.3 / 1M · 输出 $12.5 / 1M");
  expect(container.textContent).toContain("128k 上下文");
  await act(() => setLocale("en"));
  expect(container.querySelector("h1")?.textContent).toBe("Cost compare");
});

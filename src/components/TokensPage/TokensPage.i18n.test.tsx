import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TokensPage } from "./TokensPage";
import { setLocale } from "../../i18n";
import { flush, render } from "../../testing/render";
import { makeSpark } from "../../testing/fixtures";
import { bucketKeys } from "./tokenStats";

const days = bucketKeys("day", 3, Date.now());
const row = (t: string, sparkId: string) => ({ t, sparkId, port: 8000, modelId: "local-model", promptTokens: 1000, completionTokens: 200, cachedTokens: 400 });
vi.mock("../../api/client", () => ({
  fetchTokenHistory: vi.fn(async () => ({
    generatedAt: Date.now(),
    retention: { days: 35, hours: 72 },
    firstDay: days[0],
    firstHour: null,
    hour: [],
    day: [row(days[0], "a"), row(days[1], "b"), row(days[2], "a")],
  })),
  resetTokenTotals: vi.fn(async () => ({ removed: 0 })),
}));
vi.mock("../../api/llmTokenClient", () => ({ fetchLlmTokenTotals: vi.fn(async () => ({ series: [] })) }));

beforeEach(async () => {
  localStorage.clear();
  await setLocale("en");
});
afterEach(async () => {
  await act(() => setLocale("en"));
  localStorage.clear();
});

it("switches the Token totals page, its tables and insights to Chinese and back", async () => {
  const { container } = render(<TokensPage sparks={[makeSpark("a"), makeSpark("b")]} />);
  await flush();
  expect(container.querySelector("h1")?.textContent).toBe("Token totals");
  expect(container.querySelector("#tk-models-title")?.textContent?.trim()).toBe("By model");
  expect(container.textContent).toContain("The prefix cache served 40% of prompt tokens");
  await act(() => setLocale("zh-CN"));
  expect(container.querySelector("h1")?.textContent).toBe("Token 统计");
  expect(container.querySelector("#tk-models-title")?.textContent?.trim()).toBe("按模型");
  expect(container.textContent).toContain("前缀缓存命中了 40% 的提示词 Token");
  expect([...container.querySelectorAll("th")].map((th) => th.textContent)).toContain("提供的模型");
  // Day buckets use Chinese month names instead of "7 Oct".
  expect(container.textContent).toMatch(/\d+月\d+日/);
  await act(() => setLocale("en"));
  expect(container.querySelector("h1")?.textContent).toBe("Token totals");
});

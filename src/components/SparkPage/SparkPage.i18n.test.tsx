import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, render } from "../../testing/render";
import { makeSpark } from "../../testing/fixtures";
import { setLocale } from "../../i18n";

// Panels owned by other pages' translations stay out of this test.
vi.mock("./LlmPanel", () => ({ LlmPanel: () => null }));
vi.mock("./LlmModelsPanel", () => ({ LlmModelsPanel: () => null }));
vi.mock("../../api/client", () => ({
  getUnitHistory: vi.fn(() => Promise.resolve({ enabled: false })),
  getGpuHistory: vi.fn(() => Promise.reject(new Error("offline"))),
  updateSpark: vi.fn(),
  refreshSparkMetric: vi.fn(),
  addLlmPort: vi.fn(),
  removeLlmPort: vi.fn(),
  updateDisabledDevices: vi.fn(),
  updateDisabledInterfaces: vi.fn(),
  shutdownSpark: vi.fn(),
  wakeSpark: vi.fn(),
  cancelComfyJob: vi.fn(),
}));

import { SparkPage } from "./SparkPage";

const buttonTexts = () => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim());
const panelTitles = () => [...document.querySelectorAll(".panel-title")].map((el) => el.textContent?.trim());

beforeEach(async () => {
  localStorage.clear();
  await setLocale("en");
});
afterEach(async () => {
  await act(() => setLocale("en"));
  localStorage.clear();
});

describe("SparkPage in Simplified Chinese", () => {
  it("switches the header actions, panel titles and history panel both ways", async () => {
    render(<SparkPage spark={makeSpark()} temperatureUnit="celsius" metricsHistory onEdit={() => {}} onNavigate={() => {}} />);
    await flush();
    expect(buttonTexts()).toContain("← Overview");
    expect(buttonTexts()).toContain("Shut down");
    expect(panelTitles()).toEqual(expect.arrayContaining(["Network", "Storage"]));
    expect(document.body.textContent).toContain("Metrics history is off on the server");

    await act(() => setLocale("zh-CN"));
    expect(buttonTexts()).toContain("← 总览");
    expect(buttonTexts()).toContain("关机");
    expect(buttonTexts()).toContain("编辑");
    expect(panelTitles()).toEqual(expect.arrayContaining(["网络", "存储"]));
    expect(document.querySelector(".sp-hist .panel-title")?.textContent).toContain("历史 · 最近 1 小时");
    expect(document.body.textContent).toContain("服务器未开启指标历史");
    // Product names and the Spark's own name are not translated.
    expect(document.querySelector("h2")?.textContent).toBe("Spark spark-1");

    await act(() => setLocale("en"));
    expect(buttonTexts()).toContain("Shut down");
    expect(document.querySelector(".sp-hist .panel-title")?.textContent).toContain("History · last hour");
  });
});

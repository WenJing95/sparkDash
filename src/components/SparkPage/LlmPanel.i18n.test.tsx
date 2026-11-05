import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n";
import { makeSpark } from "../../testing/fixtures";
import { render } from "../../testing/render";
import { LlmPanel } from "./LlmPanel";

vi.mock("./LlmTokenTotals", () => ({ LlmTokenTotals: () => null }));
vi.mock("./LlmDailyChart", () => ({ LlmDailyChart: () => null }));
vi.mock("./LlmTrendChart", () => ({ LlmTrendChart: () => null }));

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const tileLabels = () => [...document.querySelectorAll(".sp-tile")].map((el) => el.querySelector("span")?.textContent);

beforeEach(async () => {
  await setLocale("en");
});
afterEach(async () => {
  await act(() => setLocale("en"));
  localStorage.clear();
});

it("switches the LLM panel labels to Chinese and back, keeping model and engine names", async () => {
  const llm = { ...makeSpark().metrics.llm[0], backend: "tensorfold" as const, slotsActive: 3, slotsTotal: 0 };
  const { container } = render(<LlmPanel llm={llm} sparkId="fixture" llmPort={8888} />);
  expect(tileLabels()).toContain("Slots");
  expect(button("Settings")).toBeTruthy();

  await act(() => setLocale("zh-CN"));
  expect(tileLabels()).toContain("槽位");
  expect(tileLabels()).toContain("上下文");
  expect(button("设置")).toBeTruthy();
  expect(button("工具调用评测")).toBeTruthy();
  expect(container.textContent).toContain("3 个运行中");
  expect(container.textContent).toContain("TensorFold · :8888");
  if (llm.modelId) expect(container.textContent).toContain(llm.modelId);

  await act(() => setLocale("en"));
  expect(tileLabels()).toContain("Slots");
  expect(container.textContent).toContain("3 running");
});

it("retranslates the port validation message in the settings form", async () => {
  const llm = { ...makeSpark().metrics.llm[0], backend: "tensorfold" as const };
  render(<LlmPanel llm={llm} sparkId="fixture" llmPort={8888} />);
  act(() => button("Settings")!.click());
  const input = document.querySelector<HTMLInputElement>('input[type="number"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, "99999");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.querySelector(".sp-error")?.textContent).toBe("Enter an integer between 1 and 65535");
  await act(() => setLocale("zh-CN"));
  expect(document.querySelector(".sp-error")?.textContent).toBe("请输入 1 到 65535 之间的整数");
  expect(button("取消")).toBeTruthy();
});

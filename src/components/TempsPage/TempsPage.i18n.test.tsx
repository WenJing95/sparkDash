import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TempsPage } from "./TempsPage";
import { setLocale } from "../../i18n";
import { flush, render } from "../../testing/render";
import { makeSpark } from "../../testing/fixtures";

vi.mock("../../api/client", () => ({
  getGpuHistory: vi.fn(() => Promise.resolve({ t: [1, 2], u: [1, 1], c: [60, 61], p: [null, null] })),
}));

beforeEach(async () => {
  localStorage.clear();
  await setLocale("en");
});
afterEach(async () => {
  await act(() => setLocale("en"));
  localStorage.clear();
});

it("switches the Temps page heading and range buttons to Chinese and back", async () => {
  const { container } = render(<TempsPage sparks={[makeSpark("a")]} />);
  await flush();
  const buttons = () => [...container.querySelectorAll(".seg button")].map((b) => b.textContent);
  expect(container.querySelector("h1")?.textContent).toBe("Temps");
  expect(buttons()).toEqual(["Last 24 h", "Last 7 d"]);
  await act(() => setLocale("zh-CN"));
  expect(container.querySelector("h1")?.textContent).toBe("温度");
  expect(buttons()).toEqual(["最近 24 小时", "最近 7 天"]);
  expect(container.querySelector(".tp-card__now")?.textContent).toMatch(/^当前 \d+°C$/);
  await act(() => setLocale("en"));
  expect(container.querySelector("h1")?.textContent).toBe("Temps");
});

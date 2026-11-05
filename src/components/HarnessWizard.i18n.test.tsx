import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fetchOccupancyHelpers } from "../api/client";
import { HarnessWizard } from "./HarnessWizard";
import { setLocale } from "../i18n";
import { flush, render } from "../testing/render";

vi.mock("../api/client", () => ({
  fetchOccupancyHelpers: vi.fn(),
  saveOccupancyHelpers: vi.fn(),
  deleteOccupancyHelper: vi.fn(),
  checkOccupancyHelper: vi.fn(),
}));

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text);
const alertText = () => document.querySelector('[role="alert"]')?.textContent;

afterEach(async () => {
  await act(() => setLocale("en"));
});

it("shows the wizard in Chinese and re-translates its validation message", async () => {
  vi.mocked(fetchOccupancyHelpers).mockResolvedValue({ helpers: [] });
  render(<HarnessWizard open onClose={() => {}} sparks={[{ id: "a", name: "a", llmPorts: [8000] }]} />);
  await flush();
  act(() => button("Next")!.click());
  expect(alertText()).toBe("Pick at least one harness");
  await act(() => setLocale("zh-CN"));
  expect(document.querySelector("#harness-title")?.textContent).toBe("Harness 会话");
  expect(document.body.textContent).toContain("第 1 步，共 5 步：选择 Harness");
  expect(alertText()).toBe("请至少选择一个 Harness");
  expect(button("下一步")).toBeDefined();
});

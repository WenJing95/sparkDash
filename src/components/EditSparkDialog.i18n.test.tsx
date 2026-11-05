import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchSparks } from "../api/client";
import { EditSparkDialog } from "./EditSparkDialog";
import { setLocale } from "../i18n";
import { flush, render } from "../testing/render";

vi.mock("../api/client", () => ({
  deleteSpark: vi.fn(),
  fetchSparks: vi.fn(),
  setSparkPassword: vi.fn(),
  testSpark: vi.fn(),
  testSparkConfig: vi.fn(),
  updateSpark: vi.fn(),
  fetchGpuClock: vi.fn(() => Promise.resolve({ supported: false, reason: "" })),
  setGpuClock: vi.fn(),
  resetGpuClock: vi.fn(),
}));

const title = () => document.querySelector("#edit-spark-title")?.textContent?.trim();
const buttonText = () => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim());

beforeEach(() => {
  vi.mocked(fetchSparks).mockResolvedValue({
    sparks: [{ id: "lab", name: "Lab", lanIp: "192.168.1.50", isLocal: false, ssh: { host: "192.168.1.50", user: "u", auth: "key", port: 22 } }],
  } as Awaited<ReturnType<typeof fetchSparks>>);
});
afterEach(async () => {
  await act(() => setLocale("en"));
});

it("shows the Edit dialog in Chinese, including the GPU clock section", async () => {
  render(<EditSparkDialog open sparkId="lab" onClose={() => {}} onSaved={() => {}} />);
  await flush();
  await flush();
  expect(title()).toBe("Edit Spark");
  await act(() => setLocale("zh-CN"));
  expect(title()).toBe("编辑 Spark");
  expect(buttonText()).toEqual(expect.arrayContaining(["删除", "测试", "取消", "保存"]));
  expect(document.body.textContent).toContain("GPU 频率上限");
  expect(document.body.textContent).toContain("此设备不支持。");
});

it("keeps a local not-found message in the current language", async () => {
  render(<EditSparkDialog open sparkId="missing" onClose={() => {}} onSaved={() => {}} />);
  await flush();
  await flush();
  expect(document.querySelector(".modal-sheet__error")?.textContent).toBe("Spark not found");
  await act(() => setLocale("zh-CN"));
  expect(document.querySelector(".modal-sheet__error")?.textContent).toBe("未找到该 Spark");
});

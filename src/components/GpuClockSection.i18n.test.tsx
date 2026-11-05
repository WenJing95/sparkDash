import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { fetchGpuClock } from "../api/client";
import type { GpuClockStatus } from "../api/types";
import { GpuClockSection } from "./GpuClockSection";
import { setLocale } from "../i18n";
import { flush, render } from "../testing/render";

vi.mock("../api/client", () => ({
  fetchGpuClock: vi.fn(),
  fetchGpuClockCommand: vi.fn(),
  setGpuClock: vi.fn(),
  resetGpuClock: vi.fn(),
}));

const status: GpuClockStatus = {
  supported: true,
  hwMaxMHz: 3003,
  capMHz: 2100,
  sudo: "yes",
  persistKind: "unit",
  service: { installed: true, clocks: "0,2100", enabled: "enabled", active: null },
  cron: { installed: false, clocks: null, failed: false },
};

afterEach(async () => {
  await act(() => setLocale("en"));
});

it("shows the GPU clock cap in Chinese and keeps commands unchanged", async () => {
  vi.mocked(fetchGpuClock).mockResolvedValue(status);
  render(<GpuClockSection sparkId="lab" />);
  await flush();
  const now = () => document.querySelector('[data-testid="gpu-clock-now"]')?.textContent;
  expect(now()).toBe("Capped at 2100 MHz (GPU maximum 3003 MHz) · boot service enabled (0,2100 MHz)");
  await act(() => setLocale("zh-CN"));
  expect(now()).toBe("频率上限：2100 MHz（GPU 最高 3003 MHz） · 开机服务已启用（0,2100 MHz）");
  const labels = [...document.querySelectorAll("button")].map((b) => b.textContent);
  expect(labels).toEqual(expect.arrayContaining(["应用", "取消限制"]));
  expect(document.body.textContent).toContain("nvidia-smi -lgc 0,MAX");
  await act(() => setLocale("en"));
  expect(now()).toBe("Capped at 2100 MHz (GPU maximum 3003 MHz) · boot service enabled (0,2100 MHz)");
});

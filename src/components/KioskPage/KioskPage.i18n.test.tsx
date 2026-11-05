import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SparkSnapshot } from "../../api/types";
import { setLocale } from "../../i18n";
import { makeSpark } from "../../testing/fixtures";
import { cleanupRenders, flush, render } from "../../testing/render";
import { KioskPage } from "./KioskPage";

let sparks: SparkSnapshot[] = [];

vi.mock("../../hooks/useSnapshot", () => ({
  useSnapshot: () => ({ sparks, connected: true, lastValidSnapshotAt: Date.now(), refreshInterval: 2_000, serverAlerts: null }),
}));

vi.mock("../../api/client", () => ({
  fetchSettings: () => Promise.resolve({ temperatureUnit: "celsius", alertsEnabled: false, hideWorkers: false, timeZone: null }),
  fetchFleetEnergy: () => Promise.resolve({ estimated: true, energy24hKwh: 7.86, outputTokens24h: 951_451 }),
  getUnitHistory: () => Promise.resolve({ enabled: false }),
}));

beforeEach(async () => {
  window.history.replaceState(null, "", "/kiosk");
  await setLocale("en");
});
afterEach(async () => {
  cleanupRenders();
  await act(() => setLocale("en"));
  localStorage.clear();
});

it("switches the kiosk wall to Chinese and keeps the offline reason as sent", async () => {
  const off = makeSpark("b");
  off.online = false;
  off.offlineReason = "SSH timed out";
  sparks = [makeSpark("a"), off];
  const { container } = render(<KioskPage />);
  await flush();
  const head = () => container.querySelector(".kiosk-head")!.textContent!;
  expect(head()).toContain("hottest GPU");
  expect(document.title).toBe("sparkDash · Kiosk");

  await act(() => setLocale("zh-CN"));
  expect(head()).toContain("最高 GPU 温度");
  expect(document.title).toBe("sparkDash · 大屏模式");
  const card = container.querySelector(".kiosk-card.is-offline")!;
  expect(card.textContent).toContain("离线");
  expect(card.textContent).toContain("SSH timed out");
  expect(card.getAttribute("aria-label")).toBe("Spark b，离线");

  await act(() => setLocale("en"));
  expect(head()).toContain("hottest GPU");
});

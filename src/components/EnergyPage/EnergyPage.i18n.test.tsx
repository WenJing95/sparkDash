import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EnergyPage } from "./EnergyPage";
import { setLocale } from "../../i18n";
import { flush, render } from "../../testing/render";
import { makeSpark } from "../../testing/fixtures";

const HOUR = 3_600_000;
const now = Math.floor(Date.now() / HOUR) * HOUR;
const hourly = Array.from({ length: 6 }, (_, i) => ({
  t: now - (6 - i) * HOUR,
  nodeWh: { a: 100 + i, b: 50 },
  nodeCoverageMs: { a: HOUR, b: HOUR },
  avgWatts: 150 + i,
  fleetEnergyWh: 150 + i,
  fleetCoverageMs: HOUR,
  outputTokens: 1000,
  coveredOutputTokens: 1000,
}));
vi.mock("../../api/client", () => ({
  fetchEnergyHistory: vi.fn(async () => ({ estimated: true, membershipChanged: false, generatedAt: Date.now(), retentionMs: 31 * 24 * HOUR, nodeIds: ["a", "b"], hourly })),
  fetchFleetEnergy: vi.fn(async () => null),
  clearFleetEnergy: vi.fn(async () => ({ removed: 0 })),
  fetchMonthlyEnergy: vi.fn(async () => ({ estimated: true, generatedAt: Date.now(), foldedThroughMs: 0, months: [] })),
  fetchRestartAvailable: vi.fn(async () => ({ available: false })),
  restartServer: vi.fn(),
}));

beforeEach(async () => {
  localStorage.clear();
  await setLocale("en");
});
afterEach(async () => {
  await act(() => setLocale("en"));
  localStorage.clear();
});

it("switches the Fleet energy page and its monthly history to Chinese and back", async () => {
  const { container } = render(<EnergyPage sparks={[makeSpark("a"), makeSpark("b")]} settings={null} />);
  await flush();
  await flush();
  expect(container.querySelector("h1")?.textContent).toBe("Fleet energy");
  expect(container.querySelector("#en-h-nodes")?.textContent).toBe("By node");
  expect(container.textContent).toContain("Spark a uses the most energy");
  await act(() => setLocale("zh-CN"));
  expect(container.querySelector("h1")?.textContent).toBe("集群能耗");
  expect(container.querySelector("#en-h-nodes")?.textContent).toBe("按节点");
  expect(container.querySelector("#en-h-monthly")?.textContent).toBe("每月历史");
  expect(container.textContent).toContain("Spark a 能耗最高");
  await act(() => setLocale("en"));
  expect(container.querySelector("h1")?.textContent).toBe("Fleet energy");
});

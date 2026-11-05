import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActivityEvent } from "../../api/types";
import { setLocale } from "../../i18n";
import { cleanupRenders, flush, render } from "../../testing/render";
import { ActivityPage } from "./ActivityPage";

const events: ActivityEvent[] = [
  { id: 2, ts: Date.now() - 60_000, type: "gpu.throttle.thermal", severity: "warn", sparkId: "a", sparkName: "Alpha", message: "Alpha GPU throttled at 91 C" },
];

vi.mock("../../api/client", () => ({
  fetchEventsPage: () => Promise.resolve({ events, oldestId: 2 }),
  fetchEvents: () => Promise.resolve([]),
  clearEvents: () => Promise.resolve({ removed: 0 }),
}));

beforeEach(async () => {
  await setLocale("en");
});
afterEach(async () => {
  cleanupRenders();
  await act(() => setLocale("en"));
  localStorage.clear();
});

it("switches the Activity page to Chinese and keeps event messages as sent", async () => {
  const { container } = render(<ActivityPage sparks={[]} />);
  await flush();
  const heading = () => container.querySelector("h1")?.textContent;
  const tag = () => container.querySelector(".ac-row__tag")?.textContent;
  expect(heading()).toBe("Activity");
  expect(tag()).toBe("Thermal throttle");
  expect(container.querySelector(".ac-count")?.textContent).toBe("Showing 1 of 1 loaded events");

  await act(() => setLocale("zh-CN"));
  expect(heading()).toBe("活动");
  expect(tag()).toBe("过热降频");
  expect(container.querySelector(".ac-day__head")?.textContent).toContain("今天");
  expect(container.querySelector(".ac-count")?.textContent).toBe("已加载 1 条事件，显示 1 条");
  expect(container.querySelector(".ac-row__msg")?.textContent).toBe("Alpha GPU throttled at 91 C");

  await act(() => setLocale("en"));
  expect(heading()).toBe("Activity");
});

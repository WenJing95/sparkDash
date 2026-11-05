import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AlertsDialog } from "./AlertsDialog";
import type { AlertsConfig } from "../api/types";
import { setLocale } from "../i18n";
import { flush, render } from "../testing/render";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

const config: AlertsConfig = {
  enabled: true,
  repeatIntervalMin: 0,
  rules: [{ id: "offline", source: "strip", name: "Unit offline", description: "d", defaults: { enabled: true, forSec: 60 }, overrides: {} }],
  channels: [
    { id: "ch_1", name: "Phone", type: "ntfy", url: "http://ntfy.lan…opic", hasUrl: true, enabled: true, minSeverity: "warning", status: { lastSentAt: null, lastError: "HTTP 403", lastErrorAt: 1 } },
  ],
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await act(() => setLocale("en"));
});

it("shows the alert dialog in Chinese and keeps server text as received", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === "/api/alerts" ? json({ enabled: true, active: [], pending: [], recent: [] }) : json(config))));
  render(<AlertsDialog open onClose={() => {}} onSettingsSaved={() => {}} />);
  await flush();
  await flush();
  const heading = () => document.querySelector(".modal-sheet__title")?.textContent?.trim();
  expect(heading()).toBe("Alert notifications");
  await act(() => setLocale("zh-CN"));
  expect(heading()).toBe("告警通知");
  expect(document.body.textContent).toContain("通知渠道");
  expect(document.body.textContent).toContain("上次发送失败：HTTP 403");
  expect(document.body.textContent).toContain("Unit offline");
  await act(() => setLocale("en"));
  expect(heading()).toBe("Alert notifications");
});

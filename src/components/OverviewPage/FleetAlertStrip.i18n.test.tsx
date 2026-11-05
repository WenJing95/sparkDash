import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { FleetAlertStrip } from "./FleetAlertStrip";
import { setLocale } from "../../i18n";
import { render } from "../../testing/render";
import { makeSpark } from "../../testing/fixtures";
import type { AlertInstance, SparkSnapshot } from "../../api/types";

afterEach(async () => {
  await act(() => setLocale("en"));
  localStorage.clear();
});

function thermal(id: string): SparkSnapshot {
  const s = makeSpark(id);
  s.metrics.gpu = {
    ...s.metrics.gpu!,
    temperature: 88,
    throttle: { active: true, reason: "thermal", thermal: true, hwSlowdown: false, powerCap: false, detail: "HW thermal slowdown", smClockMHz: 1200, smClockPct: 40 },
  } as SparkSnapshot["metrics"]["gpu"];
  return s;
}

const healthAlert = {
  key: "c:memory",
  ruleId: "memory",
  ruleName: "Unified memory low",
  unitId: "c",
  unitName: "C",
  severity: "warning",
  state: "firing",
  label: "Unified memory is running low",
  summary: "2.8 GB available of 122 GB.",
  startsAt: Date.now(),
  firingAt: Date.now(),
} as AlertInstance;

const rows = () => [...document.querySelectorAll(".ov-alert__text")].map((el) => el.textContent);

it("words live exceptions in Chinese, keeps the driver reason and server-only alert text as reported", async () => {
  await setLocale("zh-CN");
  render(
    <FleetAlertStrip
      sparks={[thermal("b"), makeSpark("c")]}
      alertsEnabled
      serverAlerts={[{ ...healthAlert, key: "b:throttle", ruleId: "throttle", unitId: "b", unitName: "B", label: "is thermal throttling", summary: "x", severity: "critical" }, healthAlert]}
      temperatureUnit="fahrenheit"
    />
  );
  expect(rows()).toEqual([
    "Spark b 因过热降频。HW thermal slowdown · GPU 温度 190°F · SM 频率 1.2 GHz（最高频率的 40%） · 已持续 0 分钟",
    "C Unified memory is running low。2.8 GB available of 122 GB. · 已持续 0 分钟",
  ]);
  await act(() => setLocale("en"));
  expect(rows()[0]).toBe("Spark b is thermal throttling.HW thermal slowdown · GPU at 190°F · SM clock 1.2 GHz (40% of max) · 0m active");
});

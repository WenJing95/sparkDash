import { act } from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { OverviewPage } from "./OverviewPage";
import { setLocale } from "../../i18n";
import { render } from "../../testing/render";
import { makeSpark } from "../../testing/fixtures";

const off = { decode: false, power: false, memory: false, tokens: false };

beforeEach(async () => {
  await setLocale("en");
});
afterEach(async () => {
  await act(() => setLocale("en"));
  localStorage.clear();
});

it("switches the Overview title, search and alert strip to Chinese and back", async () => {
  const { container } = render(
    <OverviewPage
      sparks={[makeSpark("a", false), makeSpark("b")]}
      showFleetEnergy={false}
      showLlmTokenTotals={false}
      showActivityFeed={false}
      showFleetExceptions
      showOverviewSearch
      kpis={off}
    />
  );
  expect(container.querySelector("h1")?.textContent).toBe("Overview");
  expect(container.querySelector(".ov-alert__text")?.textContent).toBe("Spark a Host unreachable.0m active");

  await act(() => setLocale("zh-CN"));
  expect(container.querySelector("h1")?.textContent).toBe("总览");
  expect(container.querySelector<HTMLInputElement>(".ov-search input")?.placeholder).toBe("搜索设备（最多 12 台）");
  expect(container.querySelector(".ov-alert__text")?.textContent).toBe("Spark a 主机不可达。已持续 0 分钟");
  expect(container.querySelector(".ov-alert button")?.textContent).toBe("打开 Spark a");

  await act(() => setLocale("en"));
  expect(container.querySelector("h1")?.textContent).toBe("Overview");
});

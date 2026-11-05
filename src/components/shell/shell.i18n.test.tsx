import { act } from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AppSidebar } from "./AppSidebar";
import { MobileTabBar } from "./MobileTabBar";
import { CommandPalette } from "./CommandPalette";
import { setLocale } from "../../i18n";
import { makeSpark } from "../../testing/fixtures";
import { render } from "../../testing/render";

beforeEach(async () => {
  await setLocale("en");
});
afterEach(async () => {
  await act(() => setLocale("en"));
  localStorage.clear();
});

const names = (root: ParentNode) => [...root.querySelectorAll(".rail-item__name")].map((el) => el.textContent?.trim());

it("switches the sidebar page names and status words to Chinese and back", async () => {
  const { container } = render(
    <AppSidebar
      sparks={[makeSpark("a"), makeSpark("b", false)]}
      activeId="a"
      onSelect={() => {}}
      onAdd={() => {}}
      onOpenSettings={() => {}}
      onOpenSearch={() => {}}
      onSelectBench={() => {}}
      connected
      refreshInterval={2000}
    />
  );
  expect(names(container)).toContain("Token totals");
  expect(container.querySelector(".rail-conn")?.textContent).toBe("Live · 2 s poll");
  await act(() => setLocale("zh-CN"));
  const zh = names(container);
  for (const page of ["总览", "Token 统计", "成本对比", "集群能耗", "温度", "活动", "演示", "大屏模式", "设置"]) {
    expect(zh).toContain(page);
  }
  expect(container.querySelector('nav[aria-label="设备"]')).not.toBeNull();
  expect(container.querySelector(".rail-conn")?.textContent).toBe("实时 · 每 2 秒轮询");
  expect(container.textContent).toContain("离线");
  await act(() => setLocale("en"));
  expect(names(container)).toContain("Overview");
});

it("shows the command palette and mobile tab bar in Chinese", async () => {
  await setLocale("zh-CN");
  render(<CommandPalette open onClose={() => {}} commands={[]} />);
  expect(document.querySelector<HTMLInputElement>(".palette input")?.placeholder).toBe("跳转到 Spark、执行操作、打开设置…");
  expect(document.querySelector(".palette__empty")?.textContent).toBe("没有与“”匹配的结果。");
  const { container } = render(
    <MobileTabBar sparks={[makeSpark("a")]} activeId={null} onSelect={() => {}} onAdd={() => {}} onOpenSettings={() => {}} />
  );
  const tabs = [...container.querySelectorAll(".tabbar button")].map((b) => b.textContent?.trim());
  expect(tabs).toEqual(["总览", "设备", "统计", "设置"]);
});

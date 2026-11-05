import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { ConnectionBanner } from "./ConnectionBanner";
import { ErrorBanner } from "./ErrorBanner";
import { SNAPSHOT_MALFORMED } from "../../hooks/useSnapshot";
import { setLocale } from "../../i18n";
import { render } from "../../testing/render";

afterEach(async () => {
  await act(() => setLocale("en"));
});

it("translates the connection banner and keeps server error text verbatim", async () => {
  const { container } = render(
    <>
      <ConnectionBanner connected={false} lastValidSnapshotAt={10_000} snapshotError={null} now={25_000} stale={false} />
      <ConnectionBanner connected lastValidSnapshotAt={null} snapshotError={SNAPSHOT_MALFORMED} now={0} stale />
      <ErrorBanner message="upstream said no" onDismiss={() => {}} />
    </>
  );
  await act(() => setLocale("zh-CN"));
  expect(container.textContent).toContain("实时监控数据已断开，正在显示 15s 前的数据。");
  expect(container.textContent).toContain("服务器发送的监控数据格式错误。");
  expect(container.querySelector('[aria-label="关闭错误提示"]')?.textContent).toBe("关闭");
  expect(container.textContent).toContain("upstream said no");
  await act(() => setLocale("en"));
  expect(container.textContent).toContain("Live telemetry disconnected. Showing data from 15s ago.");
});

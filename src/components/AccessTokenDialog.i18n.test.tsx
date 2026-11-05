import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { AccessTokenDialog } from "./AccessTokenDialog";
import { setLocale } from "../i18n";
import { render } from "../testing/render";

afterEach(async () => {
  await act(() => setLocale("en"));
});

it("shows the access token dialog in Chinese and keeps the variable name", async () => {
  render(<AccessTokenDialog open reason="manual" onClose={() => {}} />);
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog().textContent).toContain("Access token");
  await act(() => setLocale("zh-CN"));
  expect(dialog().textContent).toContain("访问令牌");
  expect(dialog().textContent).toContain("SPARKDASH_TOKEN");
  const labels = [...dialog().querySelectorAll("button")].map((b) => b.textContent);
  expect(labels).toEqual(["取消", "保存"]);
});

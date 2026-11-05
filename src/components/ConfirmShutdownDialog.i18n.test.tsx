import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { ConfirmShutdownDialog } from "./ConfirmShutdownDialog";
import { setLocale } from "../i18n";
import { render } from "../testing/render";

afterEach(async () => {
  await act(() => setLocale("en"));
  localStorage.clear();
});

it("renders the shutdown confirmation in Chinese and keeps the typed phrase as is", async () => {
  await setLocale("zh-CN");
  render(<ConfirmShutdownDialog open onClose={() => {}} onConfirm={() => {}} title="spark-01" description="" />);
  expect(document.querySelector(".modal-sheet__title")?.textContent?.trim()).toBe("危险操作：spark-01");
  const label = document.querySelector(".field label");
  expect(label?.textContent).toBe("输入 poweroff 以确认");
  expect(label?.querySelector("b.mono")?.textContent).toBe("poweroff");
  const buttons = [...document.querySelectorAll(".modal-sheet__footer button")].map((b) => b.textContent?.trim());
  expect(buttons).toEqual(["取消", "关机"]);
  await act(() => setLocale("en"));
  expect(document.querySelector(".field label")?.textContent).toBe("Type poweroff to confirm");
  expect(document.querySelector(".modal-sheet__title")?.textContent?.trim()).toBe("Danger zone — spark-01");
});

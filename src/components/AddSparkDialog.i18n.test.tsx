import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AddSparkDialog } from "./AddSparkDialog";
import { setLocale } from "../i18n";
import { render } from "../testing/render";

vi.mock("../api/client", () => ({ addSpark: vi.fn(), testSparkConfig: vi.fn() }));

const title = () => document.querySelector("#add-spark-title")?.textContent?.trim();
const buttonText = () => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim());

afterEach(async () => {
  await act(() => setLocale("en"));
});

it("shows the Add dialog in Chinese and switches back", async () => {
  render(<AddSparkDialog open onClose={() => {}} onAdded={() => {}} />);
  expect(title()).toBe("Add Spark/GPU Host");
  await act(() => setLocale("zh-CN"));
  expect(title()).toBe("添加 Spark/GPU 主机");
  expect(buttonText()).toContain("取消");
  expect(buttonText()).toContain("下一步：角色");
  expect(document.querySelector('label[for="add-spark-lan-ip"]')?.textContent).toBe("局域网 IP（必填）");
  await act(() => setLocale("en"));
  expect(buttonText()).toContain("Next: Role");
});

import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "../../testing/render";
import type { ShareCardModel } from "./benchShareCard";
import { BenchCopyButton } from "./BenchCopyButton";
import { canCopyImages } from "./shareImage";
import { setLocale } from "../../i18n";

vi.mock("./shareImage", () => ({
  copyTextOnly: vi.fn(async () => {}),
  copyCardImage: vi.fn(async () => "copied"),
  renderCardObjectUrl: vi.fn(async () => "blob:card"),
  canCopyImages: vi.fn(() => false),
}));

const card = { host: "spark-38bd", generatedAt: 0 } as ShareCardModel;
const items = () => [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent?.trim());

beforeEach(async () => {
  await setLocale("en");
  vi.mocked(canCopyImages).mockReturnValue(false);
});
afterEach(async () => {
  await act(() => setLocale("en"));
});

it("shows the copy control, its menu and the card preview in Chinese and back", async () => {
  const { container } = render(
    <BenchCopyButton text="summary" buildCard={() => card} kind="decode" shareImage onError={() => {}} />
  );
  const label = () => container.querySelector("button")?.textContent?.trim();
  expect(label()).toBe("Copy results");

  await act(() => setLocale("zh-CN"));
  expect(label()).toBe("复制结果");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click());
  expect(items()).toEqual(["复制为文本", "显示卡片", "下载 PNG"]);

  const show = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === "显示卡片")!;
  await act(async () => show.click());
  expect(document.querySelector(".card-preview__head h2")?.textContent).toBe("分享卡片");
  expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("基准测试分享卡片");

  await act(() => setLocale("en"));
  expect(document.querySelector(".card-preview__head h2")?.textContent).toBe("Share card");
  expect(label()).toBe("Card shown");
});

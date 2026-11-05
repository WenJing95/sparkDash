import { act } from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { SparkSnapshot } from "../../api/types";
import { setLocale } from "../../i18n";
import { makeSpark } from "../../testing/fixtures";
import { cleanupRenders, flush, render } from "../../testing/render";
import { TerminalCard } from "./TerminalCard";
import { ShowcaseView } from "./ShowcaseView";

beforeEach(async () => {
  await setLocale("en");
});
afterEach(async () => {
  cleanupRenders();
  await act(() => setLocale("en"));
  localStorage.clear();
});

it("switches the Showcase page and its offline notice to Chinese", async () => {
  const off = { ...makeSpark("a"), online: false } as SparkSnapshot;
  const { container } = render(<ShowcaseView sparks={[off]} />);
  await flush();
  const heading = () => container.querySelector("h1")?.textContent;
  expect(heading()).toBe("Showcase");
  expect(container.querySelector(".sc-empty__title")?.textContent).toBe("Spark a is offline");

  await act(() => setLocale("zh-CN"));
  expect(heading()).toBe("演示");
  expect(container.querySelector(".sc-empty__title")?.textContent).toBe("Spark a 已离线");

  await act(() => setLocale("en"));
  expect(heading()).toBe("Showcase");
});

it("translates terminal status words but keeps the model's output and errors as sent", async () => {
  const { container } = render(
    <TerminalCard label="Write a poem" status="completed" liveTokPerSec={0} peakTokPerSec={0} content="Roses" reasoning="" error="upstream 502" />
  );
  await act(() => setLocale("zh-CN"));
  expect(container.querySelector(".showcase-term__status")?.textContent).toBe("已完成");
  expect(container.querySelector(".showcase-term__answer")?.textContent).toBe("Roses");
  expect(container.querySelector(".showcase-term__error")?.textContent).toBe("[error] upstream 502");
});

import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fetchLaunchers = vi.fn();
vi.mock("../../api/client", () => ({
  fetchLaunchers: (...a: unknown[]) => fetchLaunchers(...a),
  runLauncher: vi.fn(),
  reorderLaunchers: vi.fn(),
  removeLauncher: vi.fn(),
  addLauncher: vi.fn(),
  updateLauncher: vi.fn(),
  readLauncherJob: vi.fn(() => new Promise(() => {})),
  cancelLauncherJob: vi.fn(),
}));

import { setLocale } from "../../i18n";
import { _resetLauncherCache } from "../../hooks/launcherCache";
import { makeSpark } from "../../testing/fixtures";
import { flush, render } from "../../testing/render";
import { LlmModelsPanel } from "./LlmModelsPanel";

const button = (root: ParentNode, text: string) => [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

beforeEach(async () => {
  await setLocale("en");
  _resetLauncherCache();
});
afterEach(async () => {
  await act(() => setLocale("en"));
  localStorage.clear();
});

it("shows the models list and its confirmations in Chinese, keeping script names", async () => {
  fetchLaunchers.mockResolvedValue({
    launchers: [{ id: "a", name: "Alpha", dir: "/m", startScript: "start.sh", stopScript: "stop.sh", port: 8000, notes: "" }],
    job: null,
    statuses: { a: "stopped" },
  });
  const { container } = render(<LlmModelsPanel spark={makeSpark("s1")} />);
  await flush();
  expect(button(container, "Add model")).toBeTruthy();
  await act(() => setLocale("zh-CN"));
  expect(button(container, "添加模型")).toBeTruthy();
  expect(button(container, "启动")).toBeTruthy();
  act(() => button(container, "停止")!.click());
  expect(container.textContent).toContain("运行 stop.sh？");
  await act(() => setLocale("en"));
  expect(container.textContent).toContain("Run stop.sh?");
});

it("translates the add-model dialog and its local validation", async () => {
  fetchLaunchers.mockResolvedValue({ launchers: [], job: null, statuses: {} });
  const { container } = render(<LlmModelsPanel spark={makeSpark("s1")} />);
  await flush();
  await act(() => setLocale("zh-CN"));
  expect(container.textContent).toContain("start.sh");
  act(() => button(container, "添加第一个模型")!.click());
  await flush();
  expect(document.querySelector(".modal-sheet__title")?.textContent).toBe("添加模型");
  await act(async () => document.querySelector<HTMLButtonElement>(".modal-sheet button[type=\"submit\"]")!.click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("请为模型命名");
  await act(() => setLocale("en"));
  expect(document.querySelector(".modal-sheet__title")?.textContent).toBe("Add a model");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Give the model a name");
});

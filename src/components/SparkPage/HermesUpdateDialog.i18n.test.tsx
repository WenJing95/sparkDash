import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fetchHermesUpdates = vi.fn();
vi.mock("../../api/client", () => ({
  fetchHermesUpdates: (...a: unknown[]) => fetchHermesUpdates(...a),
  updateHermes: vi.fn(),
}));

import { setLocale } from "../../i18n";
import { closeHermesUpdateDialog, openHermesUpdateDialog } from "../../hooks/useHermesUpdateDialog";
import { flush, render } from "../../testing/render";
import { HermesUpdateDialog } from "./HermesUpdateDialog";

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

beforeEach(async () => {
  await setLocale("en");
});
afterEach(async () => {
  act(() => closeHermesUpdateDialog());
  await act(() => setLocale("en"));
  localStorage.clear();
});

it("switches the Hermes update dialog to Chinese, keeping the command and commit titles", async () => {
  fetchHermesUpdates.mockResolvedValue({
    success: true,
    view: "commits",
    release: null,
    releaseError: null,
    installedVersion: "0.20.0",
    pending: { count: 2, headSha: null, commits: [{ sha: "abcdef1234", title: "fix: tool call parsing" }, { sha: "1234abcdef", title: "docs" }] },
  });
  render(<HermesUpdateDialog />);
  act(() => openHermesUpdateDialog({ sparkId: "s1", sparkName: "spark-a", currentVersion: "0.20.0" }));
  await flush();
  expect(document.querySelector("#hermes-update-dialog-title")?.textContent).toBe("Update Hermes Agent");
  expect(document.body.textContent).toContain("2 commits behind main");

  await act(() => setLocale("zh-CN"));
  expect(document.querySelector("#hermes-update-dialog-title")?.textContent).toBe("更新 Hermes Agent");
  expect(button("立即更新")).toBeTruthy();
  expect(document.body.textContent).toContain("落后 main 2 个提交");
  expect(document.body.textContent).toContain("将通过 SSH 在 spark-a 上运行 hermes update。");
  expect(document.body.textContent).toContain("fix: tool call parsing");

  await act(() => setLocale("en"));
  expect(document.body.textContent).toContain("Runs hermes update on spark-a via SSH.");
});

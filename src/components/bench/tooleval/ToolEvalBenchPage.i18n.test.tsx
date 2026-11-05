import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ToolEvalRun } from "../../../api/types";
import { setLocale } from "../../../i18n";
import { makeSpark } from "../../../testing/fixtures";
import { flush, render } from "../../../testing/render";
import type { Followed } from "./hooks";
import { ConfigForm } from "./ConfigForm";
import { toolNotes } from "./format";
import { LiveRun } from "./LiveRun";
import { emptyState, validateState } from "./options";
import { normalizeToolResult } from "./normalize";
import { ToolEvalBenchPage } from "./ToolEvalBenchPage";
import { ToolResult } from "./ToolResult";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")].map((b) => b.textContent?.trim());
const tabs = () => [...document.querySelectorAll('[role="tab"]')].map((b) => b.textContent?.trim());

const run = (extra: Partial<ToolEvalRun> = {}): ToolEvalRun => ({
  id: "r1",
  sparkId: "spark-1",
  type: "tool-eval",
  typeLabel: "Tool Eval",
  status: "failed",
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_060_000,
  exitCode: 2,
  label: "",
  port: 8888,
  model: "qwen3",
  baseUrl: "http://127.0.0.1:8888",
  command: "tool-eval-bench --json",
  options: {},
  summary: null,
  resultCached: false,
  ...extra,
});

beforeEach(async () => {
  localStorage.clear();
  await setLocale("en");
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await act(() => setLocale("en"));
  localStorage.clear();
});

it("switches the mounted Tool Eval page both ways and keeps the picked template", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/api/tool-eval/spec")) return json({ groups: [], args: [], backends: [], categories: [], types: {}, install: { extras: [] } });
    if (url.endsWith("/status")) return json({ reachable: true, installed: true, version: "tool-eval-bench 1.2.3", path: "/usr/bin/tool-eval-bench", uv: "uv", python: null, pythonVersion: null, workDir: null, error: null });
    if (url.includes("/runs")) return json({ runs: [], active: null });
    if (url.endsWith("/preview")) return json({ command: "tool-eval-bench --short --seed 42" });
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<ToolEvalBenchPage type="tool-eval" spark={makeSpark()} />);
  for (let i = 0; i < 6; i += 1) await flush();

  expect(tabs()).toContain("Configure and run");
  expect(tabs()).toContain("History (0)");
  const short = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent?.includes("Short run"))!;
  await act(async () => short.click());
  expect(short.getAttribute("aria-checked")).toBe("true");

  await act(() => setLocale("zh-CN"));
  expect(tabs()).toContain("配置与运行");
  expect(tabs()).toContain("历史记录（0）");
  expect(buttons()).toContain("开始评测");
  const shortZh = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent?.includes("简短运行"))!;
  expect(shortZh.getAttribute("aria-checked")).toBe("true");
  expect(shortZh.textContent).toContain("15 个场景");
  expect(document.querySelector(".te-runcard h2")?.textContent).toBe("命令");
  // The installed tool's version string is shown as reported.
  expect(document.querySelector(".te-status")?.textContent).toContain("1.2.3");

  await act(() => setLocale("en"));
  expect(tabs()).toContain("Configure and run");
  expect(buttons()).toContain("Start evaluation");
});

it("translates live-run feedback while keeping raw tool output", async () => {
  const followed: Followed = {
    run: run(),
    job: null,
    lines: [{ seq: 1, stream: "err", text: "Excluding TC-07 from scoring: no network" } as Followed["lines"][number]],
    events: [],
    partial: "",
    progress: null,
    noLive: false,
  };
  const noop = () => {};
  render(<LiveRun followed={followed} polling={false} pollError={null} actionError={null} scenarioMode onStop={noop} onStopWatching={noop} onAttach={noop} onRefresh={noop} onDismiss={noop} onViewResult={noop} />);
  expect(document.body.textContent).toContain("The run failed (exit code 2)");
  expect(document.body.textContent).toContain("TC-07 was left out of the score");
  await act(() => setLocale("zh-CN"));
  expect(document.body.textContent).toContain("运行失败（退出码 2）");
  expect(document.body.textContent).toContain("工具未将 TC-07 计入得分");
  expect(document.body.textContent).toContain("Excluding TC-07 from scoring: no network");
  expect(buttons()).toContain("关闭");
});

it("translates the result headline and tiers", async () => {
  const data = normalizeToolResult({ final_score: 92, scores: { category_scores: { A: 90 }, scenario_results: [{ scenario_id: "TC-01", status: "pass" }] } })!;
  render(<ToolResult data={data} raw={{}} />);
  expect(document.body.textContent).toContain("Final score");
  expect(document.body.textContent).toContain("Excellent");
  await act(() => setLocale("zh-CN"));
  expect(document.body.textContent).toContain("最终得分");
  expect(document.body.textContent).toContain("优秀");
  expect(document.body.textContent).toContain("工具选择");
});

it("translates known server options, keeps unknown ones and choice values as sent", async () => {
  const spec = {
    groups: [{ id: "sampling", label: "Sampling", help: "How the model generates its answers." }, { id: "throughput", label: "Throughput benchmark", help: "Prompt processing and generation speed (llama-benchy style)." }],
    args: [
      { name: "seed", flag: "--seed", kind: "int", group: "sampling", label: "Seed", help: "Random seed passed to the server for reproducible sampling.", min: 0, max: 10 },
      { name: "brand-new", flag: "--brand-new", kind: "bool", group: "sampling", label: "Brand new option", help: "Added by a newer server." },
      { name: "benchy-latency-mode", flag: "--benchy-latency-mode", kind: "choice", group: "throughput", label: "Latency mode", help: "How latency is measured (default: generation).", choices: ["api", "generation", "none"], default: "generation" },
    ],
    backends: [],
    categories: [],
    types: {},
    install: { extras: [] },
  } as unknown as Parameters<typeof ConfigForm>[0]["spec"];
  const state = { ...emptyState("tool-eval"), values: { seed: "99" } };
  const errors = validateState(spec, "tool-eval", state);
  render(<ConfigForm spec={spec} type="tool-eval" spark={makeSpark()} state={state} onChange={() => {}} apiKey="" onApiKey={() => {}} fieldErrors={errors.fields} formErrors={[]} />);
  expect(document.querySelector('label[for="te-f-seed"]')?.textContent).toContain("Seed");
  expect(errors.fields.seed).toBe("Seed must be at most 10");

  await act(() => setLocale("zh-CN"));
  expect(document.body.textContent).toContain("采样");
  expect(document.querySelector('label[for="te-f-seed"]')?.textContent).toContain("随机种子");
  expect(document.body.textContent).toContain("Brand new option");
  expect(document.body.textContent).toContain("Added by a newer server.");
  const select = document.querySelector<HTMLSelectElement>("#te-f-benchy-latency-mode")!;
  expect([...select.options].map((o) => o.textContent)).toEqual(["默认（生成）", "API", "生成", "无"]);
  expect([...select.options].map((o) => o.value)).toEqual(["", "api", "generation", "none"]);
  const { i18n } = await import("../../../i18n");
  expect(validateState(spec, "tool-eval", state, i18n.getFixedT("zh-CN", "toolEval")).fields.seed).toBe("“随机种子”不能大于 10");
});

it("uses full-width parentheses around scenario ids in Chinese notes", async () => {
  await setLocale("zh-CN");
  const { i18n } = await import("../../../i18n");
  const notes = toolNotes([{ text: "tool_choice not supported" }, { text: "Excluding TC-45 from scoring: x" }], i18n.getFixedT("zh-CN", "toolEval"));
  expect(notes[0].text).toContain("（TC-45）");
  expect(toolNotes([{ text: "tool_choice not supported" }, { text: "Excluding TC-45 from scoring: x" }])[0].text).toContain("score (TC-45).");
});

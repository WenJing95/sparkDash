import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  checkOccupancyHelper,
  deleteOccupancyHelper,
  fetchOccupancyHelpers,
  saveOccupancyHelpers,
} from "../api/client";
import type { OccupancyCheck, OccupancyHelper, OccupancyHelperInput, OccupancyRoute } from "../api/types";
import { useModalPresence } from "../hooks/useModalPresence";
import { XIcon } from "./ui/icons";

const HARNESSES = [
  { id: "openclaw", label: "OpenClaw" },
  { id: "opencode", label: "OpenCode" },
  { id: "omp", label: "oh-my-pi" },
  { id: "hermes", label: "Hermes" },
  { id: "dsh", label: "DeepSeek Harness" },
] as const;

export interface HarnessSparkOption {
  id: string;
  name: string;
  llmPorts: number[];
}

interface HarnessWizardProps {
  open: boolean;
  onClose: () => void;
  sparks: HarnessSparkOption[];
  sparkId?: string;
}

interface RouteDraft {
  harness: string;
  sparkId: string;
  port: string;
  cwdPrefix: string;
}

interface Draft {
  id?: string;
  label: string;
  url: string;
  token: string;
  clearToken: boolean;
  enabled: boolean;
  harnesses: string[];
  routes: RouteDraft[];
}

const STEPS = ["harnesses", "connection", "routes", "check", "review"] as const;

function stepLabel(t: TFunction<"harness">, step: (typeof STEPS)[number]): string {
  if (step === "connection") return t("steps.connection");
  if (step === "routes") return t("steps.routes");
  if (step === "check") return t("steps.check");
  if (step === "review") return t("steps.review");
  return t("steps.harnesses");
}

/** Dashboard-side problems, kept as codes so the message follows a language switch. */
type LocalProblem = "urlScheme" | "urlCredentials" | "urlHost" | "urlMissing" | "pickHarness" | "routePort";

/** Known helper coverage values are translated; anything else is shown as the helper sent it. */
function coverageText(t: TFunction<"harness">, coverage: string): string {
  if (coverage === "supported") return t("check.coverage.supported");
  if (coverage === "unsupported") return t("check.coverage.unsupported");
  if (coverage === "unavailable") return t("check.coverage.unavailable");
  if (coverage === "partial") return t("check.coverage.partial");
  return coverage;
}

function problemText(t: TFunction<"harness">, problem: LocalProblem): string {
  switch (problem) {
    case "urlScheme": return t("errors.urlScheme");
    case "urlCredentials": return t("errors.urlCredentials");
    case "urlHost": return t("errors.urlHost");
    case "urlMissing": return t("errors.urlMissing");
    case "pickHarness": return t("errors.pickHarness");
    case "routePort": return t("errors.routePort");
  }
}

function emptyDraft(): Draft {
  return {
    label: "",
    url: "http://127.0.0.1:8790/occupancy",
    token: "",
    clearToken: false,
    enabled: true,
    harnesses: [],
    routes: [],
  };
}

function draftFromHelper(helper: OccupancyHelper): Draft {
  return {
    id: helper.id,
    label: helper.label,
    url: helper.url,
    token: "",
    clearToken: false,
    enabled: helper.enabled,
    harnesses: [...helper.harnesses],
    routes: helper.routes.map((route) => ({
      harness: route.harness,
      sparkId: route.sparkId,
      port: String(route.port),
      cwdPrefix: route.cwdPrefix || "",
    })),
  };
}

function preferredSpark(sparks: HarnessSparkOption[], sparkId?: string) {
  return sparks.find((spark) => spark.id === sparkId) || sparks[0];
}

function withRoutes(draft: Draft, sparks: HarnessSparkOption[], sparkId?: string): Draft {
  const spark = preferredSpark(sparks, sparkId);
  const routes = draft.routes.filter((route) => draft.harnesses.includes(route.harness));
  for (const harness of draft.harnesses) {
    if (routes.some((route) => route.harness === harness)) continue;
    routes.push({
      harness,
      sparkId: spark?.id || "",
      port: spark?.llmPorts?.[0] ? String(spark.llmPorts[0]) : "",
      cwdPrefix: "",
    });
  }
  return { ...draft, routes };
}

function parseUrl(value: string): LocalProblem | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "urlScheme";
    if (parsed.username || parsed.password) return "urlCredentials";
    if (!parsed.hostname) return "urlHost";
    return null;
  } catch {
    return "urlMissing";
  }
}

function snippetFor(harnesses: string[]): string {
  const lines = [
    "OCCUPANCY_BIND=127.0.0.1",
    'OCCUPANCY_TOKEN="$(openssl rand -hex 32)"',
    `OCCUPANCY_ADAPTERS=${harnesses.join(",")}`,
  ];
  if (harnesses.includes("hermes")) lines.push("HERMES_STATE_DIR=$HOME/.hermes");
  if (harnesses.includes("dsh")) lines.push("DSH_WEB_URL=http://127.0.0.1:3080");
  lines.push("node scripts/occupancy-helper/index.js");
  return lines.join(" \\\n");
}

function toInput(helper: OccupancyHelper): OccupancyHelperInput {
  return {
    id: helper.id,
    label: helper.label,
    url: helper.url,
    enabled: helper.enabled,
    harnesses: helper.harnesses,
    routes: helper.routes,
  };
}

function routesFromDraft(routes: RouteDraft[]): OccupancyRoute[] {
  return routes
    .filter((route) => route.sparkId && route.port)
    .map((route) => ({
      harness: route.harness,
      sparkId: route.sparkId,
      port: Number(route.port),
      ...(route.cwdPrefix.trim() ? { cwdPrefix: route.cwdPrefix.trim() } : {}),
    }));
}

export function HarnessWizard({ open, onClose, sparks, sparkId }: HarnessWizardProps) {
  const { mounted, visible } = useModalPresence(open);
  const [helpers, setHelpers] = useState<OccupancyHelper[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [check, setCheck] = useState<OccupancyCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Raw server error text, or a local fallback key when the server gave none. */
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<"load" | "check" | "save" | "remove" | null>(null);
  const [problem, setProblem] = useState<LocalProblem | null>(null);
  const { t } = useTranslation("harness");

  /** Clears every kind of error message. */
  const clearErrors = () => {
    setError(null);
    setFallback(null);
    setProblem(null);
  };
  const fail = (err: unknown, kind: "load" | "check" | "save" | "remove") => {
    const message = err instanceof Error ? err.message : "";
    if (message) setError(message);
    else setFallback(kind);
  };

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setFallback(null);
    setProblem(null);
    fetchOccupancyHelpers()
      .then((data) => {
        const list = data.helpers || [];
        setHelpers(list);
        if (list.length === 0) {
          setDraft(emptyDraft());
          setEditing(true);
          setStep(0);
        } else {
          setEditing(false);
        }
      })
      .catch((err: Error) => fail(err, "load"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    setCheck(null);
    setStep(0);
    load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const sparkName = useMemo(() => new Map(sparks.map((spark) => [spark.id, spark.name])), [sparks]);

  const toggleHarness = (id: string) => {
    setDraft((prev) => {
      const harnesses = prev.harnesses.includes(id)
        ? prev.harnesses.filter((item) => item !== id)
        : [...prev.harnesses, id];
      return { ...prev, harnesses };
    });
  };

  const goNext = () => {
    if (step === 0 && draft.harnesses.length === 0) {
      setProblem("pickHarness");
      return;
    }
    if (step === 1) {
      const urlProblem = parseUrl(draft.url);
      if (urlProblem) {
        setProblem(urlProblem);
        return;
      }
    }
    if (step === 2) {
      const bad = draft.routes.find((route) => route.sparkId && (!Number.isInteger(Number(route.port)) || Number(route.port) < 1 || Number(route.port) > 65535));
      if (bad) {
        setProblem("routePort");
        return;
      }
    }
    clearErrors();
    if (step === 1) setDraft((prev) => withRoutes(prev, sparks, sparkId));
    setStep((prev) => Math.min(prev + 1, STEPS.length - 1));
  };

  const runCheck = async () => {
    setChecking(true);
    clearErrors();
    try {
      const result = await checkOccupancyHelper(draft.url, draft.token);
      setCheck(result);
    } catch (err: unknown) {
      setCheck(null);
      fail(err, "check");
    } finally {
      setChecking(false);
    }
  };

  const save = async (nextHelpers: OccupancyHelperInput[]) => {
    setSaving(true);
    clearErrors();
    try {
      const saved = await saveOccupancyHelpers(nextHelpers);
      setHelpers(saved.helpers);
      setEditing(false);
      setStep(0);
    } catch (err: unknown) {
      fail(err, "save");
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = () => {
    const others = helpers.filter((helper) => helper.id !== draft.id).map(toInput);
    const body: OccupancyHelperInput = {
      ...(draft.id ? { id: draft.id } : {}),
      label: draft.label,
      url: draft.url.trim(),
      enabled: draft.enabled,
      harnesses: draft.harnesses,
      routes: routesFromDraft(draft.routes),
    };
    if (draft.token) body.token = draft.token;
    else if (draft.clearToken) body.token = "";
    return save([...others, body]);
  };

  const setEnabled = (helper: OccupancyHelper, enabled: boolean) => {
    const next = helpers.map((item) => (item.id === helper.id ? { ...toInput(item), enabled } : toInput(item)));
    return save(next);
  };

  const remove = async (helper: OccupancyHelper) => {
    if (!window.confirm(t("list.confirmRemove", { name: helper.label || helper.id }))) return;
    setSaving(true);
    clearErrors();
    try {
      const saved = await deleteOccupancyHelper(helper.id);
      setHelpers(saved.helpers);
    } catch (err: unknown) {
      fail(err, "remove");
    } finally {
      setSaving(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className={`modal-overlay${visible ? " is-open" : ""}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-sheet modal-sheet--wide" role="dialog" aria-modal="true" aria-labelledby="harness-title">
        <div className="modal-sheet__header">
          <h2 className="modal-sheet__title" id="harness-title">{t("title")}</h2>
          <button type="button" className="modal-sheet__close" onClick={onClose} aria-label={t("close")}>
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="modal-sheet__body">
          {loading && <p className="bench-sheet__hint">{t("loading")}</p>}
          {problem && <p role="alert" className="modal-sheet__error">{problemText(t, problem)}</p>}
          {!problem && fallback && (
            <p role="alert" className="modal-sheet__error">
              {fallback === "load"
                ? t("errors.load")
                : fallback === "check"
                  ? t("errors.check")
                  : fallback === "save"
                    ? t("errors.save")
                    : t("errors.remove")}
            </p>
          )}
          {!problem && error && <p role="alert" className="modal-sheet__error">{error}</p>}
          {!loading && !editing && (
            <div className="harness-list">
              {helpers.map((helper) => (
                <article key={helper.id}>
                  <div>
                    <strong>{helper.label || helper.id}</strong>
                    <div className="occupancy-ctx">{helper.enabled ? helper.harnesses.join(", ") : t("list.disabled")}</div>
                  </div>
                  <button type="button" className="btn btn--sm" onClick={() => { setDraft(draftFromHelper(helper)); setEditing(true); setStep(0); setCheck(null); clearErrors(); }}>{t("list.edit")}</button>
                  <button type="button" className="btn btn--sm" onClick={() => void setEnabled(helper, !helper.enabled)} disabled={saving}>
                    {helper.enabled ? t("list.disable") : t("list.enable")}
                  </button>
                  <button type="button" className="btn btn--sm" onClick={() => void remove(helper)} disabled={saving}>{t("list.remove")}</button>
                </article>
              ))}
              <button type="button" className="btn btn--primary" onClick={() => { setDraft(emptyDraft()); setEditing(true); setStep(0); setCheck(null); clearErrors(); }}>
                {t("list.add")}
              </button>
            </div>
          )}
          {!loading && editing && (
            <>
              <p className="bench-sheet__hint">{t("stepOf", { step: step + 1, total: STEPS.length, name: stepLabel(t, STEPS[step]) })}</p>
              {step === 0 && (
                <div className="harness-pick" role="group" aria-label={t("steps.harnesses")}>
                  {HARNESSES.map((harness) => (
                    <label key={harness.id}>
                      <input
                        type="checkbox"
                        aria-label={harness.label}
                        checked={draft.harnesses.includes(harness.id)}
                        onChange={() => toggleHarness(harness.id)}
                      />
                      {harness.label}
                    </label>
                  ))}
                </div>
              )}
              {step === 1 && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    goNext();
                  }}
                >
                  <label className="harness-field">
                    <span>{t("connection.name")}</span>
                    <input aria-label={t("connection.nameAria")} name="helper-name" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
                  </label>
                  <label className="harness-field">
                    <span>{t("connection.url")}</span>
                    <input aria-label={t("connection.url")} name="helper-url" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} />
                  </label>
                  <label className="harness-field">
                    <span>{draft.id ? t("connection.newToken") : t("connection.token")}</span>
                    <input aria-label={t("connection.token")} name="helper-token" type="password" value={draft.token} onChange={(event) => setDraft({ ...draft, token: event.target.value, clearToken: false })} autoComplete="off" />
                  </label>
                  {draft.id && (
                    <label>
                      <input type="checkbox" aria-label={t("connection.clearToken")} checked={draft.clearToken} onChange={(event) => setDraft({ ...draft, clearToken: event.target.checked, token: "" })} />
                      {t("connection.clearToken")}
                    </label>
                  )}
                </form>
              )}
              {step === 2 && (
                <div className="harness-routes">
                  <p className="bench-sheet__hint">{t("routes.help")}</p>
                  {draft.routes.map((route, index) => (
                    <div key={`${route.harness}-${index}`}>
                      <strong>{HARNESSES.find((item) => item.id === route.harness)?.label || route.harness}</strong>
                      <div className="harness-route">
                        <select
                          aria-label={t("routes.sparkAria", { harness: route.harness })}
                          value={route.sparkId}
                          onChange={(event) => {
                            const spark = sparks.find((item) => item.id === event.target.value);
                            setDraft((prev) => {
                              const routes = [...prev.routes];
                              routes[index] = {
                                ...routes[index],
                                sparkId: event.target.value,
                                port: spark?.llmPorts?.[0] ? String(spark.llmPorts[0]) : routes[index].port,
                              };
                              return { ...prev, routes };
                            });
                          }}
                        >
                          <option value="">{t("routes.unassigned")}</option>
                          {sparks.map((spark) => (
                            <option key={spark.id} value={spark.id}>{spark.name}</option>
                          ))}
                        </select>
                        <input
                          aria-label={t("routes.portAria", { harness: route.harness })}
                          inputMode="numeric"
                          value={route.port}
                          onChange={(event) => {
                            const port = event.target.value;
                            setDraft((prev) => {
                              const routes = [...prev.routes];
                              routes[index] = { ...routes[index], port };
                              return { ...prev, routes };
                            });
                          }}
                        />
                      </div>
                      <label className="harness-field">
                        <span>{t("routes.prefix")}</span>
                        <input
                          aria-label={t("routes.prefixAria", { harness: route.harness })}
                          value={route.cwdPrefix}
                          onChange={(event) => {
                            const cwdPrefix = event.target.value;
                            setDraft((prev) => {
                              const routes = [...prev.routes];
                              routes[index] = { ...routes[index], cwdPrefix };
                              return { ...prev, routes };
                            });
                          }}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              )}
              {step === 3 && (
                <div>
                  <button type="button" className="btn btn--primary" onClick={() => void runCheck()} disabled={checking}>
                    {checking ? t("check.checking") : t("check.run")}
                  </button>
                  {check && (
                    <>
                      <p>{t("check.sessions", { n: check.rowCount })}</p>
                      <ul className="harness-check-list">
                        {Object.entries(check.adapters).map(([id, adapter]) => (
                          <li key={id}>{id}: {coverageText(t, adapter.coverage)}{adapter.stale ? t("check.stale") : ""}{adapter.error ? ` (${adapter.error})` : ""}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
              {step === 4 && (
                <div>
                  <p>{t("review.via", { harnesses: draft.harnesses.join(", "), url: draft.url })}</p>
                  <ul className="harness-check-list">
                    {draft.routes.filter((route) => route.sparkId).map((route) => (
                      <li key={`${route.harness}-${route.sparkId}-${route.port}`}>
                        {route.harness} → {sparkName.get(route.sparkId) || route.sparkId}:{route.port}
                        {route.cwdPrefix ? ` ${route.cwdPrefix}` : ""}
                      </li>
                    ))}
                  </ul>
                  <pre className="harness-snippet">{snippetFor(draft.harnesses)}</pre>
                </div>
              )}
            </>
          )}
        </div>
        {editing && (
          <div className="modal-sheet__footer">
            <div className="modal-sheet__footer-actions">
              <button type="button" className="btn btn--ghost" onClick={() => (step === 0 ? setEditing(helpers.length > 0) : setStep((prev) => prev - 1))}>
                {t("back")}
              </button>
              {step < STEPS.length - 1 ? (
                <button type="button" className="btn btn--primary" onClick={goNext}>{t("next")}</button>
              ) : (
                <button type="button" className="btn btn--primary" onClick={() => void saveDraft()} disabled={saving}>
                  {saving ? t("saving") : t("save")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

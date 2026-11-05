import { Fragment, useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { i18n } from "../../i18n";
import { useModalPresence } from "../../hooks/useModalPresence";
import { useOverlayClose } from "../../hooks/useOverlayClose";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { addLauncher, updateLauncher } from "../../api/client";
import type { LlmLauncher } from "../../api/types";
import "../../styles/dialogs.css";

interface LlmLauncherDialogProps {
  open: boolean;
  sparkId: string;
  sparkName: string;
  /** When set, the dialog edits this model instead of adding one. */
  launcher?: LlmLauncher | null;
  onClose: () => void;
  onSaved: (launcher: LlmLauncher) => void;
}

type FormProblem = "name" | "dir" | "dirStart" | "dirSpaces" | "port";

/** Quick client-side check, so obvious mistakes read before a round trip. The server is the authority. */
function formProblem(form: { name: string; dir: string; port: string }): FormProblem | null {
  if (!form.name.trim()) return "name";
  const dir = form.dir.trim();
  if (!dir) return "dir";
  if (!(dir.startsWith("/") || dir.startsWith("~/"))) return "dirStart";
  if (/\s/.test(dir)) return "dirSpaces";
  if (form.port.trim()) {
    const p = Number(form.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return "port";
  }
  return null;
}

function problemText(problem: FormProblem, t: TFunction<"llm">): string {
  switch (problem) {
    case "name": return t("launcherDialog.errorName");
    case "dir": return t("launcherDialog.errorDir");
    case "dirStart": return t("launcherDialog.errorDirStart");
    case "dirSpaces": return t("launcherDialog.errorDirSpaces");
    case "port": return t("launcherDialog.errorPort");
  }
}

/** The form's first problem as a message, or null. Without t it is English. */
export function validateLauncherForm(form: { name: string; dir: string; port: string }, t?: TFunction<"llm">): string | null {
  const problem = formProblem(form);
  return problem ? problemText(problem, t ?? i18n.getFixedT("en", "llm")) : null;
}

const MARK = "\u0000";
const mark = (name: string) => `${MARK}${name}${MARK}`;

/** Places React nodes at the {{name}} slots of a translated message (values passed as mark(name)). */
function withNodes(text: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return text.split(MARK).map((part, i) => (i % 2 ? <Fragment key={i}>{nodes[part]}</Fragment> : part));
}

export function LlmLauncherDialog({ open, sparkId, sparkName, launcher, onClose, onSaved }: LlmLauncherDialogProps) {
  const { t } = useTranslation("llm");
  const titleId = useId();
  const { mounted, visible } = useModalPresence(open);
  const trapRef = useFocusTrap(mounted);
  const [form, setForm] = useState({ name: "", dir: "", startScript: "start.sh", stopScript: "stop.sh", port: "", notes: "" });
  // A local problem stays a code so it follows the language; server errors are shown as sent.
  const [error, setError] = useState<{ problem: FormProblem } | { raw: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const overlayClose = useOverlayClose(onClose, !saving);
  const editing = Boolean(launcher);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setForm(
      launcher
        ? {
            name: launcher.name,
            dir: launcher.dir,
            startScript: launcher.startScript,
            stopScript: launcher.stopScript,
            port: launcher.port != null ? String(launcher.port) : "",
            notes: launcher.notes ?? "",
          }
        : { name: "", dir: "", startScript: "start.sh", stopScript: "stop.sh", port: "", notes: "" }
    );
  }, [open, launcher]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, saving, onClose]);

  if (!mounted) return null;

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    const problem = formProblem(form);
    if (problem) {
      setError({ problem });
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      dir: form.dir.trim(),
      startScript: form.startScript.trim() || "start.sh",
      stopScript: form.stopScript.trim() || "stop.sh",
      port: form.port.trim() ? Number(form.port) : null,
      notes: form.notes.trim(),
    };
    try {
      const res = launcher ? await updateLauncher(sparkId, launcher.id, body) : await addLauncher(sparkId, body);
      onSaved(res.launcher);
      onClose();
    } catch (e) {
      setError({ raw: e instanceof Error ? e.message : String(e) });
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className={`modal-overlay${visible ? " is-open" : ""}`}
      {...overlayClose}
    >
      <div ref={trapRef} className="modal-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-sheet__header">
          <h2 className="modal-sheet__title" id={titleId}>
            {editing ? t("launcherDialog.titleEdit") : t("launcherDialog.titleAdd")}
          </h2>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="modal-sheet__body modal-sheet__stack">
            <p className="modal-sheet__lead">
              {withNodes(t("launcherDialog.lead", { spark: mark("spark") }), { spark: <b>{sparkName}</b> })}
            </p>
            <div className="field">
              <label htmlFor={`${titleId}-name`}>{t("launcherDialog.name")}</label>
              <input
                id={`${titleId}-name`}
                type="text"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="GLM 5.3 EXL3"
                autoComplete="off"
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor={`${titleId}-dir`}>{t("launcherDialog.dir", { spark: sparkName })}</label>
              <input
                id={`${titleId}-dir`}
                type="text"
                className="field-input--mono"
                value={form.dir}
                onChange={(e) => set({ dir: e.target.value })}
                placeholder="/home/you/llms/glm-5.3"
                autoComplete="off"
                spellCheck={false}
              />
              <p className="field-hint">{t("launcherDialog.dirHint")}</p>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor={`${titleId}-start`}>{t("launcherDialog.startScript")}</label>
                <input
                  id={`${titleId}-start`}
                  type="text"
                  className="field-input--mono"
                  value={form.startScript}
                  onChange={(e) => set({ startScript: e.target.value })}
                  spellCheck={false}
                />
              </div>
              <div className="field">
                <label htmlFor={`${titleId}-stop`}>{t("launcherDialog.stopScript")}</label>
                <input
                  id={`${titleId}-stop`}
                  type="text"
                  className="field-input--mono"
                  value={form.stopScript}
                  onChange={(e) => set({ stopScript: e.target.value })}
                  spellCheck={false}
                />
              </div>
              <div className="field field--port">
                <label htmlFor={`${titleId}-port`}>{t("launcherDialog.port")}</label>
                <input
                  id={`${titleId}-port`}
                  type="number"
                  inputMode="numeric"
                  value={form.port}
                  onChange={(e) => set({ port: e.target.value })}
                  placeholder="8888"
                />
              </div>
            </div>
            <p className="field-hint">
              {t("launcherDialog.portHint")}
            </p>
            <div className="field">
              <label htmlFor={`${titleId}-notes`}>{t("launcherDialog.notes")}</label>
              <input
                id={`${titleId}-notes`}
                type="text"
                value={form.notes}
                onChange={(e) => set({ notes: e.target.value })}
                placeholder={t("launcherDialog.notesPlaceholder")}
                autoComplete="off"
              />
            </div>
            {error ? (
              <p className="field-hint is-warn" role="alert">
                {"problem" in error ? problemText(error.problem, t) : error.raw}
              </p>
            ) : null}
          </div>
          <div className="modal-sheet__footer">
            <div className="modal-sheet__footer-actions">
              <button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>
                {t("launcherDialog.cancel")}
              </button>
              <button type="submit" className="btn btn--primary" disabled={saving}>
                {saving ? t("launcherDialog.saving") : editing ? t("launcherDialog.save") : t("launcherDialog.add")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

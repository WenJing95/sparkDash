import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "../../styles/clearmenu.css";

export interface ClearChoice<T = number | string | undefined> {
  id: string;
  label: string;
  /** Confirmation question shown before anything is deleted. */
  ask: string;
  /** Passed to onRun. */
  arg: T;
}

/** Menu button: pick what to delete, confirm in place, then run it. `onRun` resolves to the number removed. */
export function ClearMenu<T>({
  label,
  choices,
  onRun,
  disabled,
  note,
}: {
  label: string;
  choices: readonly ClearChoice<T>[];
  onRun: (arg: T) => Promise<number>;
  disabled?: boolean;
  note?: string;
}) {
  const { t } = useTranslation("common");
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<ClearChoice<T> | null>(null);
  const [busy, setBusy] = useState(false);
  // The outcome is kept as data so the toast follows a language switch; server errors stay verbatim.
  const [msg, setMsg] = useState<{ ok: true; deleted: number } | { ok: false; error: string | null } | null>(null);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
        setPick(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setPick(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!msg) return;
    const timer = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [msg]);

  const run = async () => {
    if (!pick || busy) return;
    setBusy(true);
    try {
      const n = await onRun(pick.arg);
      setMsg({ ok: true, deleted: n });
      setOpen(false);
      setPick(null);
    } catch (err) {
      setMsg({ ok: false, error: err instanceof Error ? err.message : null });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="ac-clear" ref={root}>
      <button
        type="button"
        className="btn btn--sm"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
          setPick(null);
        }}
      >
        {label}
      </button>
      {open ? (
        <div className="ac-clear__menu" role="menu">
          {pick ? (
            <div className="ac-clear__confirm">
              <p>{pick.ask}</p>
              <p className="ac-clear__note">{note ?? t("clear.note")}</p>
              <div className="ac-clear__row">
                <button type="button" className="btn btn--sm" onClick={() => setPick(null)} disabled={busy}>
                  {t("actions.cancel")}
                </button>
                <button type="button" className="btn btn--sm btn--danger" onClick={() => void run()} disabled={busy}>
                  {busy ? t("actions.deleting") : t("actions.delete")}
                </button>
              </div>
            </div>
          ) : (
            choices.map((c) => (
              <button key={c.id} type="button" role="menuitem" className="ac-clear__item" onClick={() => setPick(c)}>
                {c.label}
              </button>
            ))
          )}
        </div>
      ) : null}
      <span className={`ac-toast${msg ? (msg.ok ? " is-ok" : " is-err") : ""}`} role="status" aria-live="polite">
        {msg == null
          ? null
          : msg.ok
            ? msg.deleted === 0
              ? t("clear.nothing")
              : t("clear.deleted", { count: msg.deleted })
            : msg.error ?? t("clear.failed")}
      </span>
    </span>
  );
}

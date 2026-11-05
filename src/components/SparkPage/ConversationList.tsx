import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ConversationRow } from "../../api/types";
import { PlusIcon } from "../ui/icons";

const SOURCE_LABEL: Record<string, string> = {
  openclaw: "OpenClaw",
  hermes: "Hermes",
  opencode: "OpenCode",
  omp: "oh-my-pi",
  dsh: "DeepSeek Harness",
};

interface ConversationListProps {
  conversations: ConversationRow[];
  onAddHarness?: () => void;
  now?: number;
}

function formatSessionAge(lastUsedAt: number | undefined, now: number, t: TFunction<"spark">, locale: string | undefined): string {
  if (lastUsedAt == null || !Number.isFinite(lastUsedAt)) return "—";
  const delta = Math.max(0, now - lastUsedAt);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return t("sessions.now");
  if (delta < hour) return `${Math.floor(delta / minute)}m`;
  if (delta < day) return `${Math.floor(delta / hour)}h`;
  if (delta < 7 * day) return `${Math.floor(delta / day)}d`;
  return new Date(lastUsedAt).toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function occupancyTone(row: ConversationRow, now: number): "generating" | "stalled" | "recent" | "warm" | "idle" {
  if (row.badge === "generating") return "generating";
  if (row.badge === "stalled") return "stalled";
  if (row.lastUsedAt == null || !Number.isFinite(row.lastUsedAt)) return "idle";
  const age = now - row.lastUsedAt;
  if (age < 5 * 60_000) return "recent";
  if (age < 60 * 60_000) return "warm";
  return "idle";
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function contextLabel(row: ConversationRow): string {
  if (row.contextUsed == null) return "";
  const used = `${row.contextApprox ? "~" : ""}${formatTokens(row.contextUsed)}`;
  if (row.contextWindow == null) return used;
  return `${used}/${formatTokens(row.contextWindow)}`;
}

function contextTitle(row: ConversationRow, t: TFunction<"spark">): string {
  const used = row.contextUsed?.toLocaleString();
  const window = row.contextWindow?.toLocaleString();
  const approx = row.contextApprox ? "~" : "";
  if (used && window) return t("sessions.tokensOfWindow", { used: `${approx}${used}`, window });
  if (used) return t("sessions.tokens", { used: `${approx}${used}` });
  if (window) return t("sessions.tokenWindow", { window });
  return "";
}

function stateLabel(row: ConversationRow, now: number, t: TFunction<"spark">, locale: string | undefined): string {
  if (row.badge === "generating") return t("sessions.generating");
  if (row.badge === "stalled") return t("sessions.stalled");
  return formatSessionAge(row.lastUsedAt, now, t, locale);
}

function laneLabel(source: string, agent?: string): string {
  const parts = [SOURCE_LABEL[source] ?? source];
  if (agent) parts.push(agent);
  return parts.join(" · ");
}

function groupConversations(rows: ConversationRow[]) {
  const groups: { key: string; label: string; rows: ConversationRow[] }[] = [];
  const index = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.source}\0${row.agent ?? ""}`;
    const existing = index.get(key);
    if (existing != null) {
      groups[existing].rows.push(row);
      continue;
    }
    index.set(key, groups.length);
    groups.push({ key, label: laneLabel(row.source, row.agent), rows: [row] });
  }
  return groups;
}

export function ConversationList({ conversations, onAddHarness, now = Date.now() }: ConversationListProps) {
  const { t, i18n } = useTranslation("spark");
  const groups = groupConversations(conversations);

  return (
    <div className="occupancy">
      <div className="occupancy-head">
        <span className="occupancy-head-count">{conversations.length}</span>
        <span className="occupancy-head-title">{t("sessions.title")}</span>
        {onAddHarness && (
          <button type="button" title={t("sessions.addHarness")} aria-label={t("sessions.addHarness")} onClick={onAddHarness} className="occupancy-head-add">
            <PlusIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {conversations.length === 0 ? (
        <div className="occupancy-empty">
          <p>{t("sessions.empty")}</p>
          {onAddHarness && (
            <button type="button" onClick={onAddHarness} className="occupancy-add-harness">
              {t("sessions.addHarnessButton")}
            </button>
          )}
        </div>
      ) : (
        <div className="occupancy-list" aria-label={t("sessions.listLabel")}>
          {groups.map((group) => (
            <section key={group.key} className="occupancy-lane">
              <h3 className="occupancy-lane-label">{group.label}</h3>
              <ul className="occupancy-lane-list" aria-label={group.label}>
                {group.rows.map((row) => {
                  const ctx = contextLabel(row);
                  return (
                    <li key={row.id} className={`occupancy-row is-${occupancyTone(row, now)}`} title={row.stale ? t("sessions.staleTitle") : undefined}>
                      <span className="occupancy-dot" aria-hidden="true" />
                      <span className="occupancy-handle" title={row.handle}>{row.handle}</span>
                      <span className="occupancy-ctx" title={ctx ? contextTitle(row, t) : undefined}>{ctx}</span>
                      <span className="occupancy-state">
                        {stateLabel(row, now, t, i18n.resolvedLanguage)}
                        {row.stale ? <span className="occupancy-stale"> {t("sessions.stale")}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

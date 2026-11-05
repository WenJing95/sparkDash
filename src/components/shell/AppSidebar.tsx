import { BenchIcon } from "../bench/BenchIcon";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { AuthMode, SparkSnapshot } from "../../api/types";
import { isWorkerSpark } from "../../api/sparkRole";
import { ACTIVITY_ID, COST_ID, ENERGY_ID, KIOSK_ID, OVERVIEW_ID, SHOWCASE_ID, TEMPS_ID, TOKENS_ID, benchId, idToPath } from "../../constants";
import { BENCH_TYPES, benchBlurb, benchLabel } from "../bench/benchCatalog";
import { BoltIcon, ChevronDownIcon, CoinsIcon, ExpandIcon, GearIcon, GithubIcon, GlobeIcon, GridIcon, ListIcon, PanelLeftIcon, PlusIcon, SearchIcon, TerminalIcon, ThermometerIcon, TokensIcon, XLogoIcon } from "../ui/icons";
import { OpenAccessChip } from "../OpenAccessChip";
import { ThemeSwitch } from "../ThemeSwitch";
import { isThrottling, railSubLabelText } from "./sparkSummary";

interface AppSidebarProps {
  sparks: SparkSnapshot[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onReorder?: (orderedIds: string[]) => void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  /** Benchmark type whose page is showing, if any. */
  benchType?: string | null;
  onSelectBench?: (type: string) => void;
  connected: boolean;
  /** Poll interval in ms for the footer caption. */
  refreshInterval?: number | null;
  /** Server auth posture; an open remote bind shows a gentle note above the credit line. */
  authMode?: AuthMode | null;
  /** Hide the sidebar (a strip with a show button stays behind). */
  onCollapse?: () => void;
}

/**
 * Keyboard drag on the rail: M picks a Spark up. The default Enter/Space start would swallow the
 * very keys that activate the Spark's button, so keyboard users could not open a Spark at all.
 * Once lifted, arrows move it and Enter/Space drop it, Escape cancels.
 */
export const RAIL_KEYBOARD_CODES = {
  start: ["KeyM"],
  cancel: ["Escape"],
  end: ["Space", "Enter"],
};

/** Screen-reader text for the rail's drag and drop, in the UI language (dnd-kit's own defaults are English only). */
function railAccessibility(t: TFunction<"shell">) {
  return {
    screenReaderInstructions: {
      draggable: t("rail.dragInstructions"),
    },
    announcements: {
      onDragStart: ({ active }: { active: { id: string | number } }) => t("rail.dragStart", { id: String(active.id) }),
      onDragOver: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
        over ? t("rail.dragOver", { id: String(active.id), over: String(over.id) }) : t("rail.dragOverNone", { id: String(active.id) }),
      onDragEnd: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
        over ? t("rail.dragEnd", { id: String(active.id), over: String(over.id) }) : t("rail.dragEndNone", { id: String(active.id) }),
      onDragCancel: ({ active }: { active: { id: string | number } }) => t("rail.dragCancel", { id: String(active.id) }),
    },
  };
}

function dotClass(spark: SparkSnapshot): string {
  if (!spark.online) return "sdot sdot--off";
  if (isThrottling(spark)) return "sdot sdot--warn";
  return "sdot";
}

/**
 * Strata exposes explicit activity flags when it has no current decode window.
 * A zero decode rate during either state is not an idle throughput reading, so
 * keep the rail from presenting it as a measured 0.0 tok/s.
 */
function sidebarSubLabel(t: TFunction<"shell">, spark: SparkSnapshot): string {
  if (!spark.online) return railSubLabelText(t, spark);
  if (isWorkerSpark(spark)) return t("rail.worker");
  const llm = Array.isArray(spark.metrics.llm) ? spark.metrics.llm.find((entry) => entry.available) : null;
  if (llm?.backend === "strata" && !(Number.isFinite(llm.generationTps) && llm.generationTps > 0)) {
    if (llm.prefillActive) return t("rail.prefilling");
    if (llm.decodeActive) return t("rail.decoding");
  }
  return railSubLabelText(t, spark);
}

/**
 * A drag ends on pointer-up over the very link that was lifted, and the browser then fires a click on
 * it. dnd-kit stops that click at the document (capture phase), so React's onClick never sees it and
 * the browser follows the link's href on its own. A window-level capture listener runs before dnd-kit's
 * and cancels the default action for a moment after a drop.
 */
const DROP_CLICK_GUARD_MS = 400;
let lastDropAt = 0;
let removeDropGuard: (() => void) | null = null;
export function markRailDrop(now: number = Date.now()) {
  lastDropAt = now;
  removeDropGuard?.();
  if (typeof window === "undefined") return;
  const onClick = (e: Event) => {
    e.preventDefault();
  };
  window.addEventListener("click", onClick, true);
  const timer = window.setTimeout(() => removeDropGuard?.(), DROP_CLICK_GUARD_MS);
  removeDropGuard = () => {
    window.removeEventListener("click", onClick, true);
    window.clearTimeout(timer);
    removeDropGuard = null;
  };
}
export function clickFollowsRailDrop(now: number = Date.now()): boolean {
  return now - lastDropAt < DROP_CLICK_GUARD_MS;
}

/** Plain left-click navigates in-app; modified clicks and the context menu keep normal link behaviour. */
function inApp(go: () => void) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (clickFollowsRailDrop()) {
      e.preventDefault();
      return;
    }
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go();
  };
}

function RailSpark({
  spark,
  isActive,
  onSelect,
}: {
  spark: SparkSnapshot;
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation("shell");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: spark.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined, opacity: isDragging ? 0.6 : 1 }}
      className={`rail-item ${isActive ? "is-active" : ""}`}
    >
      <a
        href={idToPath(spark.id)}
        draggable={false}
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="flex min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent p-0 text-left text-inherit no-underline"
        onClick={inApp(() => onSelect(spark.id))}
        aria-current={isActive ? "page" : undefined}
        aria-roledescription="sortable"
        title={spark.online ? t("rail.dragTitle", { name: spark.name }) : t("rail.dragTitleOffline", { name: spark.name })}
      >
        <i className={dotClass(spark)} aria-hidden />
        <span className="rail-item__name">{spark.name}</span>
      </a>
      <span className="rail-item__sub">{sidebarSubLabel(t, spark)}</span>
    </div>
  );
}

/** Left fleet rail: brand, workspace links, reorderable Spark list, settings and live-link status. */
export function AppSidebar({
  sparks,
  activeId,
  onSelect,
  onAdd,
  onReorder,
  onOpenSettings,
  onOpenSearch,
  benchType = null,
  onSelectBench,
  connected,
  refreshInterval,
  authMode = null,
  onCollapse,
}: AppSidebarProps) {
  const { t } = useTranslation("shell");
  const { t: tb } = useTranslation("benchPages");
  const accessibility = useMemo(() => railAccessibility(t), [t]);
  const [items, setItems] = useState<string[]>(() => sparks.map((s) => s.id));
  const [dragging, setDragging] = useState(false);
  const [benchOpen, setBenchOpen] = useState(() => {
    try {
      return localStorage.getItem("sparkdash.sidebar.benchOpen") !== "0";
    } catch {
      return true;
    }
  });
  const toggleBench = () =>
    setBenchOpen((open) => {
      try {
        localStorage.setItem("sparkdash.sidebar.benchOpen", open ? "0" : "1");
      } catch {
        /* private mode */
      }
      return !open;
    });

  useEffect(() => {
    if (dragging) return;
    setItems(sparks.map((s) => s.id));
  }, [sparks, dragging]);

  const byId = useMemo(() => new Map(sparks.map((s) => [s.id, s])), [sparks]);
  const ordered = items.map((id) => byId.get(id)).filter(Boolean) as SparkSnapshot[];
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: RAIL_KEYBOARD_CODES })
  );
  const canReorder = Boolean(onReorder) && sparks.length > 1;

  const handleDragEnd = (event: DragEndEvent) => {
    markRailDrop();
    setDragging(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.indexOf(String(active.id));
    const to = items.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(items, from, to);
    setItems(next);
    onReorder?.(next);
  };

  return (
    <aside className="app-side" aria-label={t("sidebar.navAria")}>
      <div className="side-head">
        <a
          href={idToPath(OVERVIEW_ID)}
          className="brand"
          aria-label={t("brand.overviewAria")}
          onClick={(e) => {
            // Plain click navigates in-app; modifier clicks and the context menu keep the normal link behaviour.
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onSelect(OVERVIEW_ID);
          }}
        >
          <span className="brand__mark">
            <BoltIcon className="h-[17px] w-[17px]" />
          </span>
          <span>
            spark<span className="brand__dash">Dash</span>
          </span>
        </a>
        {onCollapse ? (
          <button type="button" className="icon-circle side-toggle" onClick={onCollapse} title={t("sidebar.hideTitle")} aria-label={t("sidebar.hide")}>
            <PanelLeftIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <div className="side-tools">
        <button type="button" className="search-trigger" onClick={onOpenSearch} aria-label={t("sidebar.openPalette")}>
          <SearchIcon className="h-4 w-4 shrink-0" />
          <span>{t("sidebar.jumpTo")}</span>
          <span className="kbd">Ctrl K</span>
        </button>
      </div>

      <div className="min-h-0">
        <div className="rail-label">
          <span>{t("sidebar.sparks")}</span>
          <button type="button" onClick={onAdd} title={t("sidebar.addTitle")} aria-label={t("sidebar.addAria")}>
            <PlusIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        {canReorder ? (
          <DndContext
            sensors={sensors}
            accessibility={accessibility}
            collisionDetection={closestCenter}
            onDragStart={() => setDragging(true)}
            onDragEnd={handleDragEnd}
            onDragCancel={() => {
              markRailDrop();
              setDragging(false);
            }}
          >
            <SortableContext items={items} strategy={verticalListSortingStrategy}>
              <nav className="rail-list" aria-label={t("sidebar.sparks")}>
                {ordered.map((s) => (
                  <RailSpark key={s.id} spark={s} isActive={activeId === s.id} onSelect={onSelect} />
                ))}
              </nav>
            </SortableContext>
          </DndContext>
        ) : (
          <nav className="rail-list" aria-label={t("sidebar.sparks")}>
            {sparks.map((s) => (
              <div key={s.id} className={`rail-item ${activeId === s.id ? "is-active" : ""}`}>
                <a
                  href={idToPath(s.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 border-0 bg-transparent p-0 text-left text-inherit no-underline"
                  onClick={inApp(() => onSelect(s.id))}
                  aria-current={activeId === s.id ? "page" : undefined}
                >
                  <i className={dotClass(s)} aria-hidden />
                  <span className="rail-item__name">{s.name}</span>
                </a>
                <span className="rail-item__sub">{sidebarSubLabel(t, s)}</span>
              </div>
            ))}
          </nav>
        )}
        {sparks.length === 0 ? (
          <p className="px-2.5 pt-1 text-xs text-muted">{t("sidebar.empty")}</p>
        ) : null}
      </div>

      <div>
        <div className="rail-label">{t("sidebar.workspace")}</div>
        <nav className="rail-list">
          <a
            href={idToPath(OVERVIEW_ID)}
            className={`rail-item ${activeId === OVERVIEW_ID ? "is-active" : ""}`}
            onClick={inApp(() => onSelect(OVERVIEW_ID))}
            aria-current={activeId === OVERVIEW_ID ? "page" : undefined}
          >
            <GridIcon className="h-4 w-4" />
            <span className="rail-item__name">{t("pages.overview")}</span>
          </a>
          <a
            href={idToPath(TOKENS_ID)}
            className={`rail-item ${activeId === TOKENS_ID ? "is-active" : ""}`}
            onClick={inApp(() => onSelect(TOKENS_ID))}
            aria-current={activeId === TOKENS_ID ? "page" : undefined}
          >
            <TokensIcon className="h-4 w-4" />
            <span className="rail-item__name">{t("pages.tokens")}</span>
          </a>
          <a
            href={idToPath(COST_ID)}
            className={`rail-item ${activeId === COST_ID ? "is-active" : ""}`}
            onClick={inApp(() => onSelect(COST_ID))}
            aria-current={activeId === COST_ID ? "page" : undefined}
          >
            <CoinsIcon className="h-4 w-4" />
            <span className="rail-item__name">{t("pages.cost")}</span>
          </a>
          <a
            href={idToPath(ENERGY_ID)}
            className={`rail-item ${activeId === ENERGY_ID ? "is-active" : ""}`}
            onClick={inApp(() => onSelect(ENERGY_ID))}
            aria-current={activeId === ENERGY_ID ? "page" : undefined}
          >
            <BoltIcon className="h-4 w-4" />
            <span className="rail-item__name">{t("pages.energy")}</span>
          </a>
          <a
            href={idToPath(TEMPS_ID)}
            className={`rail-item ${activeId === TEMPS_ID ? "is-active" : ""}`}
            onClick={inApp(() => onSelect(TEMPS_ID))}
            aria-current={activeId === TEMPS_ID ? "page" : undefined}
          >
            <ThermometerIcon className="h-4 w-4" />
            <span className="rail-item__name">{t("pages.temps")}</span>
          </a>
          <a
            href={idToPath(ACTIVITY_ID)}
            className={`rail-item ${activeId === ACTIVITY_ID ? "is-active" : ""}`}
            onClick={inApp(() => onSelect(ACTIVITY_ID))}
            aria-current={activeId === ACTIVITY_ID ? "page" : undefined}
          >
            <ListIcon className="h-4 w-4" />
            <span className="rail-item__name">{t("pages.activity")}</span>
          </a>
          <a
            href={idToPath(SHOWCASE_ID)}
            className={`rail-item ${activeId === SHOWCASE_ID ? "is-active" : ""}`}
            onClick={inApp(() => onSelect(SHOWCASE_ID))}
            aria-current={activeId === SHOWCASE_ID ? "page" : undefined}
          >
            <TerminalIcon className="h-4 w-4" />
            <span className="rail-item__name">{t("pages.showcase")}</span>
          </a>
          <a href={idToPath(KIOSK_ID)} className="rail-item" title={t("sidebar.kioskTitle")}>
            <ExpandIcon className="h-4 w-4" />
            <span className="rail-item__name">{t("pages.kiosk")}</span>
          </a>
        </nav>
      </div>

      {onSelectBench ? (
        <div>
          <button
            type="button"
            className="rail-label rail-label--toggle"
            onClick={toggleBench}
            aria-expanded={benchOpen || benchType != null}
            aria-controls="rail-benchmarks"
          >
            <span>{t("pages.benchmarks")}</span>
            <ChevronDownIcon className={`h-3 w-3 transition-transform ${benchOpen || benchType != null ? "" : "-rotate-90"}`} />
          </button>
          <nav className="rail-list" id="rail-benchmarks" aria-label={t("pages.benchmarks")} hidden={!(benchOpen || benchType != null)}>
            {BENCH_TYPES.map((b) => (
              <div key={b.id}>
                <a
                  href={idToPath(benchId(b.id))}
                  className={`rail-item rail-item--compact ${benchType === b.id ? "is-active" : ""}`}
                  onClick={inApp(() => onSelectBench(b.id))}
                  aria-current={benchType === b.id ? "page" : undefined}
                  title={benchBlurb(tb, b)}
                >
                  <BenchIcon id={b.id} className="h-3.5 w-3.5" />
                  <span className="rail-item__name">{benchLabel(tb, b)}</span>
                </a>
              </div>
            ))}
          </nav>
        </div>
      ) : null}

      <div className="rail-foot">
        <div className="rail-settings">
          <nav className="rail-list">
            <button type="button" className="rail-item" onClick={onOpenSettings}>
              <GearIcon className="h-4 w-4" />
              <span className="rail-item__name">{t("pages.settings")}</span>
            </button>
          </nav>
          <ThemeSwitch />
        </div>
        <div className="rail-conn" role="status">
          <i className={`sdot ${connected ? "" : "sdot--warn"}`} aria-hidden />
          <span>
            {connected
              ? refreshInterval
                ? t("sidebar.livePoll", { seconds: Math.round(refreshInterval / 100) / 10 })
                : t("sidebar.live")
              : t("sidebar.reconnecting")}
          </span>
        </div>
        <OpenAccessChip authMode={authMode} />
        <div className="rail-credit">
          <span>{t("sidebar.credit")}</span>
          <span className="rail-credit__links">
            <a href="https://mia-ai.net/" target="_blank" rel="noopener noreferrer" title={t("sidebar.website")} aria-label={t("sidebar.website")}>
              <GlobeIcon className="h-3.5 w-3.5" />
            </a>
            <a href="https://github.com/MiaAI-Lab/sparkDash" target="_blank" rel="noopener noreferrer" title={t("sidebar.github")} aria-label={t("sidebar.github")}>
              <GithubIcon className="h-3.5 w-3.5" />
            </a>
            <a href="https://x.com/MiaAI_lab" target="_blank" rel="noopener noreferrer" title={t("sidebar.x")} aria-label={t("sidebar.x")}>
              <XLogoIcon className="h-3 w-3" />
            </a>
          </span>
        </div>
      </div>
    </aside>
  );
}

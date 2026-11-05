import { useState, useEffect } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { SunIcon, SunDimIcon, MoonIcon, MoonStarIcon } from "./ui/icons";

type Theme = "white" | "light" | "dark" | "oled";

const THEME_CYCLE: Theme[] = ["white", "light", "dark", "oled"];

const STORAGE_KEY = "sparkdash-theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if ((stored as Theme | null) && THEME_CYCLE.includes(stored as Theme)) return stored as Theme;
  } catch {
    /* storage blocked (private mode): use the default */
  }
  return "dark";
}

function themeName(t: TFunction<"common">, theme: Theme): string {
  switch (theme) {
    case "white":
      return t("theme.white");
    case "light":
      return t("theme.light");
    case "dark":
      return t("theme.dark");
    default:
      return t("theme.oled");
  }
}

export function ThemeSwitch() {
  const { t } = useTranslation("common");
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage blocked: the theme still applies for this session */
    }
    // The switch can be mounted twice (sidebar and phone bar): tell the other copy.
    window.dispatchEvent(new CustomEvent("sparkdash:set-theme", { detail: theme }));
  }, [theme]);

  const toggle = () =>
    setTheme((current) => {
      const idx = THEME_CYCLE.indexOf(current);
      return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    });

  // The command palette asks for a theme change through a window event.
  useEffect(() => {
    const onCycle = () =>
      setTheme((current) => THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length]);
    // The Settings theme picker announces an explicit choice the same way.
    const onSet = (e: Event) => {
      const next = (e as CustomEvent<Theme>).detail;
      if (THEME_CYCLE.includes(next)) setTheme(next);
    };
    // Another window (e.g. the Showcase) changed the theme: follow it.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue && THEME_CYCLE.includes(e.newValue as Theme)) setTheme(e.newValue as Theme);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("sparkdash:cycle-theme", onCycle);
    window.addEventListener("sparkdash:set-theme", onSet);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("sparkdash:cycle-theme", onCycle);
      window.removeEventListener("sparkdash:set-theme", onSet);
    };
  }, []);

  const Icon =
    theme === "white"
      ? SunIcon
      : theme === "light"
        ? SunDimIcon
        : theme === "dark"
          ? MoonIcon
          : MoonStarIcon;

  return (
    <button
      type="button"
      onClick={toggle}
      className="icon-circle"
      title={t("theme.title", { name: themeName(t, theme) })}
      aria-label={t("theme.switchAria", { name: themeName(t, theme) })}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

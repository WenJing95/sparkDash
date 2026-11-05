import { createInstance, type Resource } from "i18next";
import { initReactI18next } from "react-i18next";

export type Locale = "en" | "zh-CN";
export const LOCALE_STORAGE_KEY = "sparkdash-locale";

export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const tag = value.toLowerCase().replace(/_/g, "-");
  if (tag === "en" || tag.startsWith("en-")) return "en";
  if (tag === "zh" || tag === "zh-cn" || tag === "zh-sg" || tag === "zh-my" || tag === "zh-hans" || tag.startsWith("zh-hans-")) return "zh-CN";
  return null;
}

export function detectLocale(): Locale {
  try {
    const stored = normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY));
    if (stored) return stored;
  } catch { /* Browser storage is optional. */ }
  return normalizeLocale(typeof navigator === "undefined" ? null : navigator.language) ?? "en";
}

// Every src/locales/<language>/<namespace>.json file is bundled. Adding a page
// namespace is adding its two JSON files; English catalogs are the source of truth.
const catalogFiles = import.meta.glob<{ default: Record<string, unknown> }>("../locales/*/*.json", { eager: true });
const resources: Resource = {};
for (const [file, module] of Object.entries(catalogFiles)) {
  const match = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(file);
  if (!match) continue;
  const [, language, namespace] = match;
  (resources[language] ??= {})[namespace] = module.default;
}
const namespaces = Object.keys(resources.en ?? {});

export const i18n = createInstance();
void i18n.use(initReactI18next).init({
  resources,
  lng: detectLocale(),
  fallbackLng: "en",
  supportedLngs: ["en", "zh-CN"],
  load: "currentOnly",
  defaultNS: "settings",
  ns: namespaces,
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  initAsync: false,
});

function updateDocumentLanguage() {
  if (typeof document !== "undefined") document.documentElement.lang = i18n.resolvedLanguage ?? "en";
}
i18n.on("languageChanged", updateDocumentLanguage);
updateDocumentLanguage();

export async function setLocale(locale: Locale): Promise<void> {
  await i18n.changeLanguage(locale);
  try { localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* Switching still works without storage. */ }
}

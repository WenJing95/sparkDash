import assert from "node:assert/strict";
import test from "node:test";
import { flattenCatalog, parseCatalogJson, scanTranslationSource, validateCatalogs } from "../i18n-check.mjs";

function catalogs({ en, zhCN }) {
  return {
    en: { settings: flattenCatalog(en), language: flattenCatalog({ current: "Language" }) },
    "zh-CN": { settings: flattenCatalog(zhCN), language: flattenCatalog({ current: "语言" }) },
  };
}

test("accepts static settings calls and matching interpolation", () => {
  const usages = scanTranslationSource('const { t } = useTranslation("settings"); t("appearance.label", { name: user });', "Settings.tsx");
  assert.deepEqual(validateCatalogs({
    catalogs: catalogs({ en: { appearance: { label: "Hello {{name}}" } }, zhCN: { appearance: { label: "你好 {{name}}" } } }),
    usages,
  }), []);
});

test("reports a key missing from the authoritative English catalog", () => {
  const errors = validateCatalogs({
    catalogs: catalogs({ en: {}, zhCN: { missing: "存在" } }),
    usages: [{ file: "Settings.tsx", namespace: "settings", key: "missing" }],
  });
  assert.match(errors.join("\n"), /missing en\/settings key missing/);
});

test("reports target keys that have no English source", () => {
  const errors = validateCatalogs({
    catalogs: catalogs({ en: { known: "Known" }, zhCN: { known: "已知", extra: "多余" } }),
    usages: [],
  });
  assert.match(errors.join("\n"), /orphan target key extra/);
});

test("reports mismatched interpolation parameters", () => {
  const errors = validateCatalogs({
    catalogs: catalogs({ en: { welcome: "Hi {{name}}" }, zhCN: { welcome: "你好 {{user}}" } }),
    usages: [{ file: "Settings.tsx", namespace: "settings", key: "welcome" }],
  });
  assert.match(errors.join("\n"), /interpolation parameters differ/);
});

test("keeps namespaces from useTranslation bindings", () => {
  const usages = scanTranslationSource('import { useTranslation as translate } from "react-i18next"; const { t: language } = translate("language"); language("current");', "Language.tsx");
  assert.deepEqual(usages, [{ file: "Language.tsx", namespace: "language", key: "current" }]);
});

test("rejects dynamic translation keys and namespaces", () => {
  assert.throws(() => scanTranslationSource('const { t } = useTranslation(namespace); t("key");', "Bad.tsx"), /dynamic or empty/);
  assert.throws(() => scanTranslationSource('useTranslation(namespace).t("key");', "Bad.tsx"), /dynamic or empty/);
  assert.throws(() => scanTranslationSource('const { t } = useTranslation("settings"); t(key);', "Bad.tsx"), /dynamic translation key/);
});

test("accepts a static new namespace then requires its English catalog", () => {
  const usages = scanTranslationSource('const { t } = useTranslation("newNamespace"); t("missing");', "New.tsx");
  assert.deepEqual(usages, [{ file: "New.tsx", namespace: "newNamespace", key: "missing" }]);
  const errors = validateCatalogs({
    catalogs: catalogs({ en: {}, zhCN: {} }),
    usages,
  });
  assert.match(errors.join("\n"), /missing authoritative en\/newNamespace\.json/);
});

test("rejects ambiguous t bindings before a key can be attributed to the wrong namespace", () => {
  const source = 'function settings() { const { t } = useTranslation("settings"); t("missing"); } function language() { const { t } = useTranslation("language"); t("current"); }';
  assert.throws(() => scanTranslationSource(source, "Ambiguous.tsx"), /ambiguous translation binding t/);
});

test("rejects direct i18n.t calls", () => {
  assert.throws(() => scanTranslationSource('i18n.t("missing");', "Bypass.tsx"), /direct i18n\.t/);
});

test("rejects duplicate JSON catalog keys before JSON.parse can overwrite one", () => {
  assert.throws(() => parseCatalogJson('{ "title": "First", "title": "Second" }', "en/settings.json"), /duplicate JSON key title/);
});

test("accepts i18next v4 _one and _other plural forms", () => {
  const errors = validateCatalogs({
    catalogs: catalogs({
      en: { item_one: "{{count}} item", item_other: "{{count}} items" },
      zhCN: { item_one: "{{count}} 项", item_other: "{{count}} 项" },
    }),
    usages: [{ file: "Settings.tsx", namespace: "settings", key: "item" }],
  });
  assert.deepEqual(errors, []);
});

test("binds helper parameters typed TFunction<namespace>", () => {
  const usages = scanTranslationSource('import type { TFunction } from "i18next"; export function label(t: TFunction<"overview">, n: number) { return t("cards.title", { n }); }', "helper.ts");
  assert.deepEqual(usages, [{ file: "helper.ts", namespace: "overview", key: "cards.title" }]);
  const arrow = scanTranslationSource('const f = (tr: TFunction<"common">) => tr("ok");', "arrow.ts");
  assert.deepEqual(arrow, [{ file: "arrow.ts", namespace: "common", key: "ok" }]);
});

test("rejects TFunction parameters that do not name a namespace", () => {
  assert.throws(() => scanTranslationSource('function f(t: TFunction) { return t("x"); }', "Bad.ts"), /must name its namespace/);
});

test("reports English messages that have no translation", () => {
  const errors = validateCatalogs({
    catalogs: catalogs({ en: { title: "Title", unused: "Unused" }, zhCN: { title: "标题" } }),
    usages: [],
  });
  assert.match(errors.join("\n"), /zh-CN\/settings: missing target key unused/);
});

test("reports a target language without a catalog for an English namespace", () => {
  const errors = validateCatalogs({
    catalogs: { en: { settings: flattenCatalog({ a: "A" }) }, "zh-CN": {} },
    usages: [],
  });
  assert.match(errors.join("\n"), /missing catalog for en\/settings\.json/);
});

test("checks <Trans> keys in the namespace of the t it is given", () => {
  const source = 'import { Trans, useTranslation } from "react-i18next"; function A() { const { t } = useTranslation("settings"); return <Trans t={t} i18nKey="note.body" components={{ b: <b /> }} />; }';
  const usages = scanTranslationSource(source, "Note.tsx");
  assert.deepEqual(usages, [{ file: "Note.tsx", namespace: "settings", key: "note.body" }]);
  const errors = validateCatalogs({ catalogs: catalogs({ en: {}, zhCN: {} }), usages });
  assert.match(errors.join("\n"), /missing en\/settings key note\.body/);
});

test("checks a renamed <Trans> and one that names its namespace with ns", () => {
  const renamed = 'import { Trans as T, useTranslation } from "react-i18next"; function A() { const { t: tc } = useTranslation("language"); return <T t={tc} i18nKey={"current"} />; }';
  assert.deepEqual(scanTranslationSource(renamed, "A.tsx"), [{ file: "A.tsx", namespace: "language", key: "current" }]);
  const withNs = 'import { Trans } from "react-i18next"; const x = <Trans ns="settings" i18nKey="a.b" />;';
  assert.deepEqual(scanTranslationSource(withNs, "B.tsx"), [{ file: "B.tsx", namespace: "settings", key: "a.b" }]);
});

test("rejects <Trans> with a dynamic key or no known namespace", () => {
  const head = 'import { Trans, useTranslation } from "react-i18next"; ';
  assert.throws(() => scanTranslationSource(`${head}function A() { const { t } = useTranslation("settings"); return <Trans t={t} i18nKey={key} />; }`, "Bad.tsx"), /static string i18nKey/);
  assert.throws(() => scanTranslationSource(`${head}const x = <Trans i18nKey="a" />;`, "Bad.tsx"), /needs a t=\{t\} or ns=/);
  assert.throws(() => scanTranslationSource(`${head}const x = <Trans t={other} i18nKey="a" />;`, "Bad.tsx"), /translation binding/);
  assert.throws(() => scanTranslationSource(`${head}const x = <Trans ns={name} i18nKey="a" />;`, "Bad.tsx"), /ns must be a static string/);
});

test("ignores a component named Trans that is not from react-i18next", () => {
  assert.deepEqual(scanTranslationSource('import { Trans } from "./mine"; const x = <Trans i18nKey={key} />;', "Mine.tsx"), []);
});

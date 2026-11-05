import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAst } from "rolldown/parseAst";

const SOURCE_LANGUAGE = "en";
const TRANSLATION_FILE = /\.(?:ts|tsx)$/;
const TEST_FILE = /(?:\.test|\.spec)\.(?:ts|tsx)$/;
const INTERPOLATION = /{{\s*([\w.]+)\s*}}/g;
const PLURAL_SUFFIXES = ["one", "other"];

function isNode(value) {
  return value && typeof value === "object" && typeof value.type === "string";
}

function walk(node, visit) {
  if (!isNode(node)) return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
    else walk(value, visit);
  }
}

function literalString(node) {
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : null;
}

function tBinding(declarator) {
  if (declarator.id?.type !== "ObjectPattern") return null;
  for (const property of declarator.id.properties) {
    if (property.type !== "Property" || property.computed) continue;
    if (property.key?.type === "Identifier" && property.key.name === "t" && property.value?.type === "Identifier") {
      return property.value.name;
    }
  }
  return null;
}

function namespaceFromHook(node, file, hookNames) {
  if (node.callee?.type !== "Identifier" || !hookNames.has(node.callee.name)) return null;
  if (node.arguments.length !== 1) {
    throw new Error(`${file}: useTranslation must receive one static namespace`);
  }
  const namespace = literalString(node.arguments[0]);
  if (!namespace) {
    throw new Error(`${file}: dynamic or empty useTranslation namespace`);
  }
  return namespace;
}

function isDirectI18nextCall(node) {
  if (node.callee?.type !== "MemberExpression" || node.callee.object?.type !== "Identifier") return false;
  if (!["i18n", "i18next"].includes(node.callee.object.name)) return false;
  return (node.callee.property?.type === "Identifier" && node.callee.property.name === "t") ||
    literalString(node.callee.property) === "t";
}

function assertNoDefaultValue(call, file) {
  const options = call.arguments[1];
  if (!options) return;
  if (typeof literalString(options) === "string") {
    throw new Error(`${file}: inline translation fallback defaults are not allowed`);
  }
  if (options.type === "ObjectExpression" && options.properties.some((property) =>
    property.type === "Property" && !property.computed &&
    ((property.key.type === "Identifier" && property.key.name === "defaultValue") ||
      literalString(property.key) === "defaultValue"),
  )) {
    throw new Error(`${file}: inline translation fallback defaults are not allowed`);
  }
}

/**
 * Finds static translation calls bound from useTranslation("settings" | "language").
 * Dynamic hook namespaces and keys fail closed so a missing catalog source cannot hide.
 */
export function scanTranslationSource(source, file = "<source>") {
  const ast = parseAst(source, { lang: path.extname(file).slice(1) || "ts" }, file);
  const bindings = new Map();
  const usages = [];
  const hooks = new Map();
  const hookNames = new Set(["useTranslation"]);
  const transNames = new Set();

  walk(ast, (node) => {
    if (node.type !== "ImportDeclaration" || literalString(node.source) !== "react-i18next") return;
    for (const specifier of node.specifiers) {
      if (specifier.type === "ImportSpecifier" && specifier.imported?.name === "useTranslation") {
        hookNames.add(specifier.local.name);
      }
      if (specifier.type === "ImportSpecifier" && specifier.imported?.name === "Trans") {
        transNames.add(specifier.local.name);
      }
    }
  });

  walk(ast, (node) => {
    if (node.type !== "CallExpression") return;
    if (isDirectI18nextCall(node)) throw new Error(`${file}: useTranslation hook is required; direct i18n.t is unsupported`);
    const namespace = namespaceFromHook(node, file, hookNames);
    if (namespace) hooks.set(node.start, namespace);
  });

  walk(ast, (node) => {
    if (node.type !== "VariableDeclarator" || node.init?.type !== "CallExpression") return;
    const namespace = hooks.get(node.init.start);
    if (!namespace) return;
    const binding = tBinding(node);
    if (!binding) throw new Error(`${file}: useTranslation result must destructure t`);
    const existingNamespace = bindings.get(binding);
    if (existingNamespace && existingNamespace !== namespace) {
      throw new Error(`${file}: ambiguous translation binding ${binding} uses both ${existingNamespace} and ${namespace}`);
    }
    bindings.set(binding, namespace);
    hooks.delete(node.init.start);
  });

  if (hooks.size) throw new Error(`${file}: useTranslation result must destructure t`);

  // Helpers outside components receive t from their caller. Annotating the parameter
  // as TFunction<"namespace"> lets their keys be checked like hook-bound calls.
  walk(ast, (node) => {
    if (!["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)) return;
    for (const param of node.params ?? []) {
      const type = param?.type === "Identifier" ? param.typeAnnotation?.typeAnnotation : null;
      if (type?.type !== "TSTypeReference" || type.typeName?.type !== "Identifier" || type.typeName.name !== "TFunction") continue;
      const namespace = literalString(type.typeArguments?.params?.[0]?.literal);
      if (!namespace) throw new Error(`${file}: TFunction parameter ${param.name} must name its namespace, e.g. TFunction<"common">`);
      const existingNamespace = bindings.get(param.name);
      if (existingNamespace && existingNamespace !== namespace) {
        throw new Error(`${file}: ambiguous translation binding ${param.name} uses both ${existingNamespace} and ${namespace}`);
      }
      bindings.set(param.name, namespace);
    }
  });

  walk(ast, (node) => {
    if (node.type !== "CallExpression" || node.callee?.type !== "Identifier") return;
    const namespace = bindings.get(node.callee.name);
    if (!namespace) return;
    const key = literalString(node.arguments[0]);
    if (!key) throw new Error(`${file}: dynamic translation key for ${node.callee.name}()`);
    assertNoDefaultValue(node, file);
    usages.push({ file, namespace, key });
  });

  // <Trans t={t} i18nKey="…"> from react-i18next: the key is checked like a t() call,
  // in the namespace of the t it is given (or its ns="…" when it has no t).
  walk(ast, (node) => {
    if (node.type !== "JSXOpeningElement" || node.name?.type !== "JSXIdentifier" || !transNames.has(node.name.name)) return;
    const attributes = new Map();
    for (const attribute of node.attributes ?? []) {
      if (attribute.type === "JSXAttribute" && attribute.name?.type === "JSXIdentifier") attributes.set(attribute.name.name, attribute.value);
    }
    if (attributes.has("defaults")) throw new Error(`${file}: inline translation fallback defaults are not allowed`);
    const key = jsxStaticString(attributes.get("i18nKey"));
    if (!key) throw new Error(`${file}: <${node.name.name}> needs a static string i18nKey`);
    let namespace = null;
    if (attributes.has("t")) {
      const value = attributes.get("t");
      const expression = value?.type === "JSXExpressionContainer" ? value.expression : null;
      namespace = expression?.type === "Identifier" ? bindings.get(expression.name) ?? null : null;
      if (!namespace) throw new Error(`${file}: <${node.name.name}> t must be a translation binding from useTranslation or a TFunction parameter`);
    } else if (attributes.has("ns")) {
      namespace = jsxStaticString(attributes.get("ns"));
      if (!namespace) throw new Error(`${file}: <${node.name.name}> ns must be a static string`);
    } else {
      throw new Error(`${file}: <${node.name.name}> needs a t={t} or ns="…" attribute to name its namespace`);
    }
    usages.push({ file, namespace, key });
  });

  return usages;
}

/** A JSX attribute value that is a string literal: key="a.b" or key={"a.b"}. */
function jsxStaticString(value) {
  if (!value) return null;
  if (value.type === "JSXExpressionContainer") return literalString(value.expression);
  return literalString(value);
}

export function flattenCatalog(catalog, prefix = "", result = new Map()) {
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new Error(`catalog at ${prefix || "<root>"} must be an object`);
  }
  for (const [key, value] of Object.entries(catalog)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") result.set(fullKey, value);
    else if (value && typeof value === "object" && !Array.isArray(value)) flattenCatalog(value, fullKey, result);
    else throw new Error(`catalog value ${fullKey} must be a string`);
  }
  return result;
}

function jsonPropertyKey(property) {
  if (property.computed) return null;
  if (property.key?.type === "Literal" && typeof property.key.value === "string") return property.key.value;
  return property.key?.type === "Identifier" ? property.key.name : null;
}

/** Parses JSON after detecting duplicate keys that JSON.parse would otherwise overwrite. */
export function parseCatalogJson(source, file = "<catalog>") {
  const ast = parseAst(`(${source})`, { lang: "js" }, file);
  walk(ast, (node) => {
    if (node.type !== "ObjectExpression") return;
    const keys = new Set();
    for (const property of node.properties) {
      if (property.type !== "Property") continue;
      const key = jsonPropertyKey(property);
      if (!key) continue;
      if (keys.has(key)) throw new Error(`${file}: duplicate JSON key ${key}`);
      keys.add(key);
    }
  });
  return JSON.parse(source);
}

export function interpolationParameters(message) {
  const params = new Set();
  let match;
  while ((match = INTERPOLATION.exec(message))) params.add(match[1]);
  INTERPOLATION.lastIndex = 0;
  const withoutInterpolations = message.replace(INTERPOLATION, "");
  if (/\{[^}]*\}/.test(withoutInterpolations)) {
    throw new Error(`ICU-style interpolation is not supported: ${message}`);
  }
  return [...params].sort();
}

function pluralKeys(key, catalog) {
  const keys = PLURAL_SUFFIXES.map((suffix) => `${key}_${suffix}`);
  return keys.some((pluralKey) => catalog.has(pluralKey)) ? keys : [key];
}

function sameParameters(source, target) {
  return JSON.stringify(interpolationParameters(source)) === JSON.stringify(interpolationParameters(target));
}

/** Validates keys that source code wires to t(), and that every English message has a translation in each target language. */
export function validateCatalogs({ catalogs, usages }) {
  const errors = [];
  const sourceCatalogs = catalogs[SOURCE_LANGUAGE] ?? {};

  for (const [language, namespaces] of Object.entries(catalogs)) {
    if (language === SOURCE_LANGUAGE) continue;
    for (const namespace of Object.keys(sourceCatalogs)) {
      if (!namespaces[namespace]) errors.push(`${language}/${namespace}: missing catalog for en/${namespace}.json`);
    }
    for (const [namespace, target] of Object.entries(namespaces)) {
      const source = sourceCatalogs[namespace];
      if (!source) {
        errors.push(`${language}/${namespace}: missing authoritative en catalog`);
        continue;
      }
      for (const key of target.keys()) {
        if (!source.has(key)) errors.push(`${language}/${namespace}: orphan target key ${key}`);
      }
      // Every English message needs a reviewed translation, wired or not, so a page
      // cannot silently fall back to English after its keys are added.
      for (const key of source.keys()) {
        if (!target.has(key)) errors.push(`${language}/${namespace}: missing target key ${key}`);
      }
    }
  }

  for (const usage of usages) {
    const source = sourceCatalogs[usage.namespace];
    if (!source) {
      errors.push(`${usage.file}: missing authoritative en/${usage.namespace}.json`);
      continue;
    }
    const keys = pluralKeys(usage.key, source);
    for (const key of keys) {
      if (!source.has(key)) errors.push(`${usage.file}: missing en/${usage.namespace} key ${key}`);
    }

    for (const [language, namespaces] of Object.entries(catalogs)) {
      if (language === SOURCE_LANGUAGE) continue;
      const target = namespaces[usage.namespace];
      if (!target) {
        errors.push(`${usage.file}: missing ${language}/${usage.namespace}.json`);
        continue;
      }
      for (const key of keys) {
        if (!source.has(key) || !target.has(key)) {
          if (source.has(key)) errors.push(`${usage.file}: missing ${language}/${usage.namespace} key ${key}`);
          continue;
        }
        try {
          if (!sameParameters(source.get(key), target.get(key))) {
            errors.push(`${language}/${usage.namespace} key ${key}: interpolation parameters differ from en`);
          }
        } catch (error) {
          errors.push(`${language}/${usage.namespace} key ${key}: ${error.message}`);
        }
      }
    }
  }

  return errors;
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "testing" || entry.name === "__tests__") continue;
      files.push(...await filesBelow(fullPath));
    } else if (TRANSLATION_FILE.test(entry.name) && !TEST_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function readCatalogs(localesDirectory) {
  const catalogs = {};
  for (const language of await readdir(localesDirectory, { withFileTypes: true })) {
    if (!language.isDirectory()) continue;
    const namespaces = {};
    const languageDirectory = path.join(localesDirectory, language.name);
    for (const file of await readdir(languageDirectory, { withFileTypes: true })) {
      if (!file.isFile() || path.extname(file.name) !== ".json") continue;
      const namespace = path.basename(file.name, ".json");
      const catalogFile = path.join(languageDirectory, file.name);
      namespaces[namespace] = flattenCatalog(parseCatalogJson(await readFile(catalogFile, "utf8"), catalogFile));
    }
    catalogs[language.name] = namespaces;
  }
  return catalogs;
}

export async function checkI18n(root = process.cwd()) {
  const sourceDirectory = path.join(root, "src");
  const localesDirectory = path.join(sourceDirectory, "locales");
  const [catalogs, files] = await Promise.all([readCatalogs(localesDirectory), filesBelow(sourceDirectory)]);
  const usages = [];
  for (const file of files) usages.push(...scanTranslationSource(await readFile(file, "utf8"), path.relative(root, file)));
  return validateCatalogs({ catalogs, usages });
}

async function main() {
  const errors = await checkI18n();
  if (errors.length) throw new Error(`i18n catalog check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  console.log("i18n catalog check passed");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

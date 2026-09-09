import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const localesDir = path.join(process.cwd(), "src/modules/i18n/locales");
const locales = ["ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt", "ru", "zh"];
// Spanish must stay 1:1 with English. Other locales inherit missing keys from en
// at runtime via mergeLocale; they are not required to repeat every key.
const requiredExplicit = new Set(["es"]);
const fallbackLocales = locales.filter((locale) => !requiredExplicit.has(locale));

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return undefined;
}

function collectObjectKeys(node, prefix = "", keys = new Set()) {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    if (!name) continue;
    const key = prefix ? `${prefix}.${name}` : name;
    if (ts.isObjectLiteralExpression(property.initializer)) {
      collectObjectKeys(property.initializer, key, keys);
    } else {
      keys.add(key);
    }
  }
  return keys;
}

function collectMergeOverrides(source) {
  const keys = new Set();
  const declarations = new Map();

  source.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        ts.isObjectLiteralExpression(declaration.initializer)
      ) {
        declarations.set(declaration.name.text, declaration.initializer);
      }
    }
  });

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "mergeLocale" &&
      node.arguments.length >= 2 &&
      (ts.isObjectLiteralExpression(node.arguments[1]) ||
        ts.isIdentifier(node.arguments[1]))
    ) {
      const override = ts.isObjectLiteralExpression(node.arguments[1])
        ? node.arguments[1]
        : declarations.get(node.arguments[1].text);
      if (override) collectObjectKeys(override, "", keys);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return keys;
}

function collectLocaleKeys(source, locale) {
  const keys = collectMergeOverrides(source);

  source.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === locale &&
        declaration.initializer &&
        ts.isObjectLiteralExpression(declaration.initializer)
      ) {
        collectObjectKeys(declaration.initializer, "", keys);
      }
    }
  });

  return keys;
}

function usesEnglishFallback(source) {
  let importsEnglishFallback = false;
  let mergesEnglish = false;

  source.forEachChild((node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "./en" &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      const names = new Set(
        node.importClause.namedBindings.elements.map((element) => element.name.text),
      );
      importsEnglishFallback = names.has("en") && names.has("mergeLocale");
    }
  });

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "mergeLocale" &&
      ts.isIdentifier(node.arguments[0]) &&
      node.arguments[0].text === "en"
    ) {
      mergesEnglish = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return importsEnglishFallback && mergesEnglish;
}

function readSource(fileName) {
  const filePath = path.join(localesDir, fileName);
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

const englishKeys = collectObjectKeys(
  (() => {
    const source = readSource("en.ts");
    let locale;
    source.forEachChild((node) => {
      if (!ts.isVariableStatement(node)) return;
      for (const declaration of node.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === "en" &&
          declaration.initializer &&
          ts.isObjectLiteralExpression(declaration.initializer)
        ) {
          locale = declaration.initializer;
        }
      }
    });
    if (!locale) throw new Error("Could not read the English locale schema");
    return locale;
  })(),
);

const incomplete = [];
const fallbackFailures = [];
const coverage = [];
for (const locale of locales) {
  const source = readSource(`${locale}.ts`);
  const explicit = collectLocaleKeys(source, locale);
  const missing = [...englishKeys].filter((key) => !explicit.has(key));
  if (requiredExplicit.has(locale) && missing.length > 0) {
    incomplete.push([locale, missing]);
  }
  if (fallbackLocales.includes(locale) && !usesEnglishFallback(source)) {
    fallbackFailures.push(locale);
  }
  coverage.push({ locale, explicit: explicit.size, inherited: missing.length });
}

if (incomplete.length > 0) {
  console.error("Required locales still inherit keys from English:");
  for (const [locale, keys] of incomplete) {
    console.error(`- ${locale}: ${keys.length}`);
    for (const key of keys.slice(0, 20)) {
      console.error(`    ${key}`);
    }
    if (keys.length > 20) {
      console.error(`    ... ${keys.length - 20} more`);
    }
  }
  process.exit(1);
}

if (fallbackFailures.length > 0) {
  console.error("Fallback locales must merge directly from the English root:");
  for (const locale of fallbackFailures) console.error(`- ${locale}`);
  process.exit(1);
}

console.log(
  `English has ${englishKeys.size} keys. Required locales (${[...requiredExplicit].join(", ")}) explicitly cover every key.`,
);
for (const { locale, explicit, inherited } of coverage) {
  const inheritedLabel = inherited === 0 ? "no inherited keys" : `${inherited} inherited from English`;
  console.log(`- ${locale}: ${explicit} explicit, ${inheritedLabel}, ${englishKeys.size} effective`);
}

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const localesDir = path.join(process.cwd(), "src/modules/i18n/locales");
const derivedLocales = ["de", "fr", "it", "ja", "ko", "pt", "ru", "zh"];

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
for (const locale of derivedLocales) {
  const explicit = collectMergeOverrides(readSource(`${locale}.ts`));
  const missing = [...englishKeys].filter((key) => !explicit.has(key));
  if (missing.length > 0) incomplete.push([locale, missing]);
}

if (incomplete.length > 0) {
  console.error("Locale keys still inherited from English:");
  for (const [locale, keys] of incomplete) {
    console.error(`- ${locale}: ${keys.length}`);
  }
  process.exit(1);
}

console.log(`All ${derivedLocales.length} derived locales explicitly cover ${englishKeys.size} English keys.`);

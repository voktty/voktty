import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
if (!configPath) throw new Error("tsconfig.json not found");

const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
const sourceFiles = parsed.fileNames.filter((fileName) => {
  const normalized = fileName.replaceAll("\\", "/");
  return (
    normalized.includes("/src/") &&
    !normalized.includes("/modules/i18n/locales/") &&
    !/\.(?:test|spec)\.[jt]sx?$/.test(normalized)
  );
});

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return undefined;
}

function collectLocaleKeys(node, prefix = "", keys = new Set()) {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    if (!name) continue;
    const key = prefix ? `${prefix}.${name}` : name;
    if (ts.isObjectLiteralExpression(property.initializer)) {
      collectLocaleKeys(property.initializer, key, keys);
    } else {
      keys.add(key);
    }
  }
  return keys;
}

const enPath = path.join(process.cwd(), "src/modules/i18n/locales/en.ts");
const enSource = ts.createSourceFile(
  enPath,
  fs.readFileSync(enPath, "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
let localeKeys;
enSource.forEachChild((node) => {
  if (!ts.isVariableStatement(node)) return;
  for (const declaration of node.declarationList.declarations) {
    if (
      ts.isIdentifier(declaration.name) &&
      declaration.name.text === "en" &&
      declaration.initializer &&
      ts.isObjectLiteralExpression(declaration.initializer)
    ) {
      localeKeys = collectLocaleKeys(declaration.initializer);
    }
  }
});

if (!localeKeys) throw new Error("Could not read the English locale schema");

const usages = new Map();
for (const fileName of sourceFiles) {
  const source = ts.createSourceFile(
    fileName,
    fs.readFileSync(fileName, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const translationFunctions = new Set(["t"]);
  source.forEachChild((node) => {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      !node.moduleSpecifier.text.includes("/i18n") ||
      !node.importClause?.namedBindings ||
      !ts.isNamedImports(node.importClause.namedBindings)
    ) {
      return;
    }
    for (const element of node.importClause.namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === "t" || importedName === "translate") {
        translationFunctions.add(element.name.text);
      }
    }
  });
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      translationFunctions.has(node.expression.text) &&
      node.arguments.length > 0 &&
      (ts.isStringLiteral(node.arguments[0]) ||
        ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
    ) {
      const key = node.arguments[0].text;
      const position = source.getLineAndCharacterOfPosition(node.arguments[0].getStart(source));
      const locations = usages.get(key) ?? [];
      locations.push(`${path.relative(process.cwd(), fileName)}:${position.line + 1}`);
      usages.set(key, locations);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const missing = [...usages]
  .filter(([key]) => !localeKeys.has(key))
  .sort(([left], [right]) => left.localeCompare(right));

if (missing.length > 0) {
  console.error("Missing static i18n keys:");
  for (const [key, locations] of missing) {
    console.error(`- ${key}: ${locations.join(", ")}`);
  }
  process.exit(1);
}

console.log(`All ${usages.size} static i18n keys resolve in the English locale.`);

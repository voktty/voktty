import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import process from "node:process";
import ts from "typescript";

const root = resolve(process.cwd(), "src");
const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");

if (!configPath) {
  throw new Error("tsconfig.json not found");
}

const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const sourceFiles = parsed.fileNames.filter((fileName) => {
  const normalized = fileName.replaceAll("\\", "/");
  return (
    normalized.startsWith(root.replaceAll("\\", "/")) &&
    !normalized.includes("/modules/i18n/locales/") &&
    !/\.(?:test|spec)\.[jt]sx?$/.test(normalized)
  );
});

const attributeNames = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "description",
  "label",
  "placeholder",
  "title",
]);

const userFacingPropertyNames = new Set([
  ...attributeNames,
  "message",
  "subtitle",
  "text",
  "tooltip",
]);
const userFacingVariableName = /(?:description|label|message|placeholder|subtitle|title|tooltip)$/i;

const feedbackCalls = new Set([
  "alert",
  "confirm",
  "setError",
  "toast.error",
  "toast.info",
  "toast.success",
  "toast.warning",
  "window.alert",
  "window.confirm",
]);

const internalMetadataPaths = [
  /\/modules\/agents\/lib\/launcher\.ts$/,
  /\/modules\/ai\/agents\/registry\.ts$/,
  /\/modules\/ai\/config\.ts$/,
  /\/modules\/ai\/lib\/agents\.ts$/,
  /\/modules\/ai\/tools\//,
  /\/modules\/editor\/lib\/externalFormat\.ts$/,
  /\/modules\/i18n\/types\.ts$/,
  /\/modules\/terminal\/scripts\/discoverProjectScripts\.ts$/,
  /\/modules\/api-client\/lib\/presets\.ts$/,
  /\/modules\/theme\//,
];

const technicalPatterns = [
  /^(?:Voktty|Git|GitHub|SSH|RDP|Docker|Redis|LSP|AI|CPU|RAM|MEM|DISK|NET|NETWORK|SHA|URL|Shell|WSL|Windows|DTR|RTS|TCP EST|cwd|exit|ping|binary)$/i,
  /^(?:Postman|gRPC|GraphQL|JSON|Bearer|AKIA\.\.\.|sk_test_\.\.\.|oauth2_access_token\.\.\.|whsec_\.\.\.|X-API-Key|us-east-1|s3 \/ execute-api|user|password|Value)$/i,
  /^(?:text|bg|border|from|to|dark:text|hover:text)-[a-z]+-\d+(?:\/\d+)?$/,
  /^(?:JSON|GraphQL) \(application\/json\)$/,
  /^(?:\{…\} (?:B|KB)|\{…\} ms|\{ "limit": \d+, "offset": \d+, "type": "[a-z]+" \})$/,
  /^(?:(?:Ctrl|Alt|Shift|Esc|Enter|Tab|Win)(?:\s*\+?\s*(?:Ctrl|Alt|Shift|Esc|Enter|Tab|Win|Del|Home|Insert|Break|Fin|[A-Z]))*)$/i,
  /^(?:https?|wss?):\/\//i,
  /^(?:[A-Z]:[\\/]|[.~]?[\\/]|--?[a-z\d-]+\b)/i,
  /^(?:[\d./:_*{}()[\]<>|+%=,@#-]+|[A-Z\d_-]{1,8})$/,
  /^(?:sk-|ssh-|ecdsa-|gpt-|qwen|glm-|whisper-|127\.0\.0\.1|192\.168\.)/i,
  /^(?:dev\.voktty|voktty\/voktty|voktty\.dev|Apache 2\.0|Microsoft mstsc\.exe|package\.json|utf-8)$/i,
  /^(?:px|ms|s|v|x|of|line|active|[⇧↵↑↓×✕✓·•−—→$?❯]+)$/i,
  /^(?:CPU|RAM|MEM|DISK|NET|NETWORK|TCP EST|WSL):?$/i,
  /^(?:Administrator|WORKGROUP|root(?:\s*\/\s*ubuntu)?)$/i,
  /^(?:example\.ts|production, aws, git|mytool --fix \{file\}|\.pem|\.pub)$/i,
  /^(?:\d{3,4}\s*x\s*\d{3,4}\s*\([^)]*\))$/i,
  /^(?:\{…\}|[():/\s-])+$/,
  /^(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}✎ⓘ…]+)$/u,
  /^(?:\$ voktty --ready|px \(Terminal\)|ms ping|\(-[LRD]\))$/i,
  /^(?:stdout|stderr|cwd →|⇧O|&gt;|Alt\+|ms\)|\(Esc)$/i,
  /^(?:\{…\} baud · \{…\}\{…\}\{…\}|\{…\}: \{…\}\/5)$/,
  /^(?:Vite(?: \(alt\)| preview)?|Next\.js(?: \(alt\))?|Angular|Astro|Live Server|Storybook|Webpack|Metro|Django \/ FastAPI|Jupyter|Flask|Gradio|Ollama)$/i,
  /^(?:Arch|Debian \/ Ubuntu|Fedora \/ RHEL)$/i,
  /^(?:Explain the last error in the terminal\.|Give me a command to|Summarize what just happened in the terminal\.)$/,
  /^(?:SSH|WSL|Docker|Serial|RDP): \{…\}$/,
  /^(?:unhandled method \{…\}|Space|←|↑\{…\} ↓\{…\}|[↑↓]\{…\}|~)$/,
  /^(?:ssh\s+\{…\}|ssh \{…\}@\{…\}|serial · \{…\}|docker · \{…\}|wsl · \{…\}|\{…\} \(WSL\)|\{…\} · localhost:\{…\}|\{…\} :\{…\}|🐳 \{…\}|\{…\} \(AI diff\)|\{…\} @ \{…\}|\{…\} — \{…\})$/,
  /^(?:, \{…\}|\{…\}%|\{…\}…|\{…\}@|· \{…\}|\{…\}% — \{…\}|\{…\} · v\{…\}|v\{…\}|\+\{…\})$/,
];

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function isTechnical(value) {
  const text = normalizeText(value);
  return text.length === 0 || technicalPatterns.some((pattern) => pattern.test(text));
}

function isInternalMetadataFile(fileName) {
  const normalized = fileName.replaceAll("\\", "/");
  return internalMetadataPaths.some((pattern) => pattern.test(normalized));
}

function expressionName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    return `${expressionName(expression.expression)}.${expression.name.text}`;
  }
  return "";
}

function literalText(node) {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => `{…}${span.literal.text}`).join("");
  }
  return undefined;
}

function renderedLiteralTexts(node) {
  const value = literalText(node);
  if (value !== undefined) return [value];
  if (ts.isParenthesizedExpression(node)) {
    return renderedLiteralTexts(node.expression);
  }
  if (ts.isConditionalExpression(node)) {
    return [
      ...renderedLiteralTexts(node.whenTrue),
      ...renderedLiteralTexts(node.whenFalse),
    ];
  }
  if (
    ts.isBinaryExpression(node) &&
    [
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(node.operatorToken.kind)
  ) {
    return [
      ...renderedLiteralTexts(node.left),
      ...renderedLiteralTexts(node.right),
    ];
  }
  return [];
}

function containsTranslationCall(node) {
  let found = false;
  function visit(current) {
    if (found) return;
    if (
      ts.isCallExpression(current) &&
      ["t", "translate"].includes(expressionName(current.expression))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

const findings = [];

function addFinding(sourceFile, node, kind, value) {
  const text = normalizeText(value);
  if (isTechnical(text)) return;
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  findings.push({
    file: relative(process.cwd(), sourceFile.fileName).replaceAll("\\", "/"),
    line: position.line + 1,
    kind,
    text,
  });
}

for (const fileName of sourceFiles) {
  const sourceText = readFileSync(fileName, "utf8");
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function visit(node) {
    if (ts.isJsxText(node)) {
      addFinding(sourceFile, node, "jsx-text", node.text);
    } else if (
      ts.isJsxExpression(node) &&
      !ts.isJsxAttribute(node.parent) &&
      node.expression
    ) {
      for (const value of renderedLiteralTexts(node.expression)) {
        addFinding(sourceFile, node, "jsx-expression", value);
      }
    } else if (
      ts.isJsxAttribute(node) &&
      attributeNames.has(node.name.getText(sourceFile)) &&
      node.initializer
    ) {
      if (ts.isStringLiteral(node.initializer)) {
        addFinding(sourceFile, node, "jsx-attribute", node.initializer.text);
      } else if (
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      ) {
        if (containsTranslationCall(node.initializer.expression)) {
          ts.forEachChild(node, visit);
          return;
        }
        const value = literalText(node.initializer.expression);
        if (value !== undefined) addFinding(sourceFile, node, "jsx-attribute", value);
      }
    } else if (
      ts.isPropertyAssignment(node) &&
      !isInternalMetadataFile(fileName) &&
      userFacingPropertyNames.has(node.name.getText(sourceFile).replace(/["']/g, "")) &&
      !containsTranslationCall(node.initializer)
    ) {
      const value = literalText(node.initializer);
      if (value !== undefined) addFinding(sourceFile, node, "ui-property", value);
    } else if (
      ts.isBindingElement(node) &&
      ts.isIdentifier(node.name) &&
      attributeNames.has(node.name.text) &&
      node.initializer
    ) {
      const value = literalText(node.initializer);
      if (value !== undefined) addFinding(sourceFile, node, "ui-default", value);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      userFacingVariableName.test(node.name.text) &&
      node.initializer &&
      !containsTranslationCall(node.initializer)
    ) {
      const value = literalText(node.initializer);
      if (value !== undefined) addFinding(sourceFile, node, "ui-variable", value);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      userFacingVariableName.test(node.left.text) &&
      !containsTranslationCall(node.right)
    ) {
      const value = literalText(node.right);
      if (value !== undefined) addFinding(sourceFile, node, "ui-assignment", value);
    } else if (ts.isCallExpression(node) && feedbackCalls.has(expressionName(node.expression))) {
      const firstArg = node.arguments[0];
      if (firstArg) {
        const value = literalText(firstArg);
        if (value !== undefined) addFinding(sourceFile, firstArg, "feedback", value);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} [${finding.kind}] ${finding.text}`);
  }
  console.error(`Found ${findings.length} likely hardcoded user-facing strings.`);
  process.exitCode = 1;
} else {
  console.log(`No hardcoded user-facing strings found in ${sourceFiles.length} source files.`);
}

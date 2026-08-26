import { t as translate } from "@/modules/i18n";

export type LanguageAction = {
  id: string;
  label: string;
  iconName: "shield" | "flash" | "wrench" | "test" | "palette" | "sparkles" | "text" | "translate" | "document" | "search";
  prompt: string;
  description: string;
  badge?: string;
};

type Translate = (key: string) => string;
type ActionSpec = Pick<LanguageAction, "iconName" | "prompt"> & { badge?: string };

const ACTION_SPECS: Record<string, ActionSpec> = {
  "php-security": { iconName: "shield", badge: "security", prompt: "Secure this PHP code against SQL injection with prepared statements, prevent XSS with safe output encoding, validate inputs, and apply strict types." },
  "php-optimize": { iconName: "flash", prompt: "Optimize this PHP code for performance by reducing redundant queries, loops, and memory use while applying modern native functions." },
  "php-fix": { iconName: "wrench", prompt: "Find and fix syntax errors, undefined variables, deprecations, and exceptions in this PHP code." },
  "php-tests": { iconName: "test", prompt: "Generate complete PHPUnit tests for the functions and logic in this PHP code." },
  "html-tailwind": { iconName: "palette", badge: "uiUx", prompt: "Modernize this HTML markup with clean, consistent, responsive Tailwind CSS classes." },
  "html-a11y": { iconName: "shield", prompt: "Improve WCAG accessibility in this HTML with semantic elements, accessible names, alt text, and keyboard navigation." },
  "html-fix": { iconName: "wrench", prompt: "Fix unclosed HTML tags, invalid DOM hierarchy, and obsolete attributes." },
  "html-seo": { iconName: "flash", prompt: "Optimize HTML semantics, metadata, and headings for SEO and rendering performance." },
  "ts-strict-types": { iconName: "shield", badge: "types", prompt: "Add strict TypeScript types, descriptive interfaces, generics, and null-safety without using any." },
  "ts-optimize": { iconName: "flash", prompt: "Optimize this TypeScript with immutable functional patterns, clean async/await, and minimal complexity." },
  "ts-fix": { iconName: "wrench", prompt: "Find and fix race conditions, unhandled promises, memory leaks, and logic bugs in this TypeScript code." },
  "ts-tests": { iconName: "test", prompt: "Generate thorough Vitest or Jest unit tests covering edge cases and necessary mocks." },
  "js-convert-ts": { iconName: "sparkles", badge: "ts", prompt: "Convert this JavaScript to modern TypeScript with explicit types, interfaces, and type narrowing." },
  "js-optimize": { iconName: "flash", prompt: "Modernize and optimize this JavaScript with ES6+ syntax, destructuring, optional chaining, and async/await." },
  "js-fix": { iconName: "wrench", prompt: "Fix runtime errors, undeclared variables, and asynchronous bugs in this JavaScript code." },
  "js-tests": { iconName: "test", prompt: "Generate complete Vitest or Jest unit tests for this JavaScript code." },
  "py-pythonic": { iconName: "flash", badge: "pythonic", prompt: "Refactor this Python code to be idiomatic and Pythonic with comprehensions, generators, and PEP 8 practices." },
  "py-type-hints": { iconName: "shield", prompt: "Add complete PEP 484 type hints and Google or NumPy style docstrings." },
  "py-fix": { iconName: "wrench", prompt: "Fix exceptions, indentation issues, mutable defaults, and logic bugs in this Python code." },
  "py-pytest": { iconName: "test", prompt: "Generate complete pytest tests with fixtures and parametrization for edge cases." },
  "rust-idiomatic": { iconName: "flash", badge: "idiomatic", prompt: "Refactor to idiomatic Rust with iterators, zero-cost abstractions, and optimal borrowing." },
  "rust-safe": { iconName: "shield", prompt: "Replace unwrap and expect with robust Result or Option handling, the ? operator, or exhaustive matching." },
  "rust-fix": { iconName: "wrench", prompt: "Fix borrow checker, lifetime, and type compatibility errors in this Rust code." },
  "rust-tests": { iconName: "test", prompt: "Generate Rust unit tests under cfg(test) covering edge cases with clear assertions." },
  "go-idiomatic": { iconName: "flash", badge: "idiomatic", prompt: "Refactor to idiomatic Go with clear structures, efficient allocation, and safe channel-based concurrency." },
  "go-errors": { iconName: "shield", prompt: "Improve idiomatic Go error handling with explicit checks and error wrapping through fmt.Errorf and %w." },
  "go-fix": { iconName: "wrench", prompt: "Find and fix goroutine leaks, nil pointer dereferences, and data races in this Go code." },
  "go-tests": { iconName: "test", prompt: "Generate Go unit tests and benchmarks with the testing package." },
  "css-tailwind": { iconName: "palette", badge: "tailwind", prompt: "Convert these CSS rules to equivalent Tailwind CSS v3 or v4 utility classes." },
  "css-responsive": { iconName: "flash", prompt: "Make this CSS responsive with modern media queries, Flexbox or Grid, and relative units." },
  "css-clean": { iconName: "wrench", prompt: "Remove redundant CSS, obsolete prefixes, and consolidate colors into custom properties." },
  "sql-optimize": { iconName: "flash", badge: "query", prompt: "Optimize this SQL query for execution speed, reduce full table scans, and suggest useful indexes." },
  "sql-secure": { iconName: "shield", prompt: "Convert this SQL to parameterized prepared statement syntax to prevent SQL injection." },
  "sql-format": { iconName: "document", prompt: "Format this SQL with uppercase keywords and clear clause indentation." },
  "json-fix": { iconName: "wrench", badge: "syntax", prompt: "Validate and fix commas, quotes, and data structure errors in this document." },
  "json-format": { iconName: "document", prompt: "Format with two-space indentation and sort keys alphabetically." },
  "json-sanitize": { iconName: "shield", prompt: "Find and replace passwords, API keys, and private data with safe placeholders." },
  "text-improve": { iconName: "text", badge: "writing", prompt: "Improve the grammar, tone, clarity, and concision of this text while preserving its language." },
  "text-summarize": { iconName: "flash", prompt: "Summarize this text with concise bullets covering the main points and conclusions." },
  "text-translate": { iconName: "translate", prompt: "Translate this text into natural technical English with correct grammar." },
  "text-markdown": { iconName: "document", prompt: "Structure this content with Markdown headings, lists, tables, and code blocks." },
  "generic-optimize": { iconName: "flash", prompt: "Optimize this code for performance, readability, and efficiency." },
  "generic-fix": { iconName: "wrench", prompt: "Find and fix bugs, exceptions, and edge cases in this code." },
  "generic-doc": { iconName: "document", prompt: "Add concise documentation comments and clear explanations to this code." },
  "generic-test": { iconName: "test", prompt: "Generate a complete unit test suite for this code." },
};

const ACTION_GROUPS = {
  php: ["php-security", "php-optimize", "php-fix", "php-tests"],
  html: ["html-tailwind", "html-a11y", "html-fix", "html-seo"],
  ts: ["ts-strict-types", "ts-optimize", "ts-fix", "ts-tests"],
  js: ["js-convert-ts", "js-optimize", "js-fix", "js-tests"],
  py: ["py-pythonic", "py-type-hints", "py-fix", "py-pytest"],
  rust: ["rust-idiomatic", "rust-safe", "rust-fix", "rust-tests"],
  go: ["go-idiomatic", "go-errors", "go-fix", "go-tests"],
  css: ["css-tailwind", "css-responsive", "css-clean"],
  sql: ["sql-optimize", "sql-secure", "sql-format"],
  data: ["json-fix", "json-format", "json-sanitize"],
  text: ["text-improve", "text-summarize", "text-translate", "text-markdown"],
  generic: ["generic-optimize", "generic-fix", "generic-doc", "generic-test"],
} as const;

function localizeAction(id: string, t: Translate): LanguageAction {
  const spec = ACTION_SPECS[id];
  return {
    id,
    iconName: spec.iconName,
    prompt: spec.prompt,
    label: t(`editor.selectionActions.items.${id}.label`),
    description: t(`editor.selectionActions.items.${id}.description`),
    badge: spec.badge ? t(`editor.selectionActions.badges.${spec.badge}`) : undefined,
  };
}

function actionResult(languageName: string, ids: readonly string[], t: Translate) {
  return { languageName, actions: ids.map((id) => localizeAction(id, t)) };
}

export function getLanguageSelectionActions(
  langOrPath: string | null | undefined,
  t: Translate = translate,
): { languageName: string; actions: LanguageAction[] } {
  if (!langOrPath) return actionResult(t("editor.selectionActions.code"), ACTION_GROUPS.generic, t);

  const clean = langOrPath.includes(".")
    ? (langOrPath.split(".").pop()?.toLowerCase() ?? "")
    : langOrPath.toLowerCase();

  if (["php", "phtml", "php3", "php4", "php5", "phps"].includes(clean)) return actionResult("PHP", ACTION_GROUPS.php, t);
  if (["html", "htm", "xhtml", "blade", "twig", "vue", "svelte"].includes(clean)) return actionResult(clean.toUpperCase(), ACTION_GROUPS.html, t);
  if (["ts", "tsx", "typescript"].includes(clean)) return actionResult("TypeScript", ACTION_GROUPS.ts, t);
  if (["js", "jsx", "mjs", "cjs", "javascript"].includes(clean)) return actionResult("JavaScript", ACTION_GROUPS.js, t);
  if (["py", "python", "pyw"].includes(clean)) return actionResult("Python", ACTION_GROUPS.py, t);
  if (["rs", "rust"].includes(clean)) return actionResult("Rust", ACTION_GROUPS.rust, t);
  if (["go", "golang"].includes(clean)) return actionResult("Go", ACTION_GROUPS.go, t);
  if (["css", "scss", "sass", "less", "postcss"].includes(clean)) return actionResult("CSS", ACTION_GROUPS.css, t);
  if (["sql", "mysql", "pgsql", "sqlite"].includes(clean)) return actionResult("SQL", ACTION_GROUPS.sql, t);
  if (["json", "yaml", "yml", "toml"].includes(clean)) return actionResult(clean.toUpperCase(), ACTION_GROUPS.data, t);
  if (["txt", "text", "md", "markdown", "rst", "adoc"].includes(clean)) {
    const name = ["md", "markdown"].includes(clean) ? "Markdown" : t("editor.selectionActions.text");
    return actionResult(name, ACTION_GROUPS.text, t);
  }

  return actionResult(clean ? clean.toUpperCase() : t("editor.selectionActions.code"), ACTION_GROUPS.generic, t);
}

export function isLogicalCodeBlock(selectedText: string | null | undefined): boolean {
  if (!selectedText) return false;
  const text = selectedText.trim();
  if (text.length < 12) return false;

  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2) return true;

  const hasBalancedDelimiters =
    (text.includes("{") && text.includes("}")) ||
    (text.includes("(") && text.includes(")")) ||
    (text.includes("[") && text.includes("]")) ||
    (text.startsWith("<") && text.endsWith(">"));
  const isCompleteStatement = text.endsWith(";") || text.endsWith("}") || text.endsWith(">");

  return text.length >= 20 && (hasBalancedDelimiters || isCompleteStatement);
}

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "struct"
  | "enum"
  | "heading"
  | "test";

export type CurrentSymbol = {
  name: string;
  kind: SymbolKind;
  line: number;
};

export function resolveCurrentSymbol(
  content: string,
  targetLine: number,
): CurrentSymbol | null {
  if (!content || targetLine < 1) return null;

  const lines = content.split(/\r?\n/);
  const maxLine = Math.min(targetLine - 1, lines.length - 1);

  for (let i = maxLine; i >= 0; i--) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      continue;
    }

    // Markdown headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      return {
        name: headingMatch[2].trim(),
        kind: "heading",
        line: i + 1,
      };
    }

    // Test cases (describe, it, test)
    const testMatch = trimmed.match(/^(?:describe|it|test)\s*\(\s*["'`]([^"'`]+)["'`]/);
    if (testMatch) {
      return {
        name: testMatch[1].trim(),
        kind: "test",
        line: i + 1,
      };
    }

    // Rust functions, structs, enums, impls
    const rustMatch = trimmed.match(
      /^(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?(fn|struct|enum|trait|impl|type)\s+([A-Za-z0-9_]+)/,
    );
    if (rustMatch) {
      const kindMap: Record<string, SymbolKind> = {
        fn: "function",
        struct: "struct",
        enum: "enum",
        trait: "interface",
        impl: "class",
        type: "type",
      };
      return {
        name: rustMatch[2],
        kind: kindMap[rustMatch[1]] ?? "function",
        line: i + 1,
      };
    }

    // Go functions & methods
    const goFuncMatch = trimmed.match(
      /^func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)\s*\(/,
    );
    if (goFuncMatch) {
      return {
        name: goFuncMatch[1],
        kind: "function",
        line: i + 1,
      };
    }

    // Python functions & classes
    const pyMatch = trimmed.match(/^(?:async\s+)?(def|class)\s+([A-Za-z0-9_]+)/);
    if (pyMatch) {
      return {
        name: pyMatch[2],
        kind: pyMatch[1] === "class" ? "class" : "function",
        line: i + 1,
      };
    }

    // TS/JS functions, classes, interfaces, types, enums
    const tsMatch = trimmed.match(
      /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(function|class|interface|type|enum)\s+([A-Za-z0-9_]+)/,
    );
    if (tsMatch) {
      const kindMap: Record<string, SymbolKind> = {
        function: "function",
        class: "class",
        interface: "interface",
        type: "type",
        enum: "enum",
      };
      return {
        name: tsMatch[2],
        kind: kindMap[tsMatch[1]] ?? "function",
        line: i + 1,
      };
    }

    // Arrow function or const function assignment: const handleClick = (...) =>
    const arrowMatch = trimmed.match(
      /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/,
    );
    if (arrowMatch) {
      return {
        name: arrowMatch[1],
        kind: "function",
        line: i + 1,
      };
    }

    // Class / Object method: name(...) { or async name(...) {
    const methodMatch = trimmed.match(
      /^(?:public|private|protected|static|async|\*)*\s*([A-Za-z0-9_]+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{?$/,
    );
    if (methodMatch && !["if", "else", "for", "while", "switch", "catch"].includes(methodMatch[1])) {
      return {
        name: methodMatch[1],
        kind: "function",
        line: i + 1,
      };
    }
  }

  return null;
}

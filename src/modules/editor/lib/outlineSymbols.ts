export type IdeSymbol = {
  id: string;
  name: string;
  detail?: string;
  kind: number;
  path: string;
  line: number;
  column: number;
  endLine: number;
  children: IdeSymbol[];
};

type Candidate = Omit<IdeSymbol, "id" | "path" | "endLine" | "children"> & {
  depth: number;
};

const CONTAINER_KINDS = new Set([2, 3, 5, 10, 11, 23]);

function symbolId(path: string, line: number, column: number, name: string) {
  return `${path}:${line}:${column}:${name}`;
}

function markdownSymbols(content: string, path: string): IdeSymbol[] {
  const roots: IdeSymbol[] = [];
  const stack: Array<{ level: number; symbol: IdeSymbol }> = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((raw, index) => {
    const match = raw.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) return;
    const level = match[1].length;
    const name = match[2].trim();
    const column = raw.indexOf(name) + 1;
    const symbol: IdeSymbol = {
      id: symbolId(path, index + 1, column, name),
      name,
      kind: 2,
      path,
      line: index + 1,
      column,
      endLine: lines.length,
      children: [],
    };
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]?.symbol;
    if (parent) parent.children.push(symbol);
    else roots.push(symbol);
    stack.push({ level, symbol });
  });

  return roots;
}

function candidateForLine(raw: string, language: string): Candidate | null {
  const trimmed = raw.trim();
  if (!trimmed || /^(?:\/\/|\/\*|\*|#(?!\s))/.test(trimmed)) return null;
  const depth = raw.length - raw.trimStart().length;
  const lang = language.toLowerCase();

  if (lang === "python" || lang === "py") {
    const match = trimmed.match(/^(?:async\s+)?(class|def)\s+([A-Za-z_]\w*)/);
    if (match) {
      return {
        name: match[2],
        kind: match[1] === "class" ? 5 : 12,
        line: 0,
        column: raw.indexOf(match[2]) + 1,
        depth,
      };
    }
  }

  const rust = trimmed.match(
    /^(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?(fn|struct|enum|trait|impl|type)\s+([^\s<{(;]+)/,
  );
  if (rust && ["rust", "rs"].includes(lang)) {
    const kind =
      {
        fn: 12,
        struct: 23,
        enum: 10,
        trait: 11,
        impl: 5,
        type: 11,
      }[rust[1]] ?? 12;
    return {
      name: rust[1] === "impl" ? `impl ${rust[2]}` : rust[2],
      kind,
      line: 0,
      column: raw.indexOf(rust[2]) + 1,
      depth,
    };
  }

  const go = trimmed.match(
    /^(?:func\s+(?:\([^)]+\)\s+)?([A-Za-z_]\w*)|type\s+([A-Za-z_]\w*)\s+(struct|interface))/,
  );
  if (go && ["go", "golang"].includes(lang)) {
    const name = go[1] ?? go[2];
    return {
      name,
      kind: go[1] ? 12 : go[3] === "struct" ? 23 : 11,
      line: 0,
      column: raw.indexOf(name) + 1,
      depth,
    };
  }

  const container = trimmed.match(
    /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(class|interface|enum|namespace|module|type)\s+([A-Za-z_$][\w$]*)/,
  );
  if (container) {
    const kind =
      {
        class: 5,
        interface: 11,
        enum: 10,
        namespace: 3,
        module: 2,
        type: 11,
      }[container[1]] ?? 2;
    return {
      name: container[2],
      kind,
      line: 0,
      column: raw.indexOf(container[2]) + 1,
      depth,
    };
  }

  const fn = trimmed.match(
    /^(?:export\s+)?(?:default\s+)?(?:public\s+|private\s+|protected\s+|static\s+)*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  );
  if (fn) {
    return {
      name: fn[1],
      kind: 12,
      line: 0,
      column: raw.indexOf(fn[1]) + 1,
      depth,
    };
  }

  const arrow = trimmed.match(
    /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  );
  if (arrow) {
    return {
      name: arrow[1],
      kind: 12,
      line: 0,
      column: raw.indexOf(arrow[1]) + 1,
      depth,
    };
  }

  const method = trimmed.match(
    /^(?:public\s+|private\s+|protected\s+|static\s+|abstract\s+|override\s+)*(?:async\s+)?(constructor|[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^={]+)?\s*(?:\{|=>)/,
  );
  if (
    method &&
    !["if", "for", "while", "switch", "catch"].includes(method[1])
  ) {
    return {
      name: method[1],
      kind: method[1] === "constructor" ? 9 : 6,
      line: 0,
      column: raw.indexOf(method[1]) + 1,
      depth,
    };
  }

  const php = trimmed.match(
    /^(?:(?:final|abstract)\s+)?(class|interface|trait|function)\s+([A-Za-z_]\w*)/i,
  );
  if (php) {
    return {
      name: php[2],
      kind: php[1].toLowerCase() === "function" ? 12 : 5,
      line: 0,
      column: raw.indexOf(php[2]) + 1,
      depth,
    };
  }

  return null;
}

export function extractDocumentSymbols(
  content: string,
  language: string,
  path: string,
): IdeSymbol[] {
  if (!content) return [];
  if (["markdown", "md", "mdx"].includes(language.toLowerCase())) {
    return markdownSymbols(content, path);
  }

  const roots: IdeSymbol[] = [];
  const stack: Array<{ depth: number; symbol: IdeSymbol }> = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const candidate = candidateForLine(raw, language);
    if (!candidate) return;
    const symbol: IdeSymbol = {
      id: symbolId(path, index + 1, candidate.column, candidate.name),
      name: candidate.name,
      kind: candidate.kind,
      path,
      line: index + 1,
      column: candidate.column,
      endLine: lines.length,
      children: [],
    };
    while (
      stack.length > 0 &&
      stack[stack.length - 1].depth >= candidate.depth
    ) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]?.symbol;
    if (parent && CONTAINER_KINDS.has(parent.kind))
      parent.children.push(symbol);
    else roots.push(symbol);
    if (CONTAINER_KINDS.has(symbol.kind)) {
      stack.push({ depth: candidate.depth, symbol });
    }
  });
  return roots;
}

export function filterSymbols(
  symbols: IdeSymbol[],
  query: string,
): IdeSymbol[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return symbols;
  return symbols.flatMap((symbol) => {
    if (
      symbol.name.toLocaleLowerCase().includes(needle) ||
      symbol.detail?.toLocaleLowerCase().includes(needle)
    ) {
      return [symbol];
    }
    const children = filterSymbols(symbol.children, needle);
    return children.length > 0 ? [{ ...symbol, children }] : [];
  });
}

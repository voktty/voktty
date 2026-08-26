export type EditorSnippet = {
  prefix: string;
  template: string;
};

const JAVASCRIPT: EditorSnippet[] = [
  {
    prefix: "function",
    template: `function \${1:name}(\${2:args}) {\n\t\${0}\n}`,
  },
  {
    prefix: "async",
    template: `async function \${1:name}(\${2:args}) {\n\t\${0}\n}`,
  },
  {
    prefix: "try",
    template: `try {\n\t\${1}\n} catch (\${2:error}) {\n\t\${0}\n}`,
  },
];

const REACT: EditorSnippet[] = [
  ...JAVASCRIPT,
  {
    prefix: "component",
    template: `export function \${1:Component}(\${2:props}) {\n\treturn (\n\t\t\${0}\n\t);\n}`,
  },
  {
    prefix: "useState",
    template: `const [\${1:value}, set\${2:Value}] = useState(\${0});`,
  },
];

const RUST: EditorSnippet[] = [
  {
    prefix: "fn",
    template: `fn \${1:name}(\${2:args}) -> \${3:Result<()>} {\n\t\${0}\n}`,
  },
  {
    prefix: "test",
    template: `#[test]\nfn \${1:name}() {\n\t\${0}\n}`,
  },
];

const PYTHON: EditorSnippet[] = [
  {
    prefix: "def",
    template: `def \${1:name}(\${2:args}):\n\t\${0}`,
  },
  {
    prefix: "class",
    template: `class \${1:Name}:\n\tdef __init__(self, \${2:args}):\n\t\t\${0}`,
  },
];

const GO: EditorSnippet[] = [
  {
    prefix: "func",
    template: `func \${1:name}(\${2:args}) \${3:error} {\n\t\${0}\n}`,
  },
];

const HTML: EditorSnippet[] = [
  {
    prefix: "element",
    template: `<\${1:div}>\${0}</\${1:div}>`,
  },
];

const PHP: EditorSnippet[] = [
  {
    prefix: "function",
    template: `function \${1:name}(\${2:args}) {\n\t\${0}\n}`,
  },
  {
    prefix: "if",
    template: `if (\${1:condition}) {\n\t\${0}\n}`,
  },
  {
    prefix: "foreach",
    template: `foreach (\${1:$items} as \${2:$item}) {\n\t\${0}\n}`,
  },
  {
    prefix: "class",
    template: `class \${1:Name} {\n\t\${0}\n}`,
  },
  {
    prefix: "return",
    template: `return \${0};`,
  },
];

export function snippetsForLanguage(language: string | null): EditorSnippet[] {
  switch ((language ?? "").toLowerCase()) {
    case "javascript":
    case "js":
    case "typescript":
    case "ts":
      return JAVASCRIPT;
    case "jsx":
    case "tsx":
      return REACT;
    case "rust":
    case "rs":
      return RUST;
    case "python":
    case "py":
      return PYTHON;
    case "go":
      return GO;
    case "html":
      return HTML;
    case "php":
      return PHP;
    default:
      return [];
  }
}

export function applySnippetIndent(template: string, unit: string): string {
  return template.split("\t").join(unit || "\t");
}

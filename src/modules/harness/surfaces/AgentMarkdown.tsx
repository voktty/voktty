import { code } from "@streamdown/code";
import {
  createContext,
  isValidElement,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { harden } from "rehype-harden";
import {
  CodeBlock,
  Streamdown,
  defaultRehypePlugins,
  useIsCodeFenceIncomplete,
  type Components,
} from "streamdown";
import type { PluggableList } from "unified";
import { ExplorerMenu, type ExplorerMenuItem } from "../chrome/ExplorerMenu";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { createLazyMermaidPlugin } from "./mermaidPlugin";
import { copyText } from "../lib/clipboard";
import { revealPath } from "../lib/fs";
import { displayPath, resolveWorkspacePath } from "../lib/paths";
import { IS_MAC, IS_WIN } from "../lib/platform";
import { isAtxHeadingLine } from "../lib/markdownSource";
import { useColorScheme } from "../hooks/useColorScheme";
import { useLockOverscroll } from "../hooks/useLockOverscroll";

const MERMAID_BASE_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
} as const;

const mermaid = createLazyMermaidPlugin({
  config: {
    ...MERMAID_BASE_CONFIG,
    theme: "dark",
  },
});

const MARKDOWN_PLUGINS = { code, mermaid };

const MARKDOWN_REHYPE_PLUGINS: PluggableList = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  [
    harden,
    {
      allowedImagePrefixes: [] as string[],
      allowedLinkPrefixes: ["*"],
      allowDataImages: true,
      imageBlockPolicy: "remove" as const,
    },
  ],
];

type FileLinkMenu = {
  x: number;
  y: number;
  path: string;
};

const REVEAL_LABEL = IS_MAC
  ? "Reveal in Finder"
  : IS_WIN
    ? "Reveal in File Explorer"
    : "Open Containing Folder";

function fileLinkMenuItems(
  canOpenInVoktty: boolean,
  canCopyRelativePath: boolean,
): ExplorerMenuItem[] {
  return [
    {
      kind: "item",
      id: "open-voktty",
      label: "Open in Voktty",
      disabled: !canOpenInVoktty,
    },
    { kind: "item", id: "open-default", label: "Open in Default App" },
    { kind: "item", id: "reveal", label: REVEAL_LABEL },
    { kind: "sep" },
    { kind: "item", id: "copy-path", label: "Copy Path" },
    ...(canCopyRelativePath
      ? [
          {
            kind: "item" as const,
            id: "copy-relative-path",
            label: "Copy Relative Path",
          },
        ]
      : []),
  ];
}

const FileOpenContext = createContext<{
  cwd?: string;
  onOpenFile?: (path: string) => void;
  onFileContextMenu?: (event: ReactMouseEvent, path: string) => void;
}>({});

const LANGUAGE_FROM_EXT: Record<string, string> = {
  sh: "bash",
  zsh: "bash",
  py: "python",
  rb: "ruby",
  rs: "rust",
  ts: "typescript",
  js: "javascript",
  md: "markdown",
  yml: "yaml",
  cs: "csharp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
};

const LANGUAGE_FILE_NAMES: Record<string, string> = {
  bash: "code.sh",
  c: "code.c",
  cpp: "code.cpp",
  "c++": "code.cpp",
  csharp: "code.cs",
  css: "code.css",
  go: "code.go",
  html: "code.html",
  java: "code.java",
  javascript: "code.js",
  js: "code.js",
  jsx: "code.jsx",
  json: "code.json",
  markdown: "code.md",
  md: "code.md",
  php: "code.php",
  python: "code.py",
  py: "code.py",
  ruby: "code.rb",
  rust: "code.rs",
  rs: "code.rs",
  shell: "code.sh",
  sh: "code.sh",
  sql: "code.sql",
  swift: "code.swift",
  toml: "code.toml",
  ts: "code.ts",
  tsx: "code.tsx",
  typescript: "code.ts",
  xml: "code.xml",
  yaml: "code.yaml",
  yml: "code.yaml",
  zsh: "code.sh",
};

type MarkdownLinkProps = ComponentProps<"a"> & { node?: unknown };

function MarkdownLink({
  href,
  children,
  className,
  node: _node,
  onClick,
  onContextMenu,
  dir,
  ...props
}: MarkdownLinkProps) {
  const { cwd, onOpenFile, onFileContextMenu } = useContext(FileOpenContext);
  const filePath = href ? resolveWorkspacePath(href, cwd) : undefined;

  return (
    <a
      href={href}
      className={`text-sky-400/90 hover:text-sky-300 hover:underline ${className ?? ""}`}
      {...props}
      dir={dir ?? "auto"}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (filePath && onOpenFile) {
          event.preventDefault();
          onOpenFile(filePath);
          return;
        }
        if (!href || !/^https?:\/\//i.test(href)) {
          event.preventDefault();
        }
      }}
      onContextMenu={(event) => {
        onContextMenu?.(event);
        if (event.defaultPrevented || !filePath || !onFileContextMenu) return;
        onFileContextMenu(event, filePath);
      }}
    >
      {children}
    </a>
  );
}

type MarkdownCodeProps = ComponentProps<"code"> & { node?: unknown };

function MarkdownCode({
  children,
  className,
  node,
  onContextMenu,
  ...props
}: MarkdownCodeProps) {
  const incomplete = useIsCodeFenceIncomplete();
  const block = "data-block" in props;
  if (!block) {
    const text = textContent(children);
    const fileName = inlineFileName(text);
    const { cwd, onOpenFile, onFileContextMenu } = useContext(FileOpenContext);
    const filePath = fileName ? resolveWorkspacePath(text, cwd) : undefined;
    const open =
      filePath && onOpenFile ? () => onOpenFile(filePath) : undefined;
    return (
      <code
        {...props}
        dir="ltr"
        className={`inline-flex items-center gap-1 rounded-md bg-content/8 px-1.5 min-h-6 max-w-full [overflow-wrap:anywhere] align-baseline font-mono text-[0.8em] text-content ${
          open ? "cursor-pointer hover:text-sky-300 hover:underline" : ""
        } ${className ?? ""}`}
        role={open ? "link" : undefined}
        tabIndex={open ? 0 : undefined}
        onClick={open}
        onContextMenu={(event) => {
          onContextMenu?.(event);
          if (event.defaultPrevented || !filePath || !onFileContextMenu) return;
          onFileContextMenu(event, filePath);
        }}
        onKeyDown={
          open
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  open();
                }
              }
            : undefined
        }
      >
        {fileName ? (
          <span aria-hidden="true">
            <FileTypeIcon name={fileName} isDir={false} size={14} />
          </span>
        ) : null}
        {children}
      </code>
    );
  }

  const meta = codeMeta(node);
  const fence = parseCodeFence(className, meta);
  if (fence.language.toLowerCase() === "mermaid") {
    return (
      <MermaidBlock code={textContent(children)} incomplete={incomplete} />
    );
  }
  const iconName =
    fence.fileName ??
    (fence.language ? fileNameForLanguage(fence.language) : "");
  const lineNumbers = !/\bnoLineNumbers\b/.test(meta);

  return (
    <div className="markdown-code-shell" dir="ltr">
      {iconName ? (
        <span className="markdown-code-icon" aria-hidden="true">
          <FileTypeIcon name={iconName} isDir={false} />
        </span>
      ) : null}
      {fence.filePath ? <MarkdownCodePath path={fence.filePath} /> : null}
      <CodeBlock
        className={className}
        code={textContent(children)}
        isIncomplete={incomplete}
        language={fence.language}
        lineNumbers={lineNumbers}
        startLine={fence.startLine}
      />
    </div>
  );
}

const MARKDOWN_COMPONENTS = {
  a: MarkdownLink,
  code: MarkdownCode,
} satisfies Components;

export const AgentMarkdown = memo(function AgentMarkdown({
  text,
  streaming,
  className,
  cwd,
  onOpenFile,
}: {
  text: string;
  streaming?: boolean;
  className?: string;
  cwd?: string;
  onOpenFile?: (path: string) => void;
}) {
  const [fileMenu, setFileMenu] = useState<FileLinkMenu | null>(null);
  const onFileContextMenu = useCallback(
    (event: ReactMouseEvent, path: string) => {
      event.preventDefault();
      event.stopPropagation();
      setFileMenu({ x: event.clientX, y: event.clientY, path });
    },
    [],
  );
  const fileOpen = useMemo(
    () => ({ cwd, onOpenFile, onFileContextMenu }),
    [cwd, onOpenFile, onFileContextMenu],
  );

  const onFileMenuPick = (id: string) => {
    if (!fileMenu) return;
    const path = fileMenu.path;
    setFileMenu(null);

    if (id === "open-voktty") {
      onOpenFile?.(path);
      return;
    }

    let action: Promise<void>;
    switch (id) {
      case "open-default":
        action = openPath(path);
        break;
      case "reveal":
        action = revealPath(path);
        break;
      case "copy-path":
        action = copyText(path);
        break;
      case "copy-relative-path":
        action = copyText(displayPath(path, cwd));
        break;
      default:
        return;
    }
    void action.catch((error) => {
      console.error(`Failed to run file-link action ${id}:`, error);
    });
  };

  return (
    <FileOpenContext.Provider value={fileOpen}>
      <Streamdown
        className={`agent-markdown min-w-0 font-sans text-sm leading-6 ${className ?? ""}`}
        components={MARKDOWN_COMPONENTS}
        controls={false}
        dir="auto"
        isAnimating={!!streaming}
        plugins={MARKDOWN_PLUGINS}
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
      >
        {text}
      </Streamdown>
      {fileMenu ? (
        <ExplorerMenu
          x={fileMenu.x}
          y={fileMenu.y}
          items={fileLinkMenuItems(!!onOpenFile, !!cwd)}
          ariaLabel="File link actions"
          onPick={onFileMenuPick}
          onClose={() => setFileMenu(null)}
        />
      ) : null}
    </FileOpenContext.Provider>
  );
});

export const MarkdownPreview = memo(function MarkdownPreview({
  text,
  streaming,
  cwd,
  onOpenFile,
}: {
  text: string;
  streaming?: boolean;
  cwd?: string;
  onOpenFile?: (path: string) => void;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();

  return (
    <div
      ref={lockOverscroll}
      className="markdown-preview h-full overflow-y-auto overscroll-none [overflow-anchor:none]"
    >
      <div className="px-6 py-8">
        <AgentMarkdown
          text={text}
          streaming={streaming}
          cwd={cwd}
          onOpenFile={onOpenFile}
        />
      </div>
    </div>
  );
});

export const MarkdownSource = memo(function MarkdownSource({
  text,
}: {
  text: string;
}) {
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();

  return (
    <div
      ref={lockOverscroll}
      className="markdown-preview h-full overflow-y-auto overscroll-none [overflow-anchor:none]"
    >
      <pre className="min-h-full min-w-0 whitespace-pre-wrap wrap-break-word px-4 py-3 font-mono text-[13px] leading-5 text-content/85">
        <MarkdownSourceHighlight text={text} />
      </pre>
    </div>
  );
});

export function MarkdownSourceHighlight({ text }: { text: string }) {
  if (!text) return null;
  return (
    <>
      {text.split(/(\n)/).map((part, index) =>
        part === "\n" ? (
          "\n"
        ) : isAtxHeadingLine(part) ? (
          <span key={index} className="markdown-source-heading">
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function MermaidBlock({
  code,
  incomplete,
}: {
  code: string;
  incomplete: boolean;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (incomplete) {
      setSvg(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    const id = `mermaid-${Math.abs(hashCode(code)).toString(36)}-${Date.now().toString(36)}`;
    void mermaid
      .getMermaid({
        ...MERMAID_BASE_CONFIG,
        theme: colorScheme === "light" ? "default" : "dark",
      })
      .render(id, code)
      .then((result) => {
        if (cancelled) return;
        setSvg(result.svg);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code, incomplete, colorScheme]);

  if (incomplete || failed) {
    return (
      <div className="markdown-code-shell" dir="ltr">
        <span className="markdown-code-icon" aria-hidden="true">
          <FileTypeIcon name="diagram.mmd" isDir={false} />
        </span>
        <CodeBlock
          code={code}
          isIncomplete={incomplete}
          language="mermaid"
          lineNumbers={false}
        />
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="h-32 animate-pulse rounded-[10px] border border-content/10 bg-content/6" />
    );
  }

  return (
    <div
      className="mermaid-block overflow-x-auto rounded-[10px] border border-content/10 bg-content/6 p-3"
      data-streamdown="mermaid-block"
      dir="ltr"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized mermaid SVG output
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function codeMeta(node: unknown): string {
  if (!node || typeof node !== "object" || !("properties" in node)) return "";
  const properties = node.properties;
  if (
    !properties ||
    typeof properties !== "object" ||
    !("metastring" in properties)
  ) {
    return "";
  }
  return typeof properties.metastring === "string" ? properties.metastring : "";
}

function textContent(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (Array.isArray(value)) return value.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(value)) {
    return textContent(value.props.children);
  }
  return "";
}

function parseCodeFence(
  className: string | undefined,
  meta: string,
): {
  language: string;
  startLine?: number;
  fileName?: string;
  filePath?: string;
} {
  const raw = className?.match(/\blanguage-([^\s]+)/)?.[1] ?? "";
  const metaStart = meta.match(/\bstartLine=(\d+)/);
  const metaStartLine = metaStart ? Number(metaStart[1]) : undefined;

  const citation = raw.match(/^(\d+):(\d+):(.+)$/);
  if (citation) {
    const filePath = citation[3];
    const fileName = filePath.split(/[/\\]/).filter(Boolean).pop() ?? filePath;
    return {
      language: languageFromFileName(fileName),
      startLine: Number(citation[1]),
      fileName,
      filePath,
    };
  }

  if (/[/\\]/.test(raw)) {
    const fileName = raw.split(/[/\\]/).filter(Boolean).pop() ?? raw;
    return {
      language: languageFromFileName(fileName),
      startLine: metaStartLine,
      fileName,
      filePath: raw,
    };
  }

  return { language: raw, startLine: metaStartLine };
}

function MarkdownCodePath({ path }: { path: string }) {
  const { cwd, onOpenFile, onFileContextMenu } = useContext(FileOpenContext);
  const filePath = resolveWorkspacePath(path, cwd);
  if (!filePath || !onOpenFile) {
    return <span className="markdown-code-path">{path}</span>;
  }
  return (
    <button
      type="button"
      className="markdown-code-path markdown-code-path-link"
      title={filePath}
      onClick={() => onOpenFile(filePath)}
      onContextMenu={(event) => {
        if (!onFileContextMenu) return;
        onFileContextMenu(event, filePath);
      }}
    >
      {path}
    </button>
  );
}

function languageFromFileName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile") return "makefile";
  const ext = lower.includes(".")
    ? lower.slice(lower.lastIndexOf(".") + 1)
    : lower;
  return LANGUAGE_FROM_EXT[ext] ?? ext;
}

function fileNameForLanguage(language: string): string {
  const key = language.toLowerCase();
  return LANGUAGE_FILE_NAMES[key] ?? `code.${key}`;
}

function inlineFileName(value: string): string | undefined {
  const text = value.trim();
  if (!text || text.length > 240 || /\s/.test(text)) return undefined;

  const withoutLocation = text.replace(
    /(?::\d+(?::\d+)?|#L\d+(?:-L\d+)?)$/,
    "",
  );
  const fileName = withoutLocation.split(/[/\\]/).filter(Boolean).pop();
  if (!fileName || !/^[\w@+().-]+$/.test(fileName)) return undefined;

  const lower = fileName.toLowerCase();
  if (
    lower === "dockerfile" ||
    lower === "makefile" ||
    lower === "gemfile" ||
    lower === "license"
  ) {
    return fileName;
  }

  const extension = fileName.split(".").pop();
  return extension && /^[a-z][a-z0-9+-]{0,11}$/i.test(extension)
    ? fileName
    : undefined;
}

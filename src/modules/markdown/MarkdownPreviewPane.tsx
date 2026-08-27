import { MarkdownCode } from "@/components/ai-elements/markdown-code";
import { cn } from "@/lib/utils";
import {
  isPathInRemoteWorkspace,
  remoteReadDocument,
} from "@/modules/remote";
import {
  type WorkspaceEnv,
  workspaceForDocumentPath,
  workspaceForNativeFs,
} from "@/modules/workspace";
import { useTranslation } from "@/modules/i18n";
import { invoke } from "@tauri-apps/api/core";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import { MarkdownDocContext } from "./lib/docContext";
import { MarkdownImage } from "./MarkdownImage";
import { MarkdownLink } from "./MarkdownLink";
import { MarkdownViewToggle } from "./MarkdownViewToggle";
import {
  createDomSearchController,
  type DomSearchMatchInfo,
} from "./lib/domSearch";

type ReadResult =
  | { kind: "text"; content: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "toolarge"; size: number; limit: number };

type Status =
  | { kind: "loading" }
  | { kind: "ready"; content: string }
  | { kind: "binary" }
  | { kind: "toolarge"; size: number; limit: number }
  | { kind: "error"; message: string };

export type MarkdownSearchHandle = {
  setQuery: (q: string) => DomSearchMatchInfo;
  findNext: () => DomSearchMatchInfo;
  findPrevious: () => DomSearchMatchInfo;
  clearQuery: () => void;
  focus: () => void;
};

type Props = {
  path: string;
  workspaceEnv: WorkspaceEnv;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
};

const components = {
  a: MarkdownLink,
  img: MarkdownImage,
  code: MarkdownCode,
};

const customRehypePlugins = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
];

export const MarkdownPreviewPane = forwardRef<MarkdownSearchHandle, Props>(
  function MarkdownPreviewPane(
    { path, workspaceEnv, visible, onSetView },
    ref,
  ) {
    const { t } = useTranslation();
    const [status, setStatus] = useState<Status>({ kind: "loading" });
    const contentRef = useRef<HTMLDivElement>(null);
    const searcherRef = useRef<ReturnType<typeof createDomSearchController> | null>(
      null,
    );

    useImperativeHandle(
      ref,
      () => ({
        setQuery: (q: string) => {
          if (!contentRef.current) return { current: 0, total: 0 };
          if (!searcherRef.current) {
            searcherRef.current = createDomSearchController(contentRef.current);
          }
          return searcherRef.current.setQuery(q);
        },
        findNext: () => {
          if (!searcherRef.current) return { current: 0, total: 0 };
          return searcherRef.current.findNext();
        },
        findPrevious: () => {
          if (!searcherRef.current) return { current: 0, total: 0 };
          return searcherRef.current.findPrevious();
        },
        clearQuery: () => {
          searcherRef.current?.clearQuery();
        },
        focus: () => {
          contentRef.current?.focus();
        },
      }),
      [],
    );

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: "loading" });
    const workspace = workspaceForDocumentPath(workspaceEnv, path);
    const read = isPathInRemoteWorkspace(workspace, path)
      ? remoteReadDocument(workspace, path, false)
      : invoke<ReadResult>("fs_read_file", {
          path,
          workspace: workspaceForNativeFs(workspace, path),
        });
    read
      .then((res) => {
        if (cancelled) return;
        if (res.kind === "text") {
          setStatus({ kind: "ready", content: res.content });
        } else if (res.kind === "binary") {
          setStatus({ kind: "binary" });
        } else {
          setStatus({ kind: "toolarge", size: res.size, limit: res.limit });
        }
      })
      .catch((e) => {
        if (!cancelled) setStatus({ kind: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [path, workspaceEnv]);

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden bg-background",
        !visible && "pointer-events-none",
      )}
    >
      <MarkdownViewToggle mode="rendered" onChange={onSetView} />
      <div className="flex-1 overflow-auto">
        <div ref={contentRef} className="px-8 py-6">
          {status.kind === "loading" && (
            <p className="text-[12px] text-muted-foreground">{t("common.loading")}</p>
          )}
          {status.kind === "error" && (
            <p className="text-[12px] text-destructive">
              {t("feedback.markdownReadFailed", { error: status.message })}
            </p>
          )}
          {status.kind === "binary" && (
            <p className="text-[12px] text-muted-foreground">
              {t("feedback.markdownBinary")}
            </p>
          )}
          {status.kind === "toolarge" && (
            <p className="text-[12px] text-muted-foreground">
              {t("feedback.markdownTooLarge", {
                size: status.size,
                limit: status.limit,
              })}
            </p>
          )}
          {status.kind === "ready" && (
            <MarkdownDocContext.Provider value={{ docPath: path, workspaceEnv }}>
              <Streamdown
                className="select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                components={components}
                rehypePlugins={customRehypePlugins}
                mode="static"
                parseIncompleteMarkdown={false}
              >
                {status.content}
              </Streamdown>
            </MarkdownDocContext.Provider>
          )}
        </div>
      </div>
    </div>
  );
});

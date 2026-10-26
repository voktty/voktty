import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EditorView } from "@codemirror/view";
import { toast } from "sonner";
import { t } from "@/modules/i18n";
import { lspPeek, lspOpenPeekItem } from "@/modules/lsp";
import type { LspPeekItem, LspPeekKind } from "@/modules/lsp/lib/client";
import type { WorkspaceEnv } from "@/modules/workspace";
import type { PeekDocumentState } from "@/modules/editor/components/PeekPanel";
import { buildPeekExcerpt, samePeekPath } from "@/modules/editor/lib/peekModel";
import { readPeekFile } from "@/modules/editor/lib/peekFile";

let pending = 0;
const MAX_PENDING = 256;

export function useEditorPeek(
  path: string,
  workspaceEnv: WorkspaceEnv,
  getView: () => EditorView | undefined,
) {
  const source = useMemo(
    () => ({ path, workspace: structuredClone(workspaceEnv) }),
    [path, workspaceEnv],
  );
  type Owner = {
    source: typeof source;
    request?: object;
    cache: Map<string, string>;
  };
  type Session = {
    owner: Owner;
    view: EditorView;
    doc: EditorView["state"]["doc"];
    kind: LspPeekKind;
    items: LspPeekItem[];
    activeIndex: number;
    isBound: () => boolean;
  };
  const ownerRef = useRef<Owner | null>(null);
  const viewRef = useRef(getView);
  viewRef.current = getView;
  const [session, setSession] = useState<Session | null>(null);
  const [display, setDisplay] = useState<{
    session: Session;
    document: PeekDocumentState;
  }>();
  const sessionRef = useRef<Session | null>(null);
  const frameRef = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const owner: Owner = { source, cache: new Map() };
    ownerRef.current = owner;
    return () => {
      if (ownerRef.current === owner) ownerRef.current = null;
      sessionRef.current = null;
      if (frameRef.current !== undefined)
        cancelAnimationFrame(frameRef.current);
    };
  }, [source]);
  const owns = useCallback(
    (owner: Owner, view: EditorView) =>
      ownerRef.current === owner &&
      owner.source === source &&
      viewRef.current() === view,
    [source],
  );
  const publish = (next: Session | null) => {
    sessionRef.current = next;
    setSession(next);
  };
  const dismiss = useCallback(() => {
    const owner = ownerRef.current;
    if (!owner || owner.source !== source) return;
    owner.request = undefined;
    sessionRef.current = null;
    setSession(null);
  }, [source]);
  const request = async (kind: LspPeekKind) => {
    const owner = ownerRef.current;
    const view = viewRef.current();
    if (!owner || !view || !owns(owner, view) || pending >= MAX_PENDING) return;
    const receipt = {};
    owner.request = receipt;
    const doc = view.state.doc;
    const current = () =>
      owns(owner, view) && owner.request === receipt && view.state.doc === doc;
    pending++;
    try {
      const result = await lspPeek(view, kind, current);
      if (!current()) return;
      if (result.status !== "ready") {
        if (result.status === "unsupported")
          toast.info(t("editor.navigation.unavailable"));
        else if (result.status === "empty")
          toast.info(t("editor.navigation.empty"));
        return;
      }
      if (result.truncated) toast.warning(t("editor.peek.resultsTruncated"));
      if (!current()) return;
      publish({
        owner,
        view,
        doc,
        kind,
        items: result.items.slice(0, 500),
        activeIndex: 0,
        isBound: result.isCurrent ?? current,
      });
    } catch {
      if (current()) toast.error(t("editor.navigation.requestFailed"));
    } finally {
      pending--;
    }
  };
  const currentSession = useCallback(
    (value: Session) =>
      sessionRef.current === value &&
      owns(value.owner, value.view) &&
      value.view.state.doc === value.doc &&
      value.isBound(),
    [owns],
  );
  useEffect(() => {
    if (!session || !currentSession(session)) return;
    const item = session.items[session.activeIndex];
    if (!item) return;
    let active = true;
    const current = () => active && currentSession(session);
    const setDocument = (document: PeekDocumentState) =>
      setDisplay((previous) => (current() ? { session, document } : previous));
    setDocument({ status: "loading" });
    const load = async () => {
      if (pending >= MAX_PENDING) {
        if (current()) setDocument({ status: "error" });
        return;
      }
      pending++;
      try {
        let content = samePeekPath(item.path, source.path)
          ? session.doc.toString()
          : session.owner.cache.get(item.path);
        if (content === undefined) {
          const result = await readPeekFile(
            item.path,
            source.workspace,
            current,
          );
          if (!current()) return;
          if (result.status !== "ready") {
            setDocument({ status: result.status });
            return;
          }
          content = result.content;
          const cache = session.owner.cache;
          cache.set(item.path, content);
          while (cache.size > 4) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            cache.delete(oldest);
          }
        }
        if (!current()) return;
        const excerpt = buildPeekExcerpt(content, item.line, item.character);
        setDocument(
          excerpt ? { status: "ready", excerpt } : { status: "invalid" },
        );
      } catch {
        if (current()) setDocument({ status: "error" });
      } finally {
        pending--;
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [session, source, currentSession]);
  const visible = session && currentSession(session) ? session : null;
  return {
    request,
    dismiss,
    panel: visible
      ? {
          kind: visible.kind,
          items: visible.items,
          activeIndex: visible.activeIndex,
          document:
            display?.session === visible
              ? display.document
              : { status: "loading" as const },
          onSelect: (activeIndex: number) => {
            if (
              !currentSession(visible) ||
              !Number.isInteger(activeIndex) ||
              activeIndex < 0 ||
              activeIndex >= visible.items.length
            )
              return;
            publish({ ...visible, activeIndex });
          },
          onOpen: async (item: LspPeekItem) => {
            if (
              !currentSession(visible) ||
              !visible.items.includes(item) ||
              pending >= MAX_PENDING
            )
              return;
            pending++;
            try {
              const opened = await lspOpenPeekItem(visible.view, item, () =>
                currentSession(visible),
              );
              if (!currentSession(visible)) return;
              if (opened) dismiss();
              else toast.info(t("editor.navigation.unavailable"));
            } catch {
              if (currentSession(visible))
                toast.error(t("editor.navigation.requestFailed"));
            } finally {
              pending--;
            }
          },
          onClose: () => {
            if (!currentSession(visible)) return;
            dismiss();
            if (frameRef.current !== undefined)
              cancelAnimationFrame(frameRef.current);
            frameRef.current = requestAnimationFrame(() => {
              frameRef.current = undefined;
              if (
                owns(visible.owner, visible.view) &&
                visible.owner.request === undefined &&
                sessionRef.current === null
              )
                visible.view.focus();
            });
          },
        }
      : null,
  };
}

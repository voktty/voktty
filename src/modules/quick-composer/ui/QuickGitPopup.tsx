import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BranchPicker } from "@/modules/harness/chrome/BranchPicker";
import {
  seedProjectBranches,
  useProjectBranchesState,
} from "@/modules/harness/hooks/useProjectBranches";
import {
  QUICK_GIT_REQUEST,
  type QuickGitRequest,
} from "../model/quickGitPopup";
import type { QuickWorkspace } from "../model/quickWorkspace";

export function QuickGitPopup({ onShown }: { onShown: () => void }) {
  const [request, setRequest] = useState<QuickGitRequest | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let disposed = false;
    let received = false;
    let stop: (() => void) | undefined;
    const accept = (req: QuickGitRequest | null) => {
      if (disposed) return;
      onShown();
      if (req?.branches) {
        seedProjectBranches(
          req.choice.tree?.path ?? req.choice.cwd ?? "",
          req.branches,
        );
      }
      if (errorRef.current) errorRef.current.textContent = "";
      setRequest(req);
    };
    void listen<QuickGitRequest>(QUICK_GIT_REQUEST, ({ payload }) => {
      received = true;
      accept(payload);
    })
      .then(async (unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        stop = unlisten;
        const initial = await invoke<QuickGitRequest | null>("quick_git_state");
        if (!received) accept(initial);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      stop?.();
    };
  }, [onShown]);

  useLayoutEffect(() => {
    if (!host || !request) return;
    let lastHeight = 0;
    const fit = () => {
      const height = Math.ceil(host.getBoundingClientRect().height);
      if (height <= 2 || height === lastHeight) return;
      lastHeight = height;
      void invoke("quick_git_fit", { id: request.id, height }).catch(
        () => undefined,
      );
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    fit();
    return () => observer.disconnect();
  }, [host, request]);

  useEffect(() => {
    const focus = () =>
      requestAnimationFrame(() =>
        host
          ?.querySelector<HTMLInputElement>("input, textarea")
          ?.focus({ preventScroll: true }),
      );
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [host]);

  const finish = useCallback(async (id: string, choice?: QuickWorkspace) => {
    try {
      await invoke("quick_git_complete", {
        id,
        choice: choice ?? null,
        restoreFocus: true,
      });
    } catch (error) {
      if (errorRef.current) errorRef.current.textContent = String(error);
      throw error;
    }
  }, []);

  return (
    <div
      ref={setHost}
      className="max-h-[520px] overflow-y-auto rounded-xl border border-content/10 bg-background-base/45 text-content"
    >
      <p
        ref={errorRef}
        role="alert"
        className="empty:hidden px-3 py-2 text-xs text-red-400"
      />
      {host && request ? (
        <QuickGitPopupPicker
          key={request.id}
          request={request}
          onFinish={finish}
        />
      ) : null}
    </div>
  );
}

export function QuickGitPopupPicker({
  request,
  onFinish,
}: {
  request: QuickGitRequest;
  onFinish: (id: string, choice?: QuickWorkspace) => Promise<void>;
}) {
  const finished = useRef(false);
  const { choice } = request;
  const cwd = choice.tree?.path ?? choice.cwd ?? "";
  const { branches, settled } = useProjectBranchesState(cwd, true);
  const finish = useCallback(
    (value?: QuickWorkspace) => {
      if (finished.current) return;
      finished.current = true;
      void onFinish(request.id, value).catch(() => {
        finished.current = false;
      });
    },
    [onFinish, request.id],
  );
  const waiting = !settled || !branches;
  useEffect(() => {
    if (!waiting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      finish();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [waiting, finish]);

  if (waiting)
    return (
      <div className="flex items-center gap-3 px-3 py-3 text-xs">
        <p role="status" className="flex-1 text-content/60">
          {settled
            ? "Couldn’t load branches for this project."
            : "Loading branches…"}
        </p>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-content/70 hover:bg-content/10"
          onClick={() => finish()}
        >
          Close
        </button>
      </div>
    );
  return (
    <BranchPicker
      cwd={cwd}
      worktree={!!choice.tree && !choice.tree.isMain}
      initialOpen
      onDismiss={() => finish()}
      onChange={() => finish(choice)}
      onClose={() => finish()}
    />
  );
}

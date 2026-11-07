import { native } from "@/modules/ai/lib/native";
import { LOCAL_WORKSPACE } from "@/modules/workspace";
import { useEffect, useState } from "react";
import {
  detectWebProject,
  isLocalProjectRoot,
  type WebProjectKind,
} from "./webProject";

/** Top-level kind of the web project in `root`, or null while unknown or not a web project. */
export function useWebProjectKind(
  root: string | null | undefined,
): WebProjectKind | null {
  const [state, setState] = useState<{
    root: string;
    kind: WebProjectKind | null;
  } | null>(null);

  useEffect(() => {
    if (!isLocalProjectRoot(root)) return;
    let current = true;
    void native
      .readDir(root, LOCAL_WORKSPACE)
      .then((entries) => {
        if (current) setState({ root, kind: detectWebProject(entries) });
      })
      .catch(() => {
        if (current) setState({ root, kind: null });
      });
    return () => {
      current = false;
    };
  }, [root]);

  return state && state.root === root ? state.kind : null;
}

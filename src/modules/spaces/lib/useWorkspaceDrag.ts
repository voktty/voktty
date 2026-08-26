import { useSyncExternalStore } from "react";
import {
  getWorkspaceDragState,
  subscribeWorkspaceDrag,
  type WorkspaceDragState,
} from "./workspaceDrag";

const emptySnapshot: WorkspaceDragState = {
  active: false,
  source: null,
  target: null,
  pointer: null,
};

export function useWorkspaceDrag(): WorkspaceDragState {
  return useSyncExternalStore(
    subscribeWorkspaceDrag,
    getWorkspaceDragState,
    () => emptySnapshot,
  );
}

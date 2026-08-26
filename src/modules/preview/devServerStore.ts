import { create } from "zustand";
import {
  createDevServerOutputDetector,
  devServerLinkScope,
  type DevServerOutputDetector,
} from "./lib/devServerCapture";

export type DevServerCapture = {
  id: string;
  leafId: number;
  ptyId: number | null;
  commandGeneration: number;
  workspaceKey: string;
  cwd: string | null;
  scope: string;
  url: string;
  detectedAt: number;
};

type ActiveCommand = {
  generation: number;
  ptyId: number | null;
  workspaceKey: string;
  cwd: string | null;
  detector: DevServerOutputDetector;
};

type CommandContext = Omit<ActiveCommand, "generation" | "detector">;

type State = {
  capturesByLeaf: Record<number, DevServerCapture[]>;
  commandsByLeaf: Record<number, ActiveCommand>;
  beginCommand: (leafId: number, context: CommandContext) => void;
  processOutput: (leafId: number, chunk: string) => void;
  endCommand: (leafId: number) => void;
  clearLeaf: (leafId: number) => void;
};

const generations = new Map<number, number>();

function nextGeneration(leafId: number): number {
  const generation = (generations.get(leafId) ?? 0) + 1;
  generations.set(leafId, generation);
  return generation;
}

function withoutLeaf<T>(record: Record<number, T>, leafId: number) {
  if (!(leafId in record)) return record;
  const next = { ...record };
  delete next[leafId];
  return next;
}

export const useDevServerCaptureStore = create<State>((set, get) => ({
  capturesByLeaf: {},
  commandsByLeaf: {},
  beginCommand: (leafId, context) => {
    const previous = get().commandsByLeaf[leafId];
    previous?.detector.reset();
    const command: ActiveCommand = {
      ...context,
      generation: nextGeneration(leafId),
      detector: createDevServerOutputDetector(),
    };
    set((state) => ({
      commandsByLeaf: { ...state.commandsByLeaf, [leafId]: command },
      capturesByLeaf: withoutLeaf(state.capturesByLeaf, leafId),
    }));
  },
  processOutput: (leafId, chunk) => {
    const command = get().commandsByLeaf[leafId];
    if (!command) return;
    const urls = command.detector.push(chunk);
    if (urls.length === 0) return;
    set((state) => {
      if (state.commandsByLeaf[leafId] !== command) return state;
      const previous = state.capturesByLeaf[leafId] ?? [];
      const known = new Set(previous.map((capture) => capture.url));
      const detectedAt = Date.now();
      const additions = urls
        .filter((url) => !known.has(url))
        .map((url) => ({
          id: `${leafId}:${command.generation}:${url}`,
          leafId,
          ptyId: command.ptyId,
          commandGeneration: command.generation,
          workspaceKey: command.workspaceKey,
          cwd: command.cwd,
          scope: devServerLinkScope(command.workspaceKey, command.cwd, url),
          url,
          detectedAt,
        }));
      if (additions.length === 0) return state;
      return {
        capturesByLeaf: {
          ...state.capturesByLeaf,
          [leafId]: [...previous, ...additions],
        },
      };
    });
  },
  endCommand: (leafId) => {
    get().commandsByLeaf[leafId]?.detector.reset();
    set((state) => ({
      commandsByLeaf: withoutLeaf(state.commandsByLeaf, leafId),
      capturesByLeaf: withoutLeaf(state.capturesByLeaf, leafId),
    }));
  },
  clearLeaf: (leafId) => {
    get().commandsByLeaf[leafId]?.detector.reset();
    generations.delete(leafId);
    set((state) => ({
      commandsByLeaf: withoutLeaf(state.commandsByLeaf, leafId),
      capturesByLeaf: withoutLeaf(state.capturesByLeaf, leafId),
    }));
  },
}));

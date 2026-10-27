import { createProjectFileSourceStore } from "@/modules/remote/projectFileSource";

export class PromptSourceRetiredError extends Error {
  constructor() {
    super("The project changed while preparing this message. Submit it again.");
  }
}

let pending = 0;
const MAX_PENDING = 256;

function failedSource(error: unknown) {
  return {
    isCurrent: () => false,
    assertCurrent: () => {
      throw error;
    },
    release: () => {},
  };
}

export function captureRemotePromptSource(cwd: string) {
  if (!cwd.startsWith("remote://voktty-ssh-")) return;
  if (pending >= MAX_PENDING)
    return failedSource(
      new Error("Project prompt preparation capacity exceeded."),
    );
  pending++;
  let stop: (() => void) | undefined;
  try {
    const store = createProjectFileSourceStore(cwd);
    const key = store.getSnapshot().source?.key;
    stop = store.subscribe(() => {});
    const source = store.getSnapshot().source;
    if (!source)
      throw new Error("The saved project connection is unavailable.");
    if (source.key !== key) throw new PromptSourceRetiredError();
    let released = false;
    const isCurrent = () => !released && source.isCurrent();
    return {
      isCurrent,
      assertCurrent: () => {
        if (!isCurrent()) throw new PromptSourceRetiredError();
      },
      release: () => {
        if (released) return;
        released = true;
        try {
          stop?.();
        } finally {
          pending--;
        }
      },
    };
  } catch (error) {
    try {
      stop?.();
    } finally {
      pending--;
    }
    return failedSource(error);
  }
}

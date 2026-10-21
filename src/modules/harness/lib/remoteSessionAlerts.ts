export type RemoteSessionProblem = {
  kind: "save-failed" | "no-saved-project";
  cwd: string;
  message: string;
};

type Listener = (problem: RemoteSessionProblem) => void;

const REPEAT_AFTER_MS = 5 * 60_000;
const MAX_REMEMBERED = 64;
const listeners = new Set<Listener>();
const lastReported = new Map<string, number>();

export function subscribeRemoteSessionProblems(
  listener: Listener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Tells the user a conversation on an SSH project is not reaching its
 * `.voktty` folder. Saving is silent by design, so without this a failed write
 * looks exactly like a history that was never kept. A given project and cause
 * repeat at most once every few minutes. */
export function reportRemoteSessionProblem(
  kind: RemoteSessionProblem["kind"],
  cwd: string,
  error?: unknown,
  now: number = Date.now(),
): boolean {
  const key = `${kind}\0${cwd}`;
  const previous = lastReported.get(key);
  if (previous !== undefined && now - previous < REPEAT_AFTER_MS) return false;
  lastReported.delete(key);
  lastReported.set(key, now);
  while (lastReported.size > MAX_REMEMBERED) {
    const oldest = lastReported.keys().next().value;
    if (oldest === undefined) break;
    lastReported.delete(oldest);
  }
  const problem: RemoteSessionProblem = {
    kind,
    cwd,
    message: error === undefined ? "" : errorMessage(error),
  };
  for (const listener of listeners) listener(problem);
  return true;
}

export function resetRemoteSessionProblems(): void {
  lastReported.clear();
}

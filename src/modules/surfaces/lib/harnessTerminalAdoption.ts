import type { TabKey } from "@/modules/tabs/lib/tabIdentity";

/** A terminal tab offered to a Harness, described by the app that owns it. */
export type AdoptableTerminal = Readonly<{
  tabKey: TabKey;
  cwd: string;
  title?: string;
  /**
   * Binds the terminal to the Harness project and returns the stored
   * project path, or undefined when the terminal cannot join it.
   */
  assignProject: (projectCwd: string) => string | undefined;
}>;

type Handler = (terminal: AdoptableTerminal) => boolean;

const handlers = new Map<TabKey, Handler>();

/**
 * Lets the Harness view shown in `hostTabKey` accept terminals dropped on it.
 * Only the registering view can answer, and only while it stays registered.
 */
export function registerHarnessTerminalAdoption(
  hostTabKey: TabKey,
  handler: Handler,
): () => void {
  handlers.set(hostTabKey, handler);
  return () => {
    if (handlers.get(hostTabKey) === handler) handlers.delete(hostTabKey);
  };
}

/** Offers a terminal to one Harness view; false when nothing accepted it. */
export function requestHarnessTerminalAdoption(
  hostTabKey: TabKey,
  terminal: AdoptableTerminal,
): boolean {
  const handler = handlers.get(hostTabKey);
  if (!handler) return false;
  try {
    return handler(terminal);
  } catch {
    return false;
  }
}

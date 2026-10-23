import type { TabKey } from "@/modules/tabs/lib/tabIdentity";
import { isTerminalTitle } from "@/modules/tabs/lib/terminalTitle";

export const PROJECT_TERMINAL_REQUEST_EVENT = "voktty:request-project-terminal";
export type ProjectTerminalReference = Readonly<{ tabKey: TabKey }>;
type RequestOptions = {
  ownerTabKey: TabKey;
  projectCwd: string;
  cwd?: string;
  title?: string;
  cold?: boolean;
  isCurrent?: () => boolean;
  onCreated?: (terminal: ProjectTerminalReference) => void;
};
type Ticket = {
  readonly ownerTabKey: TabKey;
  readonly projectCwd: string;
  readonly cwd: string | undefined;
  readonly title: string | undefined;
  readonly cold: boolean | undefined;
  readonly signal: AbortSignal;
  claimed: boolean;
  isCurrent: () => boolean;
  created: (terminal: ProjectTerminalReference) => void;
  fail: (error: unknown) => void;
  finish: () => void;
};
const tickets = new WeakMap<object, Ticket>();
let pending = 0;

function aborted() {
  const error = new Error("Terminal creation was retired or declined.");
  error.name = "AbortError";
  return error;
}

export function requestProjectTerminal(input: RequestOptions) {
  const options = { ...input };
  if (pending >= 256) throw new Error("Terminal request limit reached.");
  if (
    ![options.ownerTabKey, options.projectCwd].every(
      (value) =>
        typeof value === "string" &&
        value.length > 0 &&
        value.length <= 32768 &&
        !/[\x00-\x1f\x7f]/.test(value),
    ) ||
    (options.cwd !== undefined &&
      (typeof options.cwd !== "string" ||
        options.cwd.length > 32768 ||
        /[\x00-\x1f\x7f]/.test(options.cwd))) ||
    (options.title !== undefined && !isTerminalTitle(options.title)) ||
    (options.cold !== undefined && typeof options.cold !== "boolean")
  )
    throw new Error("Invalid project terminal request.");
  const key = {};
  const controller = new AbortController();
  let live = true;
  let settled = false;
  let reference: ProjectTerminalReference | undefined;
  let error: unknown;
  let failed = false;
  let resolve!: (terminal: ProjectTerminalReference) => void;
  let reject!: (reason: unknown) => void;
  const result = new Promise<ProjectTerminalReference>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const isCurrent = () => live && !settled && (options.isCurrent?.() ?? true);
  const ticket: Ticket = {
    ownerTabKey: options.ownerTabKey,
    projectCwd: options.projectCwd,
    cwd: options.cwd,
    title: options.title,
    cold: options.cold,
    signal: controller.signal,
    claimed: false,
    isCurrent,
    created: (terminal) => {
      if (!isCurrent()) throw aborted();
      if (reference)
        throw new Error("Terminal creation was already confirmed.");
      const captured = Object.freeze({ tabKey: terminal.tabKey });
      options.onCreated?.(captured);
      reference = captured;
    },
    fail: (reason) => {
      if (!failed) {
        failed = true;
        error = reason;
      }
    },
    finish: () => {
      if (settled) return;
      try {
        if (failed) reject(error);
        else if (reference && isCurrent()) resolve(reference);
        else reject(aborted());
      } catch (reason) {
        reject(reason);
      } finally {
        settled = true;
        tickets.delete(key);
        pending--;
      }
    },
  };
  tickets.set(key, ticket);
  pending++;
  try {
    window.dispatchEvent(
      new CustomEvent(PROJECT_TERMINAL_REQUEST_EVENT, { detail: key }),
    );
    if (!ticket.claimed) {
      ticket.fail(
        new Error(
          "The owning Harness view is unavailable for this terminal request.",
        ),
      );
      ticket.finish();
    }
  } catch (reason) {
    ticket.fail(reason);
    ticket.finish();
  }
  return {
    result,
    cancel: () => {
      live = false;
      controller.abort();
    },
  };
}

export function claimProjectTerminalRequest(
  event: Event,
  ownerTabKey: TabKey | undefined,
  projectCwd: string | null | undefined,
): Ticket | undefined {
  const detail: unknown = (event as CustomEvent<unknown>).detail;
  if (!detail || typeof detail !== "object") return undefined;
  const ticket = tickets.get(detail);
  if (
    !ticket ||
    ticket.claimed ||
    ticket.ownerTabKey !== ownerTabKey ||
    ticket.projectCwd !== projectCwd
  )
    return undefined;
  ticket.claimed = true;
  return ticket;
}

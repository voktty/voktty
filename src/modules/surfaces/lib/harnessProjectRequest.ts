import type { Tab } from "@/modules/tabs";
import { isTabKey, type TabKey } from "@/modules/tabs/lib/tabIdentity";

export type HarnessProjectTarget = { ownerId: number; tabKey: TabKey };
export type HarnessProjectRequest = { path: string; target?: HarnessProjectTarget };
export type DirectedHarnessProjectRequest = Readonly<{
  path: string;
  target: Readonly<HarnessProjectTarget>;
}>;

const subscribers = new Set<{
  receive: (request: DirectedHarnessProjectRequest) => void;
}>();

export function subscribeHarnessProjectRequests(
  receive: (request: DirectedHarnessProjectRequest) => void,
): () => void {
  if (subscribers.size >= 256)
    throw new Error("Too many Harness project request subscribers.");
  const entry = { receive };
  subscribers.add(entry);
  return () => {
    subscribers.delete(entry);
  };
}

export function parseHarnessProjectRequest(detail: unknown): HarnessProjectRequest | null {
  if (!detail || typeof detail !== "object") return null;
  const input = detail as { path?: unknown; target?: unknown };
  if (typeof input.path !== "string" || !input.path.trim() || input.path.length > 32768) return null;
  if (!("target" in input)) return { path: input.path };
  if (!input.target || typeof input.target !== "object") return null;
  const target = input.target as { ownerId?: unknown; tabKey?: unknown };
  if (typeof target.ownerId !== "number" || !Number.isSafeInteger(target.ownerId) || target.ownerId <= 0 ||
    !isTabKey(target.tabKey) || target.tabKey.length > 4096) return null;
  return { path: input.path, target: { ownerId: target.ownerId, tabKey: target.tabKey } };
}

export function harnessProjectTargetMatches(target: HarnessProjectTarget, tab: Tab): boolean {
  return tab.kind === "harness" && tab.id === target.ownerId && tab.tabKey === target.tabKey;
}

export function requestHarnessProject(path: string, target: HarnessProjectTarget): void {
  const request = parseHarnessProjectRequest({ path, target });
  if (!request?.target) return;
  const directed = Object.freeze({
    path: request.path,
    target: Object.freeze(request.target),
  });
  for (const entry of [...subscribers]) {
    if (subscribers.has(entry)) entry.receive(directed);
  }
}

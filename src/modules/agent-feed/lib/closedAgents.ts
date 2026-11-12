import type { FeedAgent, TimelineItem } from "./feedModel";

/** Names of the agents whose session has closed. */
export function closedAgentNames(agents: readonly FeedAgent[]): Set<string> {
  return new Set(
    agents.filter((agent) => agent.status === "gone").map((agent) => agent.name),
  );
}

/**
 * True when an entry belongs to a closed agent: a message it sent, or its
 * notes, the orders it received and its arrivals and departures. Messages an
 * active agent sent to a closed one stay, since they are the sender's work.
 */
export function belongsToClosedAgent(
  item: TimelineItem,
  closed: ReadonlySet<string>,
): boolean {
  return closed.has(item.kind === "message" ? item.from : item.agent);
}

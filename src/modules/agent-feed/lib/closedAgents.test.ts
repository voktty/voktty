import { describe, expect, it } from "vitest";
import { belongsToClosedAgent, closedAgentNames } from "./closedAgents";
import type { FeedAgent, TimelineItem } from "./feedModel";

const agent = (name: string, status: FeedAgent["status"]): FeedAgent => ({
  name,
  sessionIds: [],
  status,
  tmux: null,
  orchestrator: false,
  lastTs: null,
});

const message = (from: string, to: string): TimelineItem => ({
  kind: "message",
  id: `${from}-${to}`,
  ts: "2026-11-12T11:53:00Z",
  from,
  to,
  summary: null,
  text: "hola",
  truncated: false,
  delivered: true,
});

describe("closed agents", () => {
  const closed = closedAgentNames([
    agent("web", "busy"),
    agent("pix", "idle"),
    agent("#07f5fb8a", "gone"),
    agent("panel-crm", "gone"),
  ]);

  it("only counts agents whose session has closed", () => {
    expect([...closed].sort()).toEqual(["#07f5fb8a", "panel-crm"]);
  });

  it("hides what a closed agent said but keeps what active agents said to it", () => {
    expect(belongsToClosedAgent(message("panel-crm", "web"), closed)).toBe(true);
    expect(belongsToClosedAgent(message("web", "panel-crm"), closed)).toBe(false);
    expect(
      belongsToClosedAgent(
        { kind: "left", id: "l", ts: "2026-11-12T11:00:00Z", agent: "#07f5fb8a" },
        closed,
      ),
    ).toBe(true);
    expect(
      belongsToClosedAgent(
        { kind: "joined", id: "j", ts: "2026-11-12T11:00:00Z", agent: "pix" },
        closed,
      ),
    ).toBe(false);
  });
});

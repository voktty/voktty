import { describe, expect, it } from "vitest";
import type { Session } from "./session";
import { inboxItems, inboxNotificationCount } from "./inbox";

function session(id: string, cwd = "/tmp/app"): Session {
  return {
    id,
    harness: "cursor",
    model: "default",
    modelSettings: {},
    runtimeMode: "supervised",
    title: id,
    cwd,
    blocks: [],
  };
}

describe("inboxItems", () => {
  it("returns approvals before done items", () => {
    const sessions = [session("a"), session("b"), session("c")];
    expect(
      inboxItems(sessions, new Set(["b"]), new Set(["a", "c"])).map(
        (item) => item.session.id,
      ),
    ).toEqual(["b", "a", "c"]);
  });

  it("skips sessions that are neither approval nor done", () => {
    expect(
      inboxItems([session("a"), session("b")], new Set(), new Set(["b"])).map(
        (item) => item.session.id,
      ),
    ).toEqual(["b"]);
  });
});

describe("inboxNotificationCount", () => {
  it("counts unique sessions across approval and done", () => {
    expect(
      inboxNotificationCount(new Set(["a", "b"]), new Set(["b", "c"])),
    ).toBe(3);
  });
});

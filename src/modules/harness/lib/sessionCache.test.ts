import { describe, expect, it } from "vitest";
import { newSession } from "./session";
import { rememberLoadedSession } from "./sessionCache";

function chat(id: string): ReturnType<typeof newSession> {
  const session = newSession("cursor", "/tmp/project");
  session.id = id;
  return session;
}

describe("rememberLoadedSession", () => {
  it("keeps the newest session and drops the oldest past the limit", () => {
    const cache = new Map();
    rememberLoadedSession(cache, chat("a"), 2);
    rememberLoadedSession(cache, chat("b"), 2);
    rememberLoadedSession(cache, chat("c"), 2);
    expect([...cache.keys()]).toEqual(["b", "c"]);
  });

  it("treats a repeat as newest so it is not evicted", () => {
    const cache = new Map();
    rememberLoadedSession(cache, chat("a"), 2);
    rememberLoadedSession(cache, chat("b"), 2);
    rememberLoadedSession(cache, chat("a"), 2);
    rememberLoadedSession(cache, chat("c"), 2);
    expect([...cache.keys()]).toEqual(["a", "c"]);
  });
});

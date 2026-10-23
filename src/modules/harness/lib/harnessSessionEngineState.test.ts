import { describe, expect, it } from "vitest";
import {
  applyHarnessSessionDeltas,
  harnessSessionDeltas,
} from "@/modules/harness/lib/harnessSessionEngineState";
import type { Session } from "@/modules/harness/lib/session";

function session(id: string): Session {
  return {
    id,
    harness: "claude",
    model: "test",
    modelSettings: {},
    runtimeMode: "supervised",
    cwd: "/repo",
    title: id,
    blocks: [],
  };
}

describe("Harness engine affected-ID mutations", () => {
  it("rejects new admissions to a reserved project without mutating the source", () => {
    const existing = session("existing");
    const source = [existing];
    expect(() =>
      applyHarnessSessionDeltas(
        source,
        [
          { kind: "remove", id: "existing" },
          { kind: "admit", session: session("new") },
        ],
        () => true,
      ),
    ).toThrow("reserved");
    expect(source).toEqual([existing]);
  });

  it("rejects relocation into or out of a reserved project after the reducer", () => {
    const existing = session("existing");
    for (const reserved of ["/repo", "/other"]) {
      expect(() =>
        applyHarnessSessionDeltas(
          [existing],
          [
            {
              kind: "update",
              id: existing.id,
              update: (current) => ({ ...current, cwd: "/other" }),
            },
          ],
          (path) => path === reserved,
        ),
      ).toThrow("reserved");
    }
    expect(existing.cwd).toBe("/repo");
  });

  it("allows current transcript updates, duplicate admission and removal in a reserved project", () => {
    const existing = session("existing");
    expect(
      applyHarnessSessionDeltas(
        [existing],
        [
          { kind: "admit", session: session("existing") },
          {
            kind: "update",
            id: existing.id,
            update: (current) => ({ ...current, title: "streaming" }),
          },
        ],
        () => true,
      )[0].title,
    ).toBe("streaming");
    expect(
      applyHarnessSessionDeltas(
        [existing],
        [{ kind: "remove", id: existing.id }],
        () => true,
      ),
    ).toEqual([]);
  });

  it("checks the current reservation after a reentrant reducer", () => {
    let reserved = false;
    expect(() =>
      applyHarnessSessionDeltas(
        [session("one")],
        [
          {
            kind: "update",
            id: "one",
            update: (current) => {
              reserved = true;
              return { ...current, cwd: "/other" };
            },
          },
        ],
        () => reserved,
      ),
    ).toThrow("reserved");
  });

  it("never replaces unrelated concurrent sessions with a captured workspace", () => {
    const a = session("a");
    const b = session("b");
    const changedB = { ...b, busy: true };
    const c = session("c");
    const deltas = harnessSessionDeltas(
      [a, b],
      [{ ...a, title: "renamed" }, b],
      ["a"],
    );
    const result = applyHarnessSessionDeltas([a, changedB, c], deltas);
    expect(result).toEqual([{ ...a, title: "renamed" }, changedB, c]);
    expect(result[1]).toBe(changedB);
    expect(result[2]).toBe(c);
  });

  it("does not resurrect a removed or replacement incarnation from stale deltas", () => {
    const old = session("a");
    const replacement = session("a");
    const deltas = harnessSessionDeltas([old], [{ ...old, busy: true }], ["a"]);
    expect(applyHarnessSessionDeltas([], deltas)).toEqual([]);
    expect(applyHarnessSessionDeltas([replacement], deltas)[0]).toBe(
      replacement,
    );
  });

  it("admits once and removes only the explicit identity", () => {
    const a = session("a");
    const b = session("b");
    const replacement = session("a");
    expect(
      applyHarnessSessionDeltas(
        [a, b],
        [{ kind: "admit", session: replacement }],
      )[0],
    ).toBe(a);
    expect(
      applyHarnessSessionDeltas([a, b], [{ kind: "remove", id: "a" }]),
    ).toEqual([b]);
  });

  it("preserves array and Session identities for no-op updates", () => {
    const a = session("a");
    const list = [a];
    expect(
      applyHarnessSessionDeltas(list, [
        { kind: "update", id: "a", update: (current) => current },
      ]),
    ).toBe(list);
  });

  it("revalidates an idle removal predicate at application time", () => {
    const a = session("a");
    const list = [a];
    let referenced = false;
    const delta = {
      kind: "remove" as const,
      id: "a",
      expected: a,
      shouldRemove: () => !referenced,
    };
    referenced = true;
    expect(applyHarnessSessionDeltas(list, [delta])).toBe(list);
    referenced = false;
    expect(applyHarnessSessionDeltas(list, [delta])).toEqual([]);
  });

  it("rejects a reducer that changes session identity", () => {
    expect(() =>
      applyHarnessSessionDeltas(
        [session("a")],
        [
          {
            kind: "update",
            id: "a",
            update: (current) => ({ ...current, id: "b" }),
          },
        ],
      ),
    ).toThrow(/identity/);
  });
});

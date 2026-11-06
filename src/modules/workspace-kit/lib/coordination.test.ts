import { describe, expect, it } from "vitest";
import {
  checkReservationConflict,
  normalizeReservationPath,
  parseMailboxNote,
  parseWorkReservation,
  pathsOverlap,
  type WorkReservation,
} from "./coordination";

describe("workspace-kit coordination", () => {
  it("normalizes reservation paths and strips leading slashes or dots", () => {
    expect(normalizeReservationPath("src/editor/")).toBe("src/editor");
    expect(normalizeReservationPath("./src/editor/retry.ts")).toBe(
      "src/editor/retry.ts",
    );
    expect(normalizeReservationPath("src\\editor\\retry.ts")).toBe(
      "src/editor/retry.ts",
    );
    expect(normalizeReservationPath("")).toBeNull();
    expect(normalizeReservationPath("../sneaky")).toBeNull();
    expect(normalizeReservationPath("src/../sneaky")).toBeNull();
  });

  it("detects path overlaps for nested directories and files", () => {
    expect(pathsOverlap("src/editor/", "src/editor/retry.ts")).toBe(true);
    expect(pathsOverlap("src/editor", "src/editor/retry.ts")).toBe(true);
    expect(pathsOverlap("src/editor/retry.ts", "src/editor/")).toBe(true);
    expect(pathsOverlap("src/", "src/editor/")).toBe(true);
    expect(pathsOverlap("src/editor/retry.ts", "src/editor/retry.ts")).toBe(
      true,
    );

    // Disjoint
    expect(pathsOverlap("src/editor/", "src/search/")).toBe(false);
    expect(pathsOverlap("src/editor_extra", "src/editor/")).toBe(false);
    expect(pathsOverlap("docs/", "src/")).toBe(false);
  });

  it("detects reservation conflicts on overlapping paths and shared resources", () => {
    const existing: WorkReservation[] = [
      {
        agent: "developer-a",
        owner: "owner-a-1",
        task: "T-1: edit editor",
        paths: ["src/editor/"],
        resources: ["memory"],
        updatedAt: "2030-01-01T12:00:00Z",
      },
    ];

    // Conflict on child path
    const candPath: WorkReservation = {
      agent: "developer-b",
      owner: "owner-b-1",
      task: "T-2: edit retry",
      paths: ["src/editor/retry.ts"],
      resources: [],
      updatedAt: "2030-01-01T12:05:00Z",
    };
    const conflictPath = checkReservationConflict(existing, candPath);
    expect(conflictPath).toEqual({
      type: "path",
      existingPath: "src/editor/",
      candidatePath: "src/editor/retry.ts",
      holderAgent: "developer-a",
      holderOwner: "owner-a-1",
    });

    // Conflict on shared resource "memory"
    const candRes: WorkReservation = {
      agent: "developer-c",
      owner: "owner-c-1",
      task: "T-3: docs",
      paths: ["docs/"],
      resources: ["memory"],
      updatedAt: "2030-01-01T12:06:00Z",
    };
    const conflictRes = checkReservationConflict(existing, candRes);
    expect(conflictRes).toEqual({
      type: "resource",
      resource: "memory",
      holderAgent: "developer-a",
      holderOwner: "owner-a-1",
    });

    // Disjoint succeeds
    const candFree: WorkReservation = {
      agent: "developer-b",
      owner: "owner-b-1",
      task: "T-4: search",
      paths: ["src/search/"],
      resources: [],
      updatedAt: "2030-01-01T12:10:00Z",
    };
    expect(checkReservationConflict(existing, candFree)).toBeNull();

    // Same owner updating does not conflict with themselves
    const candSelf: WorkReservation = {
      agent: "developer-a",
      owner: "owner-a-1",
      task: "T-1: edit more",
      paths: ["src/editor/", "src/editor/extra/"],
      resources: ["memory"],
      updatedAt: "2030-01-01T12:15:00Z",
    };
    expect(checkReservationConflict(existing, candSelf)).toBeNull();
  });

  it("parses and validates reservation JSON matching MESSAGING.md format", () => {
    const json = JSON.stringify({
      agent: "developer-a",
      owner: "developer-a-session-20300101T120000Z-claim-1",
      task: "T-2: editor retry",
      paths: ["src/editor/"],
      resources: [],
      updatedAt: "2030-01-01T12:00:00Z",
    });
    const parsed = parseWorkReservation(json);
    expect(parsed.agent).toBe("developer-a");
    expect(parsed.paths).toEqual(["src/editor/"]);

    // Invalid timestamp rejected
    expect(() =>
      parseWorkReservation(
        JSON.stringify({
          agent: "dev",
          owner: "owner",
          task: "task",
          paths: ["src/"],
          resources: [],
          updatedAt: "not-a-timestamp",
        }),
      ),
    ).toThrow();
  });

  it("parses and validates mailbox notes", () => {
    const json = JSON.stringify({
      from: "developer-a",
      to: "developer-b",
      kind: "verdict",
      text: "Verdict: T-2 passes on abc1234. Review src/editor/retry.ts",
      sentAt: "2030-01-01T12:00:00Z",
    });
    const note = parseMailboxNote(json);
    expect(note.from).toBe("developer-a");
    expect(note.to).toBe("developer-b");
    expect(note.kind).toBe("verdict");

    // Invalid kind rejected
    expect(() =>
      parseMailboxNote(
        JSON.stringify({
          from: "a",
          to: "b",
          kind: "invalid-kind",
          text: "hello",
          sentAt: "2030-01-01T12:00:00Z",
        }),
      ),
    ).toThrow();
  });
});

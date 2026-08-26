import { describe, expect, it } from "vitest";
import { createDapModel, findDapResponseError, reduceDapMessages } from "./dapModel";

describe("reduceDapMessages", () => {
  it("tracks lifecycle, stack, scopes, variables and console output", () => {
    const model = reduceDapMessages(createDapModel(), [
      { type: "event", event: "initialized" },
      { type: "event", event: "stopped", body: { threadId: 7, reason: "breakpoint" } },
      { type: "response", command: "threads", body: { threads: [{ id: 7, name: "main" }] } },
      { type: "response", command: "stackTrace", body: { stackFrames: [{ id: 9, name: "main", line: 12 }] } },
      { type: "response", command: "scopes", body: { scopes: [{ name: "Locals", variablesReference: 3 }] } },
      { type: "response", command: "variables", body: { variables: [{ name: "answer", value: "42", variablesReference: 0 }] } },
      { type: "event", event: "output", body: { output: "hello\n" } },
    ]);

    expect(model.initialized).toBe(true);
    expect(model.stoppedThreadId).toBe(7);
    expect(model.threads[0]?.name).toBe("main");
    expect(model.stackFrames[0]?.line).toBe(12);
    expect(model.scopes[0]?.variablesReference).toBe(3);
    expect(model.variables[0]?.value).toBe("42");
    expect(model.console).toBe("hello\n");
  });

  it("bounds console output and resets running state", () => {
    const model = reduceDapMessages(createDapModel(), [
      { type: "event", event: "output", body: { output: "x".repeat(300_000) } },
      { type: "event", event: "continued" },
      { type: "event", event: "terminated" },
    ]);
    expect(model.console.length).toBeLessThanOrEqual(256 * 1024);
    expect(model.stoppedThreadId).toBeNull();
    expect(model.terminated).toBe(true);
  });

  it("extracts bounded adapter response failures", () => {
    expect(
      findDapResponseError([
        { type: "response", command: "launch", success: false, message: "invalid config" },
      ]),
    ).toEqual({ command: "launch", message: "invalid config" });
    expect(findDapResponseError([{ type: "event", event: "output" }])).toBeNull();
  });
});

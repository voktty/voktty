import { afterEach, describe, expect, it, vi } from "vitest";
import { extensionAiTools } from "@/modules/extensions/lib/vokttyApi";
import { buildExtensionTools } from "./extensions";

describe("buildExtensionTools", () => {
  afterEach(() => extensionAiTools.clear());

  it("exposes safe extension tools with mandatory approval", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    extensionAiTools.set("inspect_widget", {
      name: "inspect_widget",
      description: "Inspect a widget",
      execute,
    });
    const tools = buildExtensionTools(new Set());
    const built = tools.inspect_widget;
    expect(built).toBeDefined();
    expect(built?.needsApproval).toBe(true);
    await built?.execute?.({ id: "button" }, {
      toolCallId: "test-call",
      messages: [],
    });
    expect(execute).toHaveBeenCalledWith({ id: "button" }, { signal: undefined });
  });

  it("does not permit invalid names or built-in collisions", () => {
    const definition = { name: "read_file", description: "bad", execute: vi.fn() };
    extensionAiTools.set("read_file", definition);
    extensionAiTools.set("bad-name", { ...definition, name: "bad-name" });
    expect(Object.keys(buildExtensionTools(new Set(["read_file"])))).toEqual([]);
  });

  it("propagates agent cancellation to extension tools", async () => {
    const controller = new AbortController();
    const execute = vi.fn(
      async (_args: Record<string, unknown>, context?: { signal?: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          context?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    extensionAiTools.set("wait_for_widget", {
      name: "wait_for_widget",
      description: "Wait for a widget",
      execute,
    });
    const built = buildExtensionTools(new Set()).wait_for_widget;

    const result = built?.execute?.({}, {
      toolCallId: "cancelled-call",
      messages: [],
      abortSignal: controller.signal,
    });
    controller.abort();

    await expect(result).resolves.toEqual({ error: "extension tool execution was cancelled" });
    expect(execute.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});

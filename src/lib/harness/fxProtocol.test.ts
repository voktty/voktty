import { describe, expect, it } from "vitest";
import {
  autoPermissionOption,
  eventsFromAcpUpdate,
  fxModeId,
  fxPromptBlocks,
  modelsFromFxOutput,
  permissionOptionId,
  permissionRequestFromAcp,
  sessionIdFromResult,
} from "./fxProtocol";
import { harnessSupportsAttachments } from "../session";

describe("fx protocol", () => {
  it("maps runtime modes onto fx ACP ask/code", () => {
    expect(fxModeId("supervised")).toBe("ask");
    expect(fxModeId("auto-accept-edits")).toBe("code");
    expect(fxModeId("auto")).toBe("code");
    expect(fxModeId("full-access")).toBe("code");
  });

  it("sends text-only prompt blocks", () => {
    expect(fxPromptBlocks("  hello  ")).toEqual([
      { type: "text", text: "hello" },
    ]);
    expect(fxPromptBlocks("   ")).toEqual([]);
  });

  it("does not support attachments", () => {
    expect(harnessSupportsAttachments("fx")).toBe(false);
    expect(harnessSupportsAttachments("cursor")).toBe(true);
  });

  it("auto-allows only in full-access", () => {
    const options = ["allow-once", "reject-once"];
    expect(autoPermissionOption("supervised", options)).toBeNull();
    expect(autoPermissionOption("auto", options)).toBeNull();
    expect(autoPermissionOption("full-access", options)).toBe("allow-once");
  });

  it("picks allow/reject option ids from ACP permission options", () => {
    expect(
      permissionOptionId("allow", ["allow_once", "reject_once"]),
    ).toBe("allow_once");
    expect(
      permissionOptionId("deny", ["allow-once", "reject-once"]),
    ).toBe("reject-once");
  });

  it("reads a permission prompt from an ACP request", () => {
    const request = permissionRequestFromAcp({
      toolCall: {
        toolCallId: "call-1",
        kind: "edit",
        title: "Edit src/lib/fx.ts",
      },
      options: [{ optionId: "allow-once" }, { optionId: "reject-once" }],
    });
    expect(request.callId).toBe("call-1");
    expect(request.kind).toBe("edit");
    expect(request.optionIds).toEqual(["allow-once", "reject-once"]);
    expect(request.title).toContain("fx.ts");
  });

  it("maps agent message and tool updates to harness events", () => {
    expect(
      eventsFromAcpUpdate({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hi" },
      }),
    ).toEqual([{ type: "message.delta", text: "Hi" }]);

    const tools = eventsFromAcpUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      kind: "read",
      title: "Read README.md",
      status: "in_progress",
    });
    expect(tools[0]).toMatchObject({
      type: "tool.updated",
      callId: "t1",
      kind: "read",
      status: "in_progress",
    });
  });

  it("maps plan entries and usage", () => {
    expect(
      eventsFromAcpUpdate({
        sessionUpdate: "plan",
        entries: [
          { content: "Inspect router", status: "completed" },
          { content: "Add test", status: "pending" },
        ],
      }),
    ).toEqual([
      {
        type: "plan",
        text: "[x] Inspect router\n[ ] Add test",
      },
    ]);

    expect(
      eventsFromAcpUpdate({
        usage: { used: 1200, window: 200000 },
      }),
    ).toEqual([{ type: "context", used: 1200, window: 200000 }]);
  });

  it("parses fx models --json", () => {
    const models = modelsFromFxOutput(
      JSON.stringify({
        kind: "models",
        count: 2,
        ids: ["zai/glm-5.2-fast", "openai/gpt-5.2"],
      }),
    );
    expect(models).toEqual([
      {
        id: "fx:zai/glm-5.2-fast",
        harness: "fx",
        name: "zai/glm-5.2-fast",
        nativeId: "zai/glm-5.2-fast",
      },
      {
        id: "fx:openai/gpt-5.2",
        harness: "fx",
        name: "openai/gpt-5.2",
        nativeId: "openai/gpt-5.2",
      },
    ]);
  });

  it("parses object-shaped model entries when present", () => {
    const models = modelsFromFxOutput(
      JSON.stringify({
        models: [
          {
            id: "zai/glm-5.2-fast",
            name: "GLM 5.2 Fast",
            contextWindow: 202752,
          },
        ],
      }),
    );
    expect(models).toEqual([
      {
        id: "fx:zai/glm-5.2-fast",
        harness: "fx",
        name: "GLM 5.2 Fast",
        nativeId: "zai/glm-5.2-fast",
        contextWindow: 202752,
      },
    ]);
  });

  it("parses a text model list when json is missing", () => {
    const models = modelsFromFxOutput(
      "zai/glm-5.2-fast - GLM 5.2 Fast (default)\nopenai/gpt-5.4 - GPT-5.4\n",
    );
    expect(models.map((model) => model.nativeId)).toEqual([
      "zai/glm-5.2-fast",
      "openai/gpt-5.4",
    ]);
  });

  it("reads a session id from ACP setup results", () => {
    expect(sessionIdFromResult({ sessionId: "  abc  " })).toBe("abc");
    expect(sessionIdFromResult({ session_id: "xyz" })).toBe("xyz");
    expect(sessionIdFromResult({})).toBeUndefined();
  });
});

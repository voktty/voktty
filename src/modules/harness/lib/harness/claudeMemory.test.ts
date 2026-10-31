import { expect, it } from "vitest";
import {
  buildClaudeMemoryInput,
  isClaudeMemoryEcho,
  supportsClaudeMemoryReplay,
} from "@/modules/harness/lib/harness/claudeMemory";

it.each(["2.1.312", "2.1.312 (Claude Code)\n", "2.1.313", "2.2.0", "3.0.0"])(
  "accepts the supported stable CLI version %j",
  (version) => expect(supportsClaudeMemoryReplay(version)).toBe(true),
);
it.each([
  "2.1.311",
  "2.0.999",
  "1.9.999",
  "2.1.312-beta",
  "v2.1.312",
  "2.1",
  "2.1.312 extra",
  "2.1.312\n3.0.0",
  "9".repeat(257),
  "9007199254740992.1.312",
])("rejects unsupported or ambiguous CLI version %j", (version) =>
  expect(supportsClaudeMemoryReplay(version)).toBe(false),
);

const original = {
  type: "user",
  message: {
    role: "user",
    content: [
      { type: "text", text: "Original task" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "image" },
      },
    ],
  },
};
function input() {
  return buildClaudeMemoryInput(
    original,
    "memory",
    "input-uuid",
    "provider-id",
  );
}
function echo() {
  return { ...input(), isReplay: true, parent_tool_use_id: null };
}
it("prefixes a separate block and preserves the original input and attachments", () => {
  const message = input();
  expect(message).toMatchObject({
    uuid: "input-uuid",
    session_id: "provider-id",
    client_composed: true,
    origin: { kind: "human" },
  });
  expect(message.message).toEqual({
    role: "user",
    content: [{ type: "text", text: "memory" }, ...original.message.content],
  });
  expect(original.message.content).toHaveLength(2);
  expect(
    buildClaudeMemoryInput(original, null, "next", "provider-id").message,
  ).toEqual(original.message);
});
it("accepts the complete echo regardless of object key order", () => {
  expect(isClaudeMemoryEcho(echo(), input())).toBe(true);
  expect(
    isClaudeMemoryEcho(
      {
        ...echo(),
        message: {
          content: [
            { text: "memory", type: "text" },
            ...original.message.content,
          ],
          role: "user",
        },
      },
      input(),
    ),
  ).toBe(true);
});
it("accepts the CLI 2.1.312 replay shape that omits client_composed", () => {
  const replay: Record<string, unknown> = echo();
  delete replay.client_composed;
  expect(isClaudeMemoryEcho(replay, input())).toBe(true);
});
it.each([
  { type: "result" },
  { isReplay: false },
  { isSynthetic: true },
  { isSynthetic: "true" },
  { isSynthetic: null },
  { parent_tool_use_id: "subagent" },
  { parent_tool_use_id: undefined },
  { uuid: "other" },
  { session_id: "other" },
  { client_composed: false },
  { client_composed: null },
  { client_composed: "true" },
  { origin: { kind: "other" } },
  { origin: undefined },
  { message: original.message },
  {
    message: {
      role: "user",
      content: [{ type: "text", text: "memory" }, ...original.message.content],
      extra: true,
    },
  },
  {
    message: {
      role: "user",
      content: [
        { type: "text", text: "memory" },
        { type: "text", text: "Original task" },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "changed" },
        },
      ],
    },
  },
])("rejects a mismatched or synthetic echo %j", (patch) => {
  expect(isClaudeMemoryEcho({ ...echo(), ...patch }, input())).toBe(false);
});

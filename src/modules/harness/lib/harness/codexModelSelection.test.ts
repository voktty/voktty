import { expect, it } from "vitest";
import { buildTurnStartParams } from "./codexProtocol";

it.each([undefined, "", "   "])(
  "leaves an unknown model to Codex: %s",
  (model) => {
    for (const intent of [undefined, "plan"] as const) {
      const params = buildTurnStartParams({
        threadId: "t",
        runtimeMode: "auto",
        model,
        intent,
      });
      expect(params).not.toHaveProperty("model");
      expect(params).not.toHaveProperty("collaborationMode");
      if (intent === "plan") {
        expect(params.sandboxPolicy).toEqual({ type: "readOnly" });
        expect(params.approvalPolicy).toBe("never");
      }
    }
  },
);

it("uses the selected model consistently after trimming", () => {
  const params = buildTurnStartParams({
    threadId: "t",
    runtimeMode: "supervised",
    model: " gpt-5.4 ",
  });
  expect(params.model).toBe("gpt-5.4");
  expect(params.collaborationMode).toMatchObject({
    settings: { model: "gpt-5.4" },
  });
});

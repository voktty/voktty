import { describe, expect, it } from "vitest";
import { dispatchBrowserMethod, parseOpenRequest } from "./useControlBridge";

describe("parseOpenRequest", () => {
  it("defaults focus only when it is absent", () => {
    expect(parseOpenRequest({ path: "/repo/main.rs" }).focus).toBe(true);
    expect(
      parseOpenRequest({ path: "/repo/main.rs", focus: false }).focus,
    ).toBe(false);
  });

  it.each([0, "false", null, {}])(
    "rejects non-boolean focus value %o",
    (focus) => {
      expect(() => parseOpenRequest({ path: "/repo/main.rs", focus })).toThrow(
        "focus must be a boolean",
      );
    },
  );
});

describe("dispatchBrowserMethod", () => {
  it("rejects type and eval without required fields", async () => {
    await expect(dispatchBrowserMethod("browser.type", {})).rejects.toThrow(
      "browser type requires text",
    );
    await expect(dispatchBrowserMethod("browser.eval", {})).rejects.toThrow(
      "browser eval requires a script",
    );
  });

  it("returns no_active_preview when no preview is mounted", async () => {
    const result = (await dispatchBrowserMethod("browser.snapshot", {})) as {
      error: string;
    };
    expect(result.error).toBe("no_active_preview");
  });
});

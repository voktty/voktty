import { describe, expect, it } from "vitest";
import { installKeystrokes, parseInstallRequest } from "./installRequest";
import { COMPUTER_USE_INSTALL_COMMAND } from "./probe";

describe("install request", () => {
  it("accepts this computer or a saved host id", () => {
    expect(parseInstallRequest({ hostId: null })).toEqual({ hostId: null });
    expect(parseInstallRequest({ hostId: "ssh-1" })).toEqual({ hostId: "ssh-1" });
  });

  it("rejects anything else, including attempts to carry a command", () => {
    for (const payload of [null, undefined, "x", {}, { hostId: 3 }, { hostId: "" }, { hostId: "a".repeat(300) }]) {
      expect(parseInstallRequest(payload)).toBeNull();
    }
    expect(parseInstallRequest({ hostId: null, command: "rm -rf /" })).toEqual({ hostId: null });
  });

  it("always types the pinned command and nothing the event carried", () => {
    expect(installKeystrokes()).toBe(`${COMPUTER_USE_INSTALL_COMMAND}\r`);
  });
});

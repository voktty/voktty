import { describe, expect, it } from "vitest";
import {
  canOfferTrust,
  extractDubiousOwnershipPath,
  isGitTrustError,
  isRemoteWorkspacePath,
} from "./gitTrust";

describe("git trust errors", () => {
  it("recognizes Git and workspace refusals", () => {
    expect(isGitTrustError("detected dubious ownership in repository")).toBe(
      true,
    );
    expect(
      isGitTrustError(new Error("cwd is outside the authorized workspace: /x")),
    ).toBe(true);
    expect(isGitTrustError({ message: "Unauthorized path" })).toBe(true);
  });

  it("does not treat unrelated failures as a trust problem", () => {
    expect(isGitTrustError("File has no uncommitted changes.")).toBe(false);
    expect(isGitTrustError("Remote Git operation failed.")).toBe(false);
    expect(isGitTrustError(undefined)).toBe(false);
  });

  it("extracts the named folder or falls back to the context path", () => {
    expect(
      extractDubiousOwnershipPath(
        "detected dubious ownership in repository at '/srv/app'. Add a safe.directory exception",
        "/other",
      ),
    ).toBe("/srv/app");
    expect(
      extractDubiousOwnershipPath("outside the authorized workspace", "/ctx"),
    ).toBe("/ctx");
    expect(extractDubiousOwnershipPath("File has no changes", "/ctx")).toBeNull();
  });

  it("never offers to trust a folder that lives on another machine", () => {
    expect(isRemoteWorkspacePath("remote://voktty-ssh-a/srv/app")).toBe(true);
    expect(isRemoteWorkspacePath("C:\\work\\app")).toBe(false);
    expect(canOfferTrust("dubious ownership", "remote://voktty-ssh-a/srv")).toBe(
      false,
    );
    expect(canOfferTrust("dubious ownership", "/srv/app")).toBe(true);
    expect(canOfferTrust("File has no uncommitted changes.", "/srv/app")).toBe(
      false,
    );
  });
});

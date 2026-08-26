import { describe, expect, it } from "vitest";
import {
  controlLaunchRequest,
  createLaunchRequestDeduper,
  initialBootIntent,
  type LaunchRequest,
  launchRequestCwd,
  normalizeLaunchPaths,
  selectBootLaunchRequest,
} from "./launchRequest";

function request(
  requestId: string,
  intent: LaunchRequest["intent"],
  paths: string[] = [],
): LaunchRequest {
  return {
    requestId,
    source: "coldStart",
    intent,
    paths,
    sourceCwd: "C:/work",
  };
}

describe("launch requests", () => {
  it("restores only for a cold launch without explicit targets", () => {
    expect(initialBootIntent(request("restore", "restoreLastSession"))).toBe(
      "restoreLastSession",
    );
    expect(
      initialBootIntent(request("files", "openFilesOnly", ["/a/x.ts"])),
    ).toBe("openFilesOnly");
    expect(
      initialBootIntent(request("directory", "openDirectoryOnly", ["/a"])),
    ).toBe("openDirectoryOnly");
  });

  it("lets a late macOS open request supersede the cached cold restore", () => {
    const restore = request("restore", "restoreLastSession");
    const opened = {
      ...request("opened", "openFilesOnly", ["/a/x.ts"]),
      source: "opened" as const,
    };

    expect(selectBootLaunchRequest([opened], restore)).toBe(opened);
    expect(selectBootLaunchRequest([], restore)).toBe(restore);
  });

  it("normalizes and deduplicates file batches without changing order", () => {
    expect(
      normalizeLaunchPaths([
        "C:\\work\\one.ts",
        "C:/work/two.ts",
        "C:/work/one.ts",
      ]),
    ).toEqual(["C:/work/one.ts", "C:/work/two.ts"]);
  });

  it("keeps filesystem roots when deriving a cold file context", () => {
    expect(
      launchRequestCwd(request("unix-root", "openFilesOnly", ["/one.ts"])),
    ).toBe("/");
    expect(
      launchRequestCwd(request("windows-root", "openFilesOnly", ["C:/one.ts"])),
    ).toBe("C:/");
  });

  it("applies each request id once during the process lifetime", () => {
    const deduper = createLaunchRequestDeduper();

    expect(deduper.begin("req-1")).toBe(true);
    expect(deduper.begin("req-1")).toBe(false);
    deduper.fail("req-1");
    expect(deduper.begin("req-1")).toBe(true);
    deduper.complete("req-1");
    expect(deduper.begin("req-1")).toBe(false);
  });

  it("routes control CLI opens through the launch request contract", () => {
    expect(
      controlLaunchRequest({
        requestId: "control-1",
        path: "C:\\work\\one.ts",
        line: 4,
        focus: false,
      }),
    ).toMatchObject({
      requestId: "control-1",
      source: "controlCli",
      intent: "openFilesInCurrentSession",
      paths: ["C:/work/one.ts"],
      line: 4,
      focus: false,
    });
  });
});

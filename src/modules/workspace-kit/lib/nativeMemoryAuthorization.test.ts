import { beforeEach, expect, it, vi } from "vitest";
import { authorizeNativeMemoryDirectory } from "@/modules/workspace-kit/lib/nativeMemoryAuthorization";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
beforeEach(() => { invoke.mockReset(); });

it("authorizes only the explicit local directory and returns the native canonical path", async () => {
  invoke.mockResolvedValue("C:/canonical/project");
  expect(await authorizeNativeMemoryDirectory("C:/chosen/project")).toBe("C:/canonical/project");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("workspace_authorize", {
    path: "C:/chosen/project", workspace: { kind: "local" },
  });
});

it.each(["", "relative", "remote://host/project", "//server/share", "\\\\server\\share", "/a/../b", "/bad\npath"])("rejects an unsupported directory before authorization: %j", async (path) => {
  await expect(authorizeNativeMemoryDirectory(path)).rejects.toMatchObject({ code: "invalidInput" });
  expect(invoke).not.toHaveBeenCalled();
});

it("refuses an invalid native reply and propagates authorization failure", async () => {
  invoke.mockResolvedValue("remote://host/project");
  await expect(authorizeNativeMemoryDirectory("/chosen")).rejects.toMatchObject({ code: "invalidInput" });
  invoke.mockRejectedValue({ code: "denied" });
  await expect(authorizeNativeMemoryDirectory("/chosen")).rejects.toMatchObject({ code: "denied" });
});

it("keeps unsettled native authorizations charged until they actually finish", async () => {
  let resolve!: (path: string) => void;
  invoke.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
  const pending = Array.from({ length: 256 }, () => authorizeNativeMemoryDirectory("/chosen"));
  await expect(authorizeNativeMemoryDirectory("/chosen")).rejects.toMatchObject({ code: "busy" });
  expect(invoke).toHaveBeenCalledTimes(256);
  resolve("/canonical");
  await Promise.all(pending);
  invoke.mockResolvedValue("/canonical");
  expect(await authorizeNativeMemoryDirectory("/chosen")).toBe("/canonical");
});

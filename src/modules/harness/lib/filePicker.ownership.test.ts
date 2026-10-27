import { beforeEach, expect, it, vi } from "vitest";
import { pickFiles } from "@/modules/harness/lib/fs";

const io = vi.hoisted(() => ({ open: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: io.open }));
beforeEach(() => {
  io.open.mockReset();
  io.invoke.mockReset();
});
it("does not open the native fallback after the original dialog retires", async () => {
  let current = true;
  io.open.mockImplementation(async () => {
    current = false;
    throw new Error("dialog failed");
  });
  await expect(
    pickFiles("fixture", () => {
      if (!current) throw new DOMException("Retired", "AbortError");
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(io.invoke).not.toHaveBeenCalled();
});
it("preserves the fallback for a current caller", async () => {
  io.open.mockRejectedValue(new Error("dialog failed"));
  io.invoke.mockResolvedValue("C:/fixture/report.txt");
  expect(await pickFiles("fixture")).toEqual(["C:/fixture/report.txt"]);
  expect(io.invoke).toHaveBeenCalledExactlyOnceWith("fs_pick_file", {});
});

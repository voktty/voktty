import { beforeEach, describe, expect, it, vi } from "vitest";

const { readTextFile, writeTextFile } = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
vi.mock("./fs", () => ({ readTextFile, writeTextFile }));

import {
  diskContentChanged,
  EditorSaveConflictError,
  saveEditorFile,
} from "./editorSave";

describe("diskContentChanged", () => {
  it("ignores the first unchanged watcher sample while the editor is dirty", () => {
    expect(diskContentChanged("original", "original")).toBe(false);
    expect(diskContentChanged("external", "original")).toBe(true);
  });
});

describe("saveEditorFile", () => {
  beforeEach(() => {
    readTextFile.mockReset();
    writeTextFile.mockReset();
    readTextFile.mockResolvedValue("original");
    writeTextFile.mockResolvedValue(undefined);
  });

  it("passes the loaded version to the local write", async () => {
    await saveEditorFile("/repo/a.txt", "edited", "original");
    expect(readTextFile).not.toHaveBeenCalled();
    expect(writeTextFile).toHaveBeenCalledWith(
      "/repo/a.txt",
      "edited",
      "original",
    );
  });

  it("rejects a changed remote file and propagates remote read failures without writing", async () => {
    readTextFile
      .mockResolvedValueOnce("external")
      .mockRejectedValueOnce(new Error("missing"));
    await expect(
      saveEditorFile("remote://machine/repo/a.txt", "edited", "original"),
    ).rejects.toBeInstanceOf(EditorSaveConflictError);
    await expect(
      saveEditorFile("remote://machine/repo/a.txt", "edited", "original"),
    ).rejects.toThrow("missing");
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("maps a native late conflict and preserves other write errors", async () => {
    writeTextFile
      .mockRejectedValueOnce("File changed on disk; save cancelled.")
      .mockRejectedValueOnce(new Error("disk full"));
    await expect(
      saveEditorFile("/repo/a.txt", "edited", "original"),
    ).rejects.toBeInstanceOf(EditorSaveConflictError);
    await expect(
      saveEditorFile("/repo/a.txt", "edited", "original"),
    ).rejects.toThrow("disk full");
  });

  it("preflights remote content without sending an unsupported native argument", async () => {
    await saveEditorFile("remote://machine/repo/a.txt", "edited", "original");
    expect(writeTextFile).toHaveBeenCalledWith(
      "remote://machine/repo/a.txt",
      "edited",
      undefined,
    );
  });
});

import { afterEach, expect, it } from "vitest";
import {
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import {
  readAttachmentBytes,
  resolveAttachments,
  writeAttachmentChunk,
} from "./attachments";

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

it("accepts ordered chunks and an identical retry while rejecting changes", () => {
  const directory = mkdtempSync(join(tmpdir(), "voktty-upload-test-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const chunk = (offset: number, data: string) =>
    writeAttachmentChunk(store, {
      id,
      offset,
      size: 6,
      data: Buffer.from(data).toString("base64"),
    });
  expect(chunk(0, "abc")).toEqual({ offset: 3 });
  expect(chunk(0, "abc")).toEqual({ offset: 3 });
  expect(() => chunk(0, "xyz")).toThrow("does not match");
  expect(() => chunk(4, "ef")).toThrow("out of order");
  expect(chunk(3, "def")).toEqual({ offset: 6 });
  expect(() =>
    writeAttachmentChunk(store, {
      id: "../escape",
      offset: 0,
      size: 1,
      data: "YQ==",
    }),
  ).toThrow("Invalid attachment ID");
});

it.skipIf(process.platform === "win32")(
  "rejects a symlink in the attachment directory",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "voktty-upload-link-"));
    const store = new HostStore(join(directory, "host.db"));
    const outside = join(directory, "outside");
    writeFileSync(outside, "private");
    mkdirSync(store.attachmentDir);
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    symlinkSync(outside, join(store.attachmentDir, id));
    cleanups.push(() => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    });
    expect(() =>
      writeAttachmentChunk(store, {
        id,
        offset: 0,
        size: 7,
        data: Buffer.from("replace").toString("base64"),
      }),
    ).toThrow();
    expect(() =>
      resolveAttachments(store, [
        { id, name: "file.txt", mimeType: "text/plain", kind: "file", size: 7 },
      ]),
    ).toThrow();
    expect(() => readAttachmentBytes(store, id, 7)).toThrow();
    expect(readFileSync(outside, "utf8")).toBe("private");
  },
);

it.skipIf(process.platform === "win32")(
  "rejects a symlink for the attachment directory itself",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "voktty-upload-dir-link-"));
    const store = new HostStore(join(directory, "host.db"));
    const outside = join(directory, "outside");
    mkdirSync(outside);
    symlinkSync(outside, store.attachmentDir, "dir");
    cleanups.push(() => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    });
    expect(() =>
      writeAttachmentChunk(store, {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        offset: 0,
        size: 1,
        data: "YQ==",
      }),
    ).toThrow("directory");
  },
);

it.skipIf(process.platform === "win32")(
  "rejects a hard link to another file",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "voktty-upload-hardlink-"));
    const store = new HostStore(join(directory, "host.db"));
    const outside = join(directory, "outside");
    writeFileSync(outside, "private");
    mkdirSync(store.attachmentDir);
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    linkSync(outside, join(store.attachmentDir, id));
    cleanups.push(() => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    });
    expect(() =>
      writeAttachmentChunk(store, {
        id,
        offset: 0,
        size: 7,
        data: Buffer.from("replace").toString("base64"),
      }),
    ).toThrow("Invalid attachment file");
    expect(readFileSync(outside, "utf8")).toBe("private");
  },
);

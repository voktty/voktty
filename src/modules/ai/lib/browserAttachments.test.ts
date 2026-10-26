// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { readBrowserAttachments } from "@/modules/ai/lib/browserAttachments";

const list = (...files: File[]) => files as unknown as FileList;

it("retains all sixteen pending reads through retirement until settlement", async () => {
  let current = true;
  const releases: Array<(text: string) => void> = [];
  const file = new File(["text"], "fixture.txt");
  const read = vi
    .spyOn(file, "text")
    .mockImplementation(
      () => new Promise<string>((resolve) => releases.push(resolve)),
    );
  const publish = vi.fn();
  const pending = Array.from({ length: 16 }, () =>
    readBrowserAttachments(list(file), () => current, publish),
  );
  current = false;
  const fresh = new File(["fresh"], "fresh.txt");
  const freshRead = vi.spyOn(fresh, "text");
  await readBrowserAttachments(list(fresh), () => true, publish);
  expect(freshRead).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(16);
  for (const release of releases) release("late");
  await Promise.all(pending);
  expect(publish).not.toHaveBeenCalled();
  await readBrowserAttachments(list(fresh), () => true, publish);
  expect(publish).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({ name: "fresh.txt", text: "fresh" }),
  ]);
});

it("checks ownership between files without reading a later file", async () => {
  let current = true;
  const first = new File(["one"], "one.txt");
  vi.spyOn(first, "text").mockImplementation(async () => {
    current = false;
    return "one";
  });
  const second = new File(["two"], "two.txt");
  const read = vi.spyOn(second, "text");
  const publish = vi.fn();
  await readBrowserAttachments(list(first, second), () => current, publish);
  expect(read).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});

it("rejects oversized batches before any read and skips oversized file payloads", async () => {
  const normal = new File(["normal"], "normal.txt");
  const read = vi.spyOn(normal, "text");
  const publish = vi.fn();
  await readBrowserAttachments(
    list(...Array<File>(33).fill(normal)),
    () => true,
    publish,
  );
  expect(read).not.toHaveBeenCalled();
  const huge = new File(["huge"], "huge.png", { type: "image/png" });
  Object.defineProperty(huge, "size", { value: 33 * 1024 * 1024 });
  await readBrowserAttachments(list(normal, huge), () => true, publish);
  expect(read).not.toHaveBeenCalled();
  const text = new File(["text"], "long.txt");
  Object.defineProperty(text, "size", { value: 200_001 });
  const textRead = vi.spyOn(text, "text");
  const image = new File(["image"], "large.png", { type: "image/png" });
  Object.defineProperty(image, "size", { value: 16 * 1024 * 1024 + 1 });
  await readBrowserAttachments(list(text, image), () => true, publish);
  expect(textRead).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});

it("bounds actual decoded text and releases capacity after read failure", async () => {
  const file = new File(["text"], "fixture.txt");
  const read = vi.spyOn(file, "text").mockResolvedValue("x".repeat(200_001));
  const publish = vi.fn();
  await readBrowserAttachments(list(file), () => true, publish);
  expect(publish).not.toHaveBeenCalled();
  read.mockRejectedValue(new Error("private content"));
  await Promise.all(
    Array.from({ length: 16 }, () =>
      readBrowserAttachments(list(file), () => true, publish),
    ),
  );
  read.mockResolvedValue("recovered");
  await readBrowserAttachments(list(file), () => true, publish);
  expect(publish).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({ text: "recovered" }),
  ]);
});

it("reads a current image through FileReader", async () => {
  const publish = vi.fn();
  await readBrowserAttachments(
    list(new File(["image"], "fixture.png", { type: "image/png" })),
    () => true,
    publish,
  );
  expect(publish).toHaveBeenCalledExactlyOnceWith([
    expect.objectContaining({
      kind: "image",
      url: "data:image/png;base64,aW1hZ2U=",
    }),
  ]);
});

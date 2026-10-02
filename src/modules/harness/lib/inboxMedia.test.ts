import { describe, expect, it, vi } from "vitest";
import {
  fetchInboxMedia,
  INBOX_MEDIA_PREFIXES,
  isInboxMediaUrl,
  sniffInboxMedia,
} from "./inboxMedia";

describe("isInboxMediaUrl", () => {
  it("allows GitHub and Linear attachment hosts", () => {
    expect(
      isInboxMediaUrl(
        "https://github.com/user-attachments/assets/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ),
    ).toBe(true);
    expect(
      isInboxMediaUrl("https://github.com/acme/web/assets/12/aaaaaaaa-bbbb"),
    ).toBe(true);
    expect(
      isInboxMediaUrl("https://user-images.githubusercontent.com/1/shot.png"),
    ).toBe(true);
    expect(
      isInboxMediaUrl("https://uploads.linear.app/org/uuid/file.png"),
    ).toBe(true);
  });

  it("rejects pages, other hosts, and traversal", () => {
    expect(isInboxMediaUrl("https://github.com/acme/web/issues/1")).toBe(false);
    expect(
      isInboxMediaUrl("https://github.com/user-attachments/../login"),
    ).toBe(false);
    expect(isInboxMediaUrl("http://github.com/user-attachments/assets/x")).toBe(
      false,
    );
    expect(isInboxMediaUrl("https://evil.example/shot.png")).toBe(false);
    expect(
      isInboxMediaUrl("https://github.com.evil.com/user-attachments/assets/x"),
    ).toBe(false);
  });
});

describe("INBOX_MEDIA_PREFIXES", () => {
  it("stays on HTTPS attachment hosts", () => {
    expect(
      INBOX_MEDIA_PREFIXES.every((prefix) => prefix.startsWith("https://")),
    ).toBe(true);
    expect(
      INBOX_MEDIA_PREFIXES.some((prefix) =>
        prefix.startsWith("https://github.com/user-attachments/"),
      ),
    ).toBe(true);
  });
});

describe("sniffInboxMedia", () => {
  it("keeps images and recognizes mp4 and webm", () => {
    expect(
      sniffInboxMedia(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toEqual({ kind: "image", mime: "image/png" });
    expect(
      sniffInboxMedia(
        new Uint8Array([
          0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
        ]),
      ),
    ).toEqual({ kind: "video", mime: "video/mp4" });
    expect(
      sniffInboxMedia(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4])),
    ).toEqual({ kind: "video", mime: "video/webm" });
  });

  it("does not treat avif, pdf or html as video", () => {
    expect(
      sniffInboxMedia(
        new Uint8Array([
          0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
        ]),
      ),
    ).toEqual({ kind: "image", mime: "image/avif" });
    expect(
      sniffInboxMedia(
        new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
      ),
    ).toBeNull();
    expect(
      sniffInboxMedia(new TextEncoder().encode("<html><script>x()</script>")),
    ).toBeNull();
  });
});

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("fetchInboxMedia", () => {
  const MB = 1024 * 1024;
  const url = (i: number) =>
    `https://github.com/user-attachments/assets/cache-${i}`;

  it("shares a request in flight and serves repeats from cache", async () => {
    invoke.mockReset();
    invoke.mockResolvedValue(new ArrayBuffer(16));
    const [first, second] = await Promise.all([
      fetchInboxMedia(url(100)),
      fetchInboxMedia(url(100)),
    ]);
    expect(first).toBe(second);
    expect(await fetchInboxMedia(url(100))).toBe(first);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps cached bytes under a total budget", async () => {
    invoke.mockReset();
    invoke.mockImplementation(async () => new ArrayBuffer(10 * MB));
    for (let i = 0; i < 6; i += 1) await fetchInboxMedia(url(i));
    expect(invoke).toHaveBeenCalledTimes(6);

    // The newest files are still cached; the oldest were dropped.
    await fetchInboxMedia(url(5));
    expect(invoke).toHaveBeenCalledTimes(6);
    await fetchInboxMedia(url(0));
    expect(invoke).toHaveBeenCalledTimes(7);
  });

  it("retries after a failed request", async () => {
    invoke.mockReset();
    invoke.mockRejectedValueOnce(new Error("offline"));
    invoke.mockResolvedValueOnce(new ArrayBuffer(8));
    await expect(fetchInboxMedia(url(200))).rejects.toThrow("offline");
    expect((await fetchInboxMedia(url(200))).byteLength).toBe(8);
  });
});

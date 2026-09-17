import { describe, expect, it } from "vitest";
import { formatFileSize, isImagePath, sniffImageMime } from "./filePreview";

describe("filePreview", () => {
  describe("isImagePath", () => {
    it("recognizes common image extensions", () => {
      expect(isImagePath("photo.png")).toBe(true);
      expect(isImagePath("photo.jpg")).toBe(true);
      expect(isImagePath("photo.jpeg")).toBe(true);
      expect(isImagePath("photo.gif")).toBe(true);
      expect(isImagePath("photo.webp")).toBe(true);
      expect(isImagePath("photo.avif")).toBe(true);
      expect(isImagePath("photo.bmp")).toBe(true);
      expect(isImagePath("photo.ico")).toBe(true);
    });

    it("excludes svg and non-images", () => {
      expect(isImagePath("icon.svg")).toBe(false);
      expect(isImagePath("doc.pdf")).toBe(false);
      expect(isImagePath("code.ts")).toBe(false);
    });
  });

  describe("sniffImageMime", () => {
    it("identifies PNG headers", () => {
      const bytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      expect(sniffImageMime(bytes)).toBe("image/png");
    });

    it("identifies JPEG headers", () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      expect(sniffImageMime(bytes)).toBe("image/jpeg");
    });

    it("identifies GIF headers", () => {
      const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      expect(sniffImageMime(bytes)).toBe("image/gif");
    });

    it("returns null for non-image bytes", () => {
      const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      expect(sniffImageMime(bytes)).toBeNull();
    });
  });

  describe("formatFileSize", () => {
    it("formats bytes, KB, and MB accurately", () => {
      expect(formatFileSize(500)).toBe("500 B");
      expect(formatFileSize(2048)).toBe("2.0 KB");
      expect(formatFileSize(1048576)).toBe("1.0 MB");
      expect(formatFileSize(15728640)).toBe("15 MB");
    });
  });
});

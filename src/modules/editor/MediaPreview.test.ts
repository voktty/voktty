import { describe, expect, it } from "vitest";
import {
  classifyMediaExtension,
  getMediaMimeType,
} from "./MediaPreview";

describe("MediaPreview helpers", () => {
  it("classifies image extensions accurately", () => {
    expect(classifyMediaExtension("png")).toBe("image");
    expect(classifyMediaExtension("PNG")).toBe("image");
    expect(classifyMediaExtension("jpg")).toBe("image");
    expect(classifyMediaExtension("jpeg")).toBe("image");
    expect(classifyMediaExtension("webp")).toBe("image");
    expect(classifyMediaExtension("svg")).toBe("image");
    expect(classifyMediaExtension("gif")).toBe("image");
    expect(classifyMediaExtension("ico")).toBe("image");
    expect(classifyMediaExtension("avif")).toBe("image");
  });

  it("classifies video and audio extensions accurately", () => {
    expect(classifyMediaExtension("mp4")).toBe("video");
    expect(classifyMediaExtension("webm")).toBe("video");
    expect(classifyMediaExtension("mov")).toBe("video");
    expect(classifyMediaExtension("mp3")).toBe("audio");
    expect(classifyMediaExtension("wav")).toBe("audio");
    expect(classifyMediaExtension("flac")).toBe("audio");
  });

  it("classifies PDF extensions", () => {
    expect(classifyMediaExtension("pdf")).toBe("pdf");
    expect(classifyMediaExtension("PDF")).toBe("pdf");
  });

  it("returns null for non-media extensions", () => {
    expect(classifyMediaExtension("ts")).toBeNull();
    expect(classifyMediaExtension("rs")).toBeNull();
    expect(classifyMediaExtension("json")).toBeNull();
    expect(classifyMediaExtension("txt")).toBeNull();
  });

  it("resolves correct MIME types", () => {
    expect(getMediaMimeType("png")).toBe("image/png");
    expect(getMediaMimeType("jpg")).toBe("image/jpeg");
    expect(getMediaMimeType("jpeg")).toBe("image/jpeg");
    expect(getMediaMimeType("svg")).toBe("image/svg+xml");
    expect(getMediaMimeType("webp")).toBe("image/webp");
    expect(getMediaMimeType("mp4")).toBe("video/mp4");
    expect(getMediaMimeType("mp3")).toBe("audio/mpeg");
    expect(getMediaMimeType("pdf")).toBe("application/pdf");
    expect(getMediaMimeType("unknown")).toBe("application/octet-stream");
  });
});

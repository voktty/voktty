import { describe, expect, it } from "vitest";
import {
  createDevServerOutputDetector,
  devServerLinkScope,
  normalizeCapturedDevServerUrl,
} from "./devServerCapture";

describe("dev server output capture", () => {
  it("reassembles URLs split across PTY chunks", () => {
    const detector = createDevServerOutputDetector();

    expect(detector.push("Local: http://local")).toEqual([]);
    expect(detector.push("host:5173/ready\r\n")).toEqual([
      "http://localhost:5173",
    ]);
  });

  it("strips terminal escapes and deduplicates an origin", () => {
    const detector = createDevServerOutputDetector();

    expect(
      detector.push("\u001b[32mhttp://127.0.0.1:4321/app\u001b[0m\n"),
    ).toEqual(["http://127.0.0.1:4321"]);
    expect(detector.push("again http://127.0.0.1:4321/other\n")).toEqual([]);
  });

  it("accepts only safe loopback HTTP origins", () => {
    expect(normalizeCapturedDevServerUrl("localhost:3000/path?q=secret")).toBe(
      "http://localhost:3000",
    );
    expect(normalizeCapturedDevServerUrl("http://0.0.0.0:8000/docs")).toBe(
      "http://localhost:8000",
    );
    expect(normalizeCapturedDevServerUrl("https://[::1]:4173/app")).toBe(
      "https://[::1]:4173",
    );
    expect(normalizeCapturedDevServerUrl("https://example.com:443")).toBeNull();
    expect(
      normalizeCapturedDevServerUrl("http://user:secret@localhost:3000"),
    ).toBeNull();
    expect(normalizeCapturedDevServerUrl("http://127.999.0.1:3000")).toBeNull();
  });

  it("creates stable workspace scopes across Windows path casing", () => {
    expect(
      devServerLinkScope("local", "C:\\Repo\\App\\", "http://localhost:5173"),
    ).toBe("local\0c:/repo/app\0http://localhost:5173");
  });
});

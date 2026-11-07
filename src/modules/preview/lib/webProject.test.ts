import { describe, expect, it } from "vitest";
import {
  detectWebProject,
  isLocalProjectRoot,
  webProjectLabel,
  type WebProjectEntry,
} from "./webProject";

const files = (...names: string[]): WebProjectEntry[] =>
  names.map((name) => ({ name, kind: "file" }));
const dirs = (...names: string[]): WebProjectEntry[] =>
  names.map((name) => ({ name, kind: "dir" }));

describe("detectWebProject", () => {
  it("recognizes Laravel by artisan and public", () => {
    expect(
      detectWebProject([...files("artisan", "composer.json"), ...dirs("public", "app")]),
    ).toBe("laravel");
  });

  it("recognizes WordPress by its folders or config", () => {
    expect(detectWebProject(dirs("wp-content", "wp-admin"))).toBe("wordpress");
    expect(detectWebProject(files("wp-config.php", "index.php"))).toBe("wordpress");
  });

  it("falls back to plain PHP and static sites", () => {
    expect(detectWebProject(files("index.php"))).toBe("php");
    expect(detectWebProject(files("composer.json"))).toBe("php");
    expect(detectWebProject(files("index.html", "style.css"))).toBe("static");
  });

  it("does not claim Laravel without a public folder", () => {
    expect(detectWebProject(files("artisan"))).not.toBe("laravel");
  });

  it("leaves Node projects and unrelated folders alone", () => {
    expect(detectWebProject(files("package.json", "vite.config.ts"))).toBeNull();
    expect(detectWebProject([])).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(detectWebProject(files("INDEX.PHP"))).toBe("php");
  });
});

describe("webProjectLabel", () => {
  it("names each kind", () => {
    expect(webProjectLabel("laravel")).toBe("Laravel");
    expect(webProjectLabel("static")).toBe("HTML");
  });
});

describe("isLocalProjectRoot", () => {
  it("accepts absolute local paths only", () => {
    expect(isLocalProjectRoot("/home/u/site")).toBe(true);
    expect(isLocalProjectRoot("C:\\sites\\app")).toBe(true);
    expect(isLocalProjectRoot("remote://voktty-ssh-x/srv/app")).toBe(false);
    expect(isLocalProjectRoot("relative/path")).toBe(false);
    expect(isLocalProjectRoot(null)).toBe(false);
  });
});

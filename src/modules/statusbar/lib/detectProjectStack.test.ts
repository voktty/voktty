import { describe, expect, it, vi } from "vitest";
import { detectProjectStack } from "./detectProjectStack";

vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    readDir: vi.fn(async (dir: string) => {
      if (dir === "/projects/php-app") {
        return [
          { name: "composer.json", isDir: false },
          { name: "artisan", isDir: false },
        ];
      }
      if (dir === "/projects/python-app") {
        return [
          { name: "pyproject.toml", isDir: false },
          { name: "requirements.txt", isDir: false },
        ];
      }
      if (dir === "/projects/rust-app") {
        return [{ name: "Cargo.toml", isDir: false }];
      }
      if (dir === "/projects/node-app") {
        return [
          { name: "package.json", isDir: false },
          { name: "tsconfig.json", isDir: false },
        ];
      }
      return [];
    }),
  },
}));

describe("detectProjectStack", () => {
  it("detects PHP / Composer projects", async () => {
    const result = await detectProjectStack("/projects/php-app");
    expect(result.primaryType).toBe("php");
    expect(result.labelKey).toBe("statusbar.stacks.php");
    expect(result.hasComposer).toBe(true);
    expect(result.recommendedLspIds).toContain("intelephense");
  });

  it("detects Python projects", async () => {
    const result = await detectProjectStack("/projects/python-app");
    expect(result.primaryType).toBe("python");
    expect(result.labelKey).toBe("statusbar.stacks.python");
    expect(result.hasPythonEnv).toBe(true);
    expect(result.recommendedLspIds).toContain("pyright");
  });

  it("detects Rust projects", async () => {
    const result = await detectProjectStack("/projects/rust-app");
    expect(result.primaryType).toBe("rust");
    expect(result.labelKey).toBe("statusbar.stacks.rust");
    expect(result.hasCargo).toBe(true);
    expect(result.recommendedLspIds).toContain("rust-analyzer");
  });

  it("detects TypeScript / Node projects", async () => {
    const result = await detectProjectStack("/projects/node-app");
    expect(result.primaryType).toBe("typescript");
    expect(result.labelKey).toBe("statusbar.stacks.typescript");
    expect(result.hasPackageJson).toBe(true);
    expect(result.recommendedLspIds).toContain("typescript");
  });

  it("handles null or undefined cwd gracefully", async () => {
    const result = await detectProjectStack(null);
    expect(result.primaryType).toBe("general");
    expect(result.recommendedLspIds).toEqual([]);
  });
});

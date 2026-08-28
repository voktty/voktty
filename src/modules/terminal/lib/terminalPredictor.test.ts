import { describe, expect, it, vi } from "vitest";
import {
  isPathOrFileContext,
  normalizeCommandForEnv,
  predictTerminalSuggestions,
} from "./terminalPredictor";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "history_list") {
      return [
        { cmd: "python .\\run_migrations.py", count: 12, last: 1700000000, shell_type: "powershell" },
        { cmd: "python .\\tools\\maintenance_tool.py", count: 5, last: 1700000010, shell_type: "powershell" },
        { cmd: "cd /opt/docker/hermes-server", count: 20, last: 1700000020, shell_type: "unix" },
      ];
    }
    if (cmd === "fs_read_dir") {
      return [
        { name: "main.py", kind: "file", size: 1024, mtime: 1700000000 },
        { name: "scripts", kind: "dir", size: 4096, mtime: 1700000000 },
        { name: "tests", kind: "dir", size: 4096, mtime: 1700000000 },
        { name: "README.md", kind: "file", size: 2048, mtime: 1700000000 },
      ];
    }
    return [];
  }),
}));

describe("terminalPredictor", () => {
  describe("normalizeCommandForEnv", () => {
    it("normalizes Windows backslashes and prefixes to POSIX in Unix environment", () => {
      expect(normalizeCommandForEnv("python .\\run_migrations.py", true)).toBe(
        "python ./run_migrations.py",
      );
      expect(normalizeCommandForEnv("python .\\tools\\maintenance.py", true)).toBe(
        "python ./tools/maintenance.py",
      );
      expect(normalizeCommandForEnv("cd .\\src\\modules", true)).toBe(
        "cd ./src/modules",
      );
    });

    it("preserves native Windows syntax in Windows environment", () => {
      expect(normalizeCommandForEnv("python .\\run_migrations.py", false)).toBe(
        "python .\\run_migrations.py",
      );
    });
  });

  describe("isPathOrFileContext", () => {
    it("identifies path-focused commands", () => {
      expect(isPathOrFileContext("cd /opt/").isPath).toBe(true);
      expect(isPathOrFileContext("cd src/").command).toBe("cd");
      expect(isPathOrFileContext("cat ./package.json").isPath).toBe(true);
      expect(isPathOrFileContext("python main").isPath).toBe(true);
      expect(isPathOrFileContext("python ").command).toBe("python");
    });

    it("distinguishes non-path command keywords", () => {
      expect(isPathOrFileContext("git status").isPath).toBe(false);
      expect(isPathOrFileContext("docker ps").isPath).toBe(false);
    });
  });

  describe("predictTerminalSuggestions", () => {
    it("predicts real files in CWD above stale history for runner commands", async () => {
      const res = await predictTerminalSuggestions("python ", {
        leafId: 1,
        cwd: "/opt/docker/hermes-server",
        isUnix: true,
      });

      expect(res.hasRealPaths).toBe(true);
      // Real .py file in directory gets top priority
      expect(res.items[0]).toBe("python main.py");
      // History is normalized for Unix (no backslashes)
      expect(res.items).toContain("python ./run_migrations.py");
      expect(res.ghostTail).toBe("main.py");
    });

    it("predicts directories for cd command", async () => {
      const res = await predictTerminalSuggestions("cd ", {
        leafId: 2,
        cwd: "/opt/docker/hermes-server",
        isUnix: true,
      });

      expect(res.hasRealPaths).toBe(true);
      expect(res.items).toContain("cd scripts/");
      expect(res.items).toContain("cd tests/");
      // Should NOT contain non-directory files like README.md for 'cd'
      expect(res.items).not.toContain("cd README.md");
    });
  });
});

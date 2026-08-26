import { describe, expect, it } from "vitest";
import { discoverProjectTasks } from "./taskDiscovery";

describe("discoverProjectTasks", () => {
  it("discovers package scripts and classifies test tasks", () => {
    const tasks = discoverProjectTasks({
      packageJson: JSON.stringify({
        scripts: { build: "vite build", test: "vitest run", dev: "vite" },
      }),
    });

    expect(tasks.map((task) => task.id)).toEqual([
      "package:build",
      "package:dev",
      "package:test",
    ]);
    expect(tasks.find((task) => task.id === "package:test")?.kind).toBe("test");
    expect(tasks.find((task) => task.id === "package:build")?.command).toBe(
      "pnpm run build",
    );
  });

  it("adds bounded Cargo tasks and merges valid project tasks", () => {
    const tasks = discoverProjectTasks({
      cargoToml: "[package]\nname = \"demo\"",
      customTasksJson: JSON.stringify({
        tasks: [
          { id: "api", label: "API", command: "cargo run -p api", kind: "run" },
          { id: "bad", label: "Bad", command: "", kind: "run" },
        ],
      }),
    });

    expect(tasks.some((task) => task.id === "cargo:test")).toBe(true);
    expect(tasks.some((task) => task.id === "custom:api")).toBe(true);
    expect(tasks.some((task) => task.id === "custom:bad")).toBe(false);
  });

  it("caps untrusted manifest input", () => {
    const scripts = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [`task-${index}`, "echo ok"]),
    );
    expect(
      discoverProjectTasks({ packageJson: JSON.stringify({ scripts }) }),
    ).toHaveLength(200);
  });

  it("rejects package script names that could alter the shell command", () => {
    const tasks = discoverProjectTasks({
      packageJson: JSON.stringify({ scripts: { "test; echo injected": "vitest" } }),
    });
    expect(tasks).toEqual([]);
  });
});

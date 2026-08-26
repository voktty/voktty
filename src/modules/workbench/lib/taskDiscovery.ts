export type ProjectTaskKind = "build" | "run" | "test" | "lint" | "other";

export type ProjectTask = {
  id: string;
  label: string;
  command: string;
  kind: ProjectTaskKind;
  source: "package" | "cargo" | "custom";
};

type DiscoveryInput = {
  packageJson?: string | null;
  cargoToml?: string | null;
  customTasksJson?: string | null;
};

const MAX_TASKS = 200;
const MAX_FIELD = 4_096;

function classify(name: string): ProjectTaskKind {
  const value = name.toLowerCase();
  if (value.includes("test") || value.includes("spec")) return "test";
  if (value.includes("lint") || value.includes("check") || value.includes("fmt")) {
    return "lint";
  }
  if (value.includes("build") || value.includes("compile")) return "build";
  if (value.includes("dev") || value.includes("start") || value.includes("run")) {
    return "run";
  }
  return "other";
}

function bounded(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_FIELD ? trimmed : null;
}

function parseObject(text: string | null | undefined): Record<string, unknown> | null {
  if (!text || text.length > 2 * 1024 * 1024) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function discoverProjectTasks(input: DiscoveryInput): ProjectTask[] {
  const tasks: ProjectTask[] = [];
  const pkg = parseObject(input.packageJson);
  const scripts = pkg?.scripts;
  if (scripts && typeof scripts === "object" && !Array.isArray(scripts)) {
    const names = Object.keys(scripts as Record<string, unknown>).sort((a, b) =>
      a.localeCompare(b),
    );
    for (const name of names) {
      if (tasks.length >= MAX_TASKS) break;
      const safeName = bounded(name);
      const script = bounded((scripts as Record<string, unknown>)[name]);
      if (!safeName || !script || !/^[a-zA-Z0-9:_-]+$/.test(safeName)) continue;
      tasks.push({
        id: `package:${safeName}`,
        label: safeName,
        command: `pnpm run ${safeName}`,
        kind: classify(safeName),
        source: "package",
      });
    }
  }

  if (input.cargoToml?.trim() && tasks.length < MAX_TASKS) {
    const cargoTask = (
      id: string,
      command: string,
      kind: ProjectTaskKind,
    ): ProjectTask => ({
      id: `cargo:${id}`,
      label: command,
      command,
      kind,
      source: "cargo",
    });
    const cargoTasks: ProjectTask[] = [
      cargoTask("build", "cargo build", "build"),
      cargoTask("check", "cargo check", "lint"),
      cargoTask("clippy", "cargo clippy --workspace --all-targets", "lint"),
      cargoTask("run", "cargo run", "run"),
      cargoTask("test", "cargo test --workspace", "test"),
    ];
    tasks.push(...cargoTasks.slice(0, MAX_TASKS - tasks.length));
  }

  const custom = parseObject(input.customTasksJson)?.tasks;
  if (Array.isArray(custom)) {
    for (const candidate of custom) {
      if (tasks.length >= MAX_TASKS) break;
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const record = candidate as Record<string, unknown>;
      const id = bounded(record.id);
      const label = bounded(record.label);
      const command = bounded(record.command);
      if (!id || !label || !command || !/^[a-zA-Z0-9._-]+$/.test(id)) continue;
      tasks.push({
        id: `custom:${id}`,
        label,
        command,
        kind: classify(bounded(record.kind) ?? id),
        source: "custom",
      });
    }
  }

  return tasks.slice(0, MAX_TASKS);
}

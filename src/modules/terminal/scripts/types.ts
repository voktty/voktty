export type ScriptCategory =
  | "dev"
  | "build"
  | "test"
  | "lint"
  | "docker"
  | "custom";

export type ProjectScript = {
  id: string;
  name: string;
  command: string;
  source:
    | "package.json"
    | "Cargo.toml"
    | "Makefile"
    | "docker-compose"
    | "pyproject"
    | "go.mod";
  category: ScriptCategory;
  description?: string;
};

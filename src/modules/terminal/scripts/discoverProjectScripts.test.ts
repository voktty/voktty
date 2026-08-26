import { describe, expect, it } from "vitest";
import {
  categorizeScriptName,
  parseCargoToml,
  parseDockerCompose,
  parseGoMod,
  parseMakefile,
  parsePackageJson,
  parsePyprojectToml,
} from "./discoverProjectScripts";

describe("discoverProjectScripts", () => {
  it("categorizes script names properly", () => {
    expect(categorizeScriptName("dev")).toBe("dev");
    expect(categorizeScriptName("start:dev")).toBe("dev");
    expect(categorizeScriptName("build:prod")).toBe("build");
    expect(categorizeScriptName("test")).toBe("test");
    expect(categorizeScriptName("lint")).toBe("lint");
    expect(categorizeScriptName("check-types")).toBe("lint");
    expect(categorizeScriptName("docker-up")).toBe("docker");
    expect(categorizeScriptName("deploy")).toBe("custom");
  });

  it("parses package.json scripts with pnpm default or detected lockfile", () => {
    const pkg = JSON.stringify({
      scripts: {
        dev: "vite",
        build: "vite build",
        test: "vitest",
        lint: "eslint .",
      },
    });

    const pnpmScripts = parsePackageJson(pkg, ["pnpm-lock.yaml"]);
    expect(pnpmScripts).toHaveLength(4);
    expect(pnpmScripts[0].command).toBe("pnpm dev");
    expect(pnpmScripts[0].category).toBe("dev");

    const bunScripts = parsePackageJson(pkg, ["bun.lockb"]);
    expect(bunScripts[0].command).toBe("bun dev");

    const npmScripts = parsePackageJson(pkg, ["package-lock.json"]);
    expect(npmScripts[0].command).toBe("npm run dev");
    expect(npmScripts.find((s) => s.name === "test")?.command).toBe("npm test");
  });

  it("parses Cargo.toml targets", () => {
    const cargo = `
[package]
name = "my-app"
version = "0.1.0"
`;
    const scripts = parseCargoToml(cargo);
    expect(scripts.some((s) => s.command === "cargo run")).toBe(true);
    expect(scripts.some((s) => s.command === "cargo test")).toBe(true);
    expect(scripts.some((s) => s.command === "cargo check")).toBe(true);
    expect(scripts.some((s) => s.command === "cargo clippy")).toBe(true);
  });

  it("parses Makefile targets", () => {
    const make = `
.PHONY: all clean

build:
\t@echo Building

test:
\t@echo Testing

deploy:
\t@echo Deploying
`;
    const scripts = parseMakefile(make);
    expect(scripts.map((s) => s.name)).toEqual(["build", "test", "deploy"]);
    expect(scripts[0].command).toBe("make build");
  });

  it("parses docker-compose configuration", () => {
    const compose = `
version: '3.8'
services:
  web:
    image: nginx
`;
    const scripts = parseDockerCompose(compose);
    expect(scripts).toHaveLength(4);
    expect(scripts[0].command).toBe("docker compose up");
    expect(scripts[1].command).toBe("docker compose up -d");
  });

  it("parses pyproject.toml configuration", () => {
    const py = `
[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.ruff]
line-length = 88
`;
    const scripts = parsePyprojectToml(py);
    expect(scripts.some((s) => s.command === "pytest")).toBe(true);
    expect(scripts.some((s) => s.command === "ruff check")).toBe(true);
  });

  it("parses go.mod configuration", () => {
    const goMod = "module example.com/myapp\n\ngo 1.21\n";
    const scripts = parseGoMod(goMod);
    expect(scripts).toHaveLength(3);
    expect(scripts[0].command).toBe("go run .");
  });
});

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";
import { loadKitTemplate } from "@/modules/workspace-kit/lib/resources";
import {
  renderKitTemplate,
  type KitFile,
} from "@/modules/workspace-kit/lib/template";
import {
  planKitDeployment,
  type KitPathFact,
} from "@/modules/workspace-kit/lib/deployment";

let files: readonly KitFile[];
beforeAll(async () => {
  files = renderKitTemplate(await loadKitTemplate(), {
    project_name: "Fixture",
    language: "en",
    created_at: "2026-10-28",
  });
});
function emptyFacts() {
  return new Map<string, KitPathFact>(
    files.map((file) => [file.path, { kind: "absent" }]),
  );
}

it("requires known absence, opts out root edits and places kit publication last", () => {
  const plan = planKitDeployment(files, emptyFacts());
  expect(plan.entries).toHaveLength(35);
  expect(plan.entries.every((entry) => entry.action === "create")).toBe(true);
  expect(plan.entries.some((entry) => !entry.path.startsWith(".voktty/"))).toBe(
    false,
  );
  expect(plan.entries[plan.entries.length - 1].path).toBe(".voktty/kit.json");
  expect(plan.canPublish).toBe(true);
  expect(() => planKitDeployment(files, new Map())).toThrow(
    "Missing deployment observation",
  );
});

it("makes a repeated preview a no-op without modifying its snapshots", () => {
  const facts = emptyFacts();
  for (const entry of planKitDeployment(files, facts).entries) {
    facts.set(entry.path, { kind: "file", text: entry.proposed });
  }
  const before = [...facts];
  const plan = planKitDeployment(files, facts);
  expect(plan.entries.every((entry) => entry.action === "skip")).toBe(true);
  expect([...facts]).toEqual(before);
});

it("retains exact surrounding bytes when replacing its one marked block", () => {
  const facts = emptyFacts();
  const prefix = "# Existing rules\r\nKeep these rules.\r\n\r\n";
  const suffix = "\r\nTail without final newline";
  facts.set("AGENTS.md", {
    kind: "file",
    text: `${prefix}<!-- voktty-workspace-kit:start -->\nOld block\n<!-- voktty-workspace-kit:end -->${suffix}`,
  });
  const links = { agents: true, claude: false };
  const entry = planKitDeployment(files, facts, links).entries.find(
    (item) => item.path === "AGENTS.md",
  );
  expect(entry?.action).toBe("migrate");
  expect(entry?.proposed.startsWith(prefix)).toBe(true);
  expect(entry?.proposed.endsWith(suffix)).toBe(true);
  expect(entry?.proposed).not.toContain("Old block");
  facts.set("AGENTS.md", { kind: "file", text: entry?.proposed ?? "" });
  expect(
    planKitDeployment(files, facts, links).entries.find(
      (item) => item.path === "AGENTS.md",
    )?.action,
  ).toBe("skip");
});

it.each([
  "Quoted <!-- voktty-workspace-kit:start -->\nUser prose\n<!-- voktty-workspace-kit:end -->",
  "<!-- voktty-workspace-kit:start -->\nUser prose\n<!-- voktty-workspace-kit:end --> not a marker line",
  "User text\n<!-- voktty-workspace-kit:start -->unfinished",
  "<!-- voktty-workspace-kit:end -->",
  "<!-- voktty-workspace-kit:end --><!-- voktty-workspace-kit:start -->",
  "<!-- voktty-workspace-kit:start --><!-- voktty-workspace-kit:end --><!-- voktty-workspace-kit:start -->",
])(
  "blocks ambiguous AGENTS markers without authorizing publication",
  (text) => {
    const facts = emptyFacts();
    facts.set("AGENTS.md", { kind: "file", text });
    const plan = planKitDeployment(files, facts, {
      agents: true,
      claude: false,
    });
    expect(plan.canPublish).toBe(false);
    expect(
      plan.entries.find((entry) => entry.path === "AGENTS.md"),
    ).toMatchObject({ action: "conflict", expected: text });
  },
);

it("appends optional links once while retaining all existing native instructions", () => {
  const facts = emptyFacts();
  facts.set("AGENTS.md", { kind: "file", text: "My instructions" });
  facts.set("CLAUDE.md", {
    kind: "file",
    text: "Claude-specific instructions\r\n",
  });
  const links = { agents: true, claude: true };
  const first = planKitDeployment(files, facts, links);
  for (const path of ["AGENTS.md", "CLAUDE.md"]) {
    const entry = first.entries.find((item) => item.path === path);
    const current = facts.get(path);
    expect(
      entry?.proposed.startsWith(
        current?.kind === "file" ? current.text : "missing",
      ),
    ).toBe(true);
    facts.set(path, { kind: "file", text: entry?.proposed ?? "" });
  }
  const second = planKitDeployment(files, facts, links);
  expect(
    second.entries
      .filter((entry) => !entry.path.startsWith(".voktty/"))
      .map((entry) => entry.action),
  ).toEqual(["skip", "skip"]);
});

it("refuses a dangling CLAUDE link without opting into an AGENTS edit", () => {
  const facts = emptyFacts();
  const plan = planKitDeployment(files, facts, { agents: false, claude: true });
  expect(plan.entries.some((entry) => entry.path === "AGENTS.md")).toBe(false);
  expect(plan.entries.find((entry) => entry.path === "CLAUDE.md")?.action).toBe(
    "conflict",
  );
  expect(plan.canPublish).toBe(false);
});

it("classifies changed content and unavailable paths as conflicts without a forced write", () => {
  const facts = emptyFacts();
  facts.set(".voktty/CONTEXT.md", {
    kind: "file",
    text: "Project-owned context",
  });
  facts.set(".voktty/INIT.md", { kind: "blocked" });
  const plan = planKitDeployment(files, facts);
  expect(plan.canPublish).toBe(false);
  expect(
    plan.entries.find((entry) => entry.path === ".voktty/CONTEXT.md"),
  ).toMatchObject({ action: "conflict", expected: "Project-owned context" });
  expect(
    plan.entries.find((entry) => entry.path === ".voktty/INIT.md"),
  ).toMatchObject({ action: "conflict", reason: "unavailable" });
});

it("migrates wildcard ignore with an allowlist, leaving reserved and unknown data private in real Git", () => {
  const facts = emptyFacts();
  facts.set(".voktty/.gitignore", { kind: "file", text: "*\n" });
  facts.set(".voktty/tasks.json", { kind: "file", text: "private tasks" });
  const plan = planKitDeployment(files, facts);
  const ignore = plan.entries.find(
    (entry) => entry.path === ".voktty/.gitignore",
  );
  expect(ignore?.action).toBe("migrate");
  expect(
    plan.entries.some((entry) => entry.path === ".voktty/tasks.json"),
  ).toBe(false);
  const directory = mkdtempSync(join(tmpdir(), "voktty-kit-ignore-"));
  try {
    execFileSync("git", ["init", "--quiet", directory]);
    mkdirSync(join(directory, ".voktty"));
    writeFileSync(
      join(directory, ".voktty/.gitignore"),
      ignore?.proposed ?? "",
    );
    for (const path of [
      "sessions/id.json",
      "state/agents.json",
      "mailbox/a/inbox/id.json",
      "locks/memory.lock",
      "tasks/a.md",
      "tasks.json",
      "tools.json",
      "unknown.json",
      "team/private.json",
    ]) {
      expect(
        spawnSync(
          "git",
          ["check-ignore", "--no-index", "-q", `.voktty/${path}`],
          { cwd: directory },
        ).status,
        path,
      ).toBe(0);
    }
    for (const entry of plan.entries) {
      expect(
        spawnSync("git", ["check-ignore", "--no-index", "-q", entry.path], {
          cwd: directory,
        }).status,
        entry.path,
      ).toBe(1);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  facts.set(".voktty/.gitignore", {
    kind: "file",
    text: ignore?.proposed ?? "",
  });
  expect(
    planKitDeployment(files, facts).entries.find(
      (entry) => entry.path === ".voktty/.gitignore",
    )?.action,
  ).toBe("skip");
});

it.each([
  ".voktty/sessions/id.json",
  ".voktty/tasks.json",
  ".voktty/Sessions/id.json",
  ".voktty/Tasks.json",
  ".voktty/../outside",
  "C:/outside",
  ".voktty/a\\b",
])("rejects a reserved or unsafe deployment path %s", (path) => {
  expect(() =>
    planKitDeployment(
      [...files, { path, kind: "content", text: "bad" }],
      emptyFacts(),
    ),
  ).toThrow("Invalid deployment path");
});

import { describe, expect, it } from "vitest";
import { loadKitTemplate } from "@/modules/workspace-kit/lib/resources";
import {
  parseKitTemplate,
  renderKitTemplate,
} from "@/modules/workspace-kit/lib/template";

const raw = import.meta.glob<string>(
  [
    "/templates/workspace-kit/manifest.json",
    "/templates/workspace-kit/placeholders.json",
    "/templates/workspace-kit/dot-voktty/**/*",
    "/templates/workspace-kit/dot-voktty/.gitignore",
    "/templates/workspace-kit/root/*",
  ],
  { query: "?raw", import: "default", eager: true },
);
const resources = Object.fromEntries(
  Object.entries(raw).map(([path, text]) => [
    path.replace("/templates/workspace-kit/", ""),
    text,
  ]),
);
const values = {
  project_name: "Fixture",
  language: "es",
  created_at: "2026-10-28",
};

describe("kit template resources", () => {
  it("loads every manifest resource lazily from the same source, including the private ignore", async () => {
    const template = await loadKitTemplate();
    expect(template).toEqual(parseKitTemplate(resources));
    expect(template.files).toHaveLength(37);
    expect(
      template.files.find((file) => file.path === ".voktty/.gitignore")?.kind,
    ).toBe("base");
    expect(
      template.files
        .filter((file) => file.kind === "link")
        .map((file) => file.path),
    ).toEqual(["AGENTS.md", "CLAUDE.md"]);
    expect(Object.isFrozen(template.files[0])).toBe(true);
  });

  it("renders JSON string values without interpreting quotes, newlines, backslashes or Unicode", () => {
    const template = parseKitTemplate(resources);
    const project_name = 'A "quoted" \\ project\n日本語';
    const files = renderKitTemplate(template, { ...values, project_name });
    const config = JSON.parse(
      files.find((file) => file.path === ".voktty/kit.json")?.text ?? "",
    );
    expect(config.project).toBe(project_name);
    expect(config.kitVersion).toBe(template.version);
    expect(config.language).toBe("es");
    expect(files.some((file) => /\{[a-z][a-z0-9_]*\}/.test(file.text))).toBe(
      false,
    );
    expect(
      files.find((file) => file.path === ".voktty/PROJECT.md")?.text,
    ).toContain(project_name);
    expect(
      template.files.find((file) => file.path === ".voktty/kit.json")?.text,
    ).toContain("{project_name}");
  });

  it.each([
    { project_name: "" },
    { project_name: "{owner_title}" },
    { project_name: "\0" },
    { project_name: "é".repeat(8193) },
    { created_at: undefined },
    { kit_version: "99.0.0" },
    { unexpected: "value" },
  ])(
    "rejects missing, oversized, unresolved or unknown values: %j",
    (overrides) => {
      expect(() =>
        renderKitTemplate(parseKitTemplate(resources), {
          ...values,
          ...overrides,
        }),
      ).toThrow();
    },
  );

  it("rejects an unknown placeholder rather than leaving a silent gap", () => {
    expect(() =>
      parseKitTemplate({ ...resources, "dot-voktty/INIT.md": "{unknown}" }),
    ).toThrow("Unknown kit placeholder");
  });

  it("refuses missing or unlisted files instead of silently shipping a partial template", () => {
    const missing = { ...resources };
    delete missing["dot-voktty/INIT.md"];
    expect(() => parseKitTemplate(missing)).toThrow("Missing kit resource");
    expect(() =>
      parseKitTemplate({ ...resources, "dot-voktty/hidden.md": "unexpected" }),
    ).toThrow("Unlisted kit resource");
  });

  it.each([
    "dot-voktty/../outside",
    "dot-voktty/./INIT.md",
    "root/C:/file",
    "root/a\\b",
  ])("rejects a nonportable manifest path %s", (source) => {
    const manifest = JSON.parse(resources["manifest.json"]);
    manifest.files[0].source = source;
    expect(() =>
      parseKitTemplate({
        ...resources,
        "manifest.json": JSON.stringify(manifest),
      }),
    ).toThrow();
  });

  it("rejects case aliases, wrong file roles and oversized resources", () => {
    const manifest = JSON.parse(resources["manifest.json"]);
    manifest.files.push({ source: "dot-voktty/init.md", kind: "base" });
    expect(() =>
      parseKitTemplate({
        ...resources,
        "manifest.json": JSON.stringify(manifest),
        "dot-voktty/init.md": "alias",
      }),
    ).toThrow("Duplicate kit path");
    manifest.files.pop();
    manifest.files[0].kind = "link";
    expect(() =>
      parseKitTemplate({
        ...resources,
        "manifest.json": JSON.stringify(manifest),
      }),
    ).toThrow("Invalid kit file kind");
    expect(() =>
      parseKitTemplate({
        ...resources,
        "dot-voktty/INIT.md": "x".repeat(262145),
      }),
    ).toThrow("exceeds limits");
  });
});

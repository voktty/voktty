import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const source = fileURLToPath(
  new URL("../../../../templates/workspace-kit/", import.meta.url),
);

it("preserves bundled template and contract bytes across Git checkout EOL settings", () => {
  const manifest = JSON.parse(
    readFileSync(join(source, "manifest.json"), "utf8"),
  ) as { files: { source: string }[] };
  const paths = [
    "manifest.json",
    "placeholders.json",
    ...manifest.files.map((file) => file.source),
    ...readdirSync(join(source, "contracts")).map(
      (file) => `contracts/${file}`,
    ),
  ];
  const expected = new Map(
    paths.map((path) => [path, readFileSync(join(source, path))]),
  );
  for (const bytes of expected.values()) {
    expect(bytes.includes(13)).toBe(false);
    expect(bytes.includes(10)).toBe(true);
  }
  const root = mkdtempSync(join(tmpdir(), "voktty-kit-eol-"));
  const attributes = join(source, ".gitattributes");
  try {
    for (const controlled of [false, true]) {
      const repository = join(root, controlled ? "controlled" : "uncontrolled");
      const output = join(root, controlled ? "lf" : "crlf");
      mkdirSync(repository);
      mkdirSync(output);
      for (const [path, bytes] of expected) {
        mkdirSync(dirname(join(repository, path)), { recursive: true });
        writeFileSync(join(repository, path), bytes);
      }
      if (controlled)
        writeFileSync(
          join(repository, ".gitattributes"),
          existsSync(attributes) ? readFileSync(attributes) : "",
        );
      const git = (...args: string[]) =>
        execFileSync(
          "git",
          [
            "-c",
            "core.autocrlf=true",
            "-c",
            "core.eol=crlf",
            "-c",
            "core.safecrlf=false",
            ...args,
          ],
          { cwd: repository, stdio: "pipe" },
        );
      git("init", "--quiet");
      git("add", "--", ...paths, ...(controlled ? [".gitattributes"] : []));
      git("checkout-index", "--all", `--prefix=${output.replace(/\\/g, "/")}/`);
      for (const [path, original] of expected) {
        const actual = readFileSync(join(output, path));
        if (controlled) expect(actual, path).toEqual(original);
        else {
          expect(actual.includes(Buffer.from("\r\n")), path).toBe(true);
          expect(actual.equals(original), path).toBe(false);
        }
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

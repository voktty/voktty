import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { version } from "../package.json";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

it.skipIf(process.platform === "win32")(
  "installs a verified Unix host package and reuses it",
  () => {
    const root = mkdtempSync(join(tmpdir(), "voktty-bootstrap-test-"));
    roots.push(root);
    const home = join(root, "home");
    const source = join(root, "source");
    const tools = join(root, "tools");
    for (const path of [home, source, tools]) mkdirSync(path);
    const events = join(root, "events");
    const downloads = join(root, "downloads");
    const executable = join(source, "voktty-host");
    writeFileSync(
      executable,
      `#!/bin/sh
case "$1" in
  --version) echo '${version}' ;;
  service) echo "service $2" >> "$TEST_EVENTS" ;;
  connection-info) echo '{"port":3774,"pid":123}' ;;
  *) exit 1 ;;
esac
`,
    );
    chmodSync(executable, 0o755);
    const archive = join(root, "host.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", source, "."]);
    const checksum = join(root, "host.sha256");
    writeFileSync(
      checksum,
      `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  host.tar.gz\n`,
    );
    const curl = join(tools, "curl");
    writeFileSync(
      curl,
      `#!/bin/sh
for arg in "$@"; do
  case "$arg" in https://*) url="$arg" ;; esac
done
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; output="$1"; fi
  shift
done
echo "$url" >> "$TEST_DOWNLOADS"
case "$url" in *.sha256) cp "$TEST_CHECKSUM" "$output" ;; *) cp "$TEST_ARCHIVE" "$output" ;; esac
`,
    );
    chmodSync(curl, 0o755);
    const script = readFileSync(
      "src-tauri/src/modules/harness/remote_bootstrap.sh",
      "utf8",
    )
      .replace("@@VERSION@@", `'${version}'`)
      .replace("@@RELEASE@@", "'https://example.invalid'");
    const run = (forceUpgrade = false) =>
      spawnSync("sh", ["-s"], {
        input: script,
        encoding: "utf8",
        env: {
          ...process.env,
          HOME: home,
          PATH: `${tools}:${process.env.PATH ?? ""}`,
          TEST_ARCHIVE: archive,
          TEST_CHECKSUM: checksum,
          TEST_DOWNLOADS: downloads,
          TEST_EVENTS: events,
          VOKTTY_HOST_FORCE_UPGRADE: forceUpgrade ? "1" : "0",
        },
      });

    const installed = run();
    expect(installed.status, installed.stderr).toBe(0);
    expect(JSON.parse(installed.stdout)).toEqual({ port: 3774, pid: 123 });
    expect(existsSync(join(home, ".voktty-host/bin/voktty-host"))).toBe(true);
    expect(readFileSync(downloads, "utf8").trim().split("\n")).toHaveLength(2);
    const reused = run();
    expect(reused.status, reused.stderr).toBe(0);
    expect(readFileSync(downloads, "utf8").trim().split("\n")).toHaveLength(2);
    const pointer = readFileSync(
      join(home, ".voktty-host/runtime-path"),
      "utf8",
    );
    const upgraded = run(true);
    expect(upgraded.status, upgraded.stderr).toBe(0);
    expect(
      readFileSync(join(home, ".voktty-host/runtime-path"), "utf8"),
    ).not.toBe(pointer);
    expect(readFileSync(downloads, "utf8").trim().split("\n")).toHaveLength(4);
    expect(readFileSync(events, "utf8").trim().split("\n")).toEqual([
      "service install",
      "service install",
      "service uninstall",
      "service install",
    ]);

    rmSync(join(home, ".voktty-host"), { recursive: true, force: true });
    writeFileSync(checksum, `${"0".repeat(64)}  host.tar.gz\n`);
    const rejected = run();
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("checksum mismatch");
    expect(existsSync(join(home, ".voktty-host/runtime-path"))).toBe(false);
  },
);

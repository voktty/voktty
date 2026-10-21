import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import {
  acquireHarnessBridge,
  configureChildBackend,
  type RawChildHandle,
  reserveRawChild,
} from "@/modules/harness/lib/harness/child";
import { expect, it, vi } from "vitest";
import { HostChildBackend } from "./child-backend";

class RecordingBackend extends HostChildBackend {
  readonly spawns: Array<{ nativeId: string; logicalId: unknown }> = [];

  override invoke<T>(
    command: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    if (command === "harness_spawn")
      this.spawns.push({
        nativeId: String(args.sessionId),
        logicalId: args.logicalSessionId,
      });
    return super.invoke<T>(command, args);
  }
}

it("isolates replacement raw owners over real headless process I/O", async () => {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "voktty-raw-owner-")),
  );
  const binary = join(directory, "provider.cjs");
  await writeFile(
    binary,
    `const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const { value } = JSON.parse(line);
  process.stdout.write(JSON.stringify({ value }) + '\\n');
  process.stderr.write('stderr:' + value + '\\n');
});
`,
    { mode: 0o700 },
  );
  const backend = new RecordingBackend({ codex: binary });
  configureChildBackend(backend);
  const release = await acquireHarnessBridge();
  const handles: RawChildHandle[] = [];
  try {
    await backend.authorizeWorkspace(directory);
    const a = reserveRawChild("runtime-session");
    handles.push(a);
    const aLines: string[] = [];
    a.watch(
      (line) => aLines.push(line),
      () => {},
    );
    await a.spawn(binary, [], directory);
    await a.write(JSON.stringify({ value: "a" }));
    await vi.waitFor(() => expect(aLines).toContain('{"value":"a"}'));

    const b = reserveRawChild("runtime-session");
    const c = reserveRawChild("sibling-session");
    handles.push(b, c);
    const bLines: string[] = [];
    const bErrors: string[] = [];
    const cLines: string[] = [];
    const cErrors: string[] = [];
    b.watch(
      (line) => bLines.push(line),
      () => {},
      (line) => bErrors.push(line),
    );
    c.watch(
      (line) => cLines.push(line),
      () => {},
      (line) => cErrors.push(line),
    );
    await Promise.all([
      b.spawn(binary, [], directory),
      c.spawn(binary, [], directory),
    ]);
    await a.close();
    await expect(a.write('{"value":"stale"}')).rejects.toThrow();
    await Promise.all([b.write('{"value":"b"}'), c.write('{"value":"c"}')]);
    await vi.waitFor(() => {
      expect(bLines).toEqual(['{"value":"b"}']);
      expect(bErrors).toEqual(["stderr:b"]);
      expect(cLines).toEqual(['{"value":"c"}']);
      expect(cErrors).toEqual(["stderr:c"]);
    });
    expect(new Set(backend.spawns.map(({ nativeId }) => nativeId)).size).toBe(
      3,
    );
    expect(backend.spawns).toEqual([
      { nativeId: a.nativeId, logicalId: "runtime-session" },
      { nativeId: b.nativeId, logicalId: "runtime-session" },
      { nativeId: c.nativeId, logicalId: "sibling-session" },
    ]);
  } finally {
    await Promise.allSettled(handles.map((handle) => handle.close()));
    await backend.close();
    release();
    expect(isAbsolute(directory)).toBe(true);
    expect(basename(directory)).toMatch(/^voktty-raw-owner-/);
    await rm(directory, { recursive: true, force: true });
  }
});

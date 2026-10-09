import { expect, it, vi } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  symlinkSync,
} from "node:fs";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HostChildBackend } from "./child-backend";
import { REMOTE_PROVIDERS } from "@/modules/connections/model/protocol";

it("resolves every provider and runs only allowed provider commands", async () => {
  const directory = mkdtempSync(join(tmpdir(), "voktty-catalog-test-"));
  const file = join(directory, "provider.cjs");
  writeFileSync(file, "console.log(JSON.stringify(process.argv.slice(2)))");
  const backend = new HostChildBackend(
    Object.fromEntries(REMOTE_PROVIDERS.map((provider) => [provider, file])),
  );
  await backend.authorizeWorkspace(directory);
  try {
    for (const provider of REMOTE_PROVIDERS) {
      const resolved = await backend.invoke<{ path: string; args?: string[] }>(
        `harness_resolve_${provider}`,
      );
      expect(resolved.path).toBe(file);
    }
    const output = await backend.invoke<string>("harness_exec", {
      command: file,
      args: ["models", "--json"],
      binaryProvider: "fx",
      cwd: directory,
    });
    expect(JSON.parse(output)).toEqual(["models", "--json"]);
    const cleanupArgs = [
      "--no-auto-update",
      "sessions",
      "delete",
      "550e8400-e29b-41d4-a716-446655440000",
    ];
    const cleanupOutput = await backend.invoke<string>("harness_exec", {
      command: file,
      args: cleanupArgs,
      binaryProvider: "grok",
      cwd: directory,
    });
    expect(JSON.parse(cleanupOutput)).toEqual(cleanupArgs);
    await expect(
      backend.invoke("harness_exec", {
        command: file,
        args: ["-e", "console.log('unsafe')"],
        binaryProvider: "fx",
      }),
    ).rejects.toThrow("Unsupported headless catalog command");
    for (const args of [
      ["service", "status"],
      ["service", "start"],
      ["service", "get", "password"],
    ]) {
      const serviceOutput = await backend.invoke<string>("harness_exec", {
        command: file,
        args,
        binaryProvider: "opencode",
        cwd: directory,
      });
      expect(JSON.parse(serviceOutput)).toEqual(args);
    }
    for (const [provider, args] of [
      ["fx", ["service", "start"]],
      ["opencode", ["service", "stop"]],
      ["opencode", ["service get", "password"]],
      ["opencode", ["service", "get", "password", "--json"]],
      ["opencode", ["models --json"]],
      ["cursor", cleanupArgs],
      ["grok", ["--no-auto-update", "sessions", "delete", "--all"]],
      ["grok", ["--no-auto-update", "sessions", "delete", "../sessions"]],
      ["grok", [...cleanupArgs, "--all"]],
    ] as const) {
      await expect(
        backend.invoke("harness_exec", {
          command: file,
          args,
          binaryProvider: provider,
        }),
      ).rejects.toThrow("Unsupported headless catalog command");
    }
  } finally {
    await backend.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("bridges OpenCode HTTP and event streams on loopback", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/event") {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write('data: {"type":"ready"}\n\n');
    } else {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"ok":true}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server address");
  const backend = new HostChildBackend();
  const events: string[] = [];
  const unlisten = await backend.listen<{ data: string }>(
    "harness-sse",
    ({ payload }) => events.push(payload.data),
  );
  try {
    const base = `http://127.0.0.1:${address.port}`;
    expect(
      await backend.invoke("harness_http", { url: base, method: "GET" }),
    ).toEqual({ status: 200, body: '{"ok":true}' });
    await backend.invoke("harness_sse_open", {
      sessionId: "fixture",
      url: `${base}/event`,
    });
    await vi.waitFor(() => expect(events).toEqual(['{"type":"ready"}']));
    await backend.invoke("harness_sse_close", { sessionId: "fixture" });
    await expect(
      backend.invoke("harness_http", {
        url: "https://example.com/",
        method: "GET",
      }),
    ).rejects.toThrow("localhost");
  } finally {
    unlisten();
    await backend.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("requires an authorized canonical workspace and rejects unsupported sandboxing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "voktty-host-authorize-"));
  const root = join(directory, "project");
  const outside = join(directory, "project-other");
  mkdirSync(root);
  mkdirSync(outside);
  const file = join(directory, "provider.cjs");
  writeFileSync(file, "console.log('ok')");
  const backend = new HostChildBackend({ opencode: file });
  const service = {
    command: file,
    args: ["service", "status"],
    binaryProvider: "opencode",
  };
  const spawn = { sessionId: "guarded", command: file, args: [], cwd: root };
  try {
    await expect(backend.invoke("harness_exec", service)).rejects.toThrow(
      "authorized workspace",
    );
    await expect(backend.invoke("harness_spawn", spawn)).rejects.toThrow(
      "not authorized",
    );
    await backend.authorizeWorkspace(root);
    await expect(
      backend.invoke("harness_exec", { ...service, cwd: root }),
    ).resolves.toBe("ok\n");
    await expect(
      backend.invoke("harness_exec", { ...service, cwd: outside }),
    ).rejects.toThrow("not authorized");
    await expect(
      backend.invoke("harness_exec", {
        ...service,
        cwd: root,
        binaryProvider: undefined,
      }),
    ).rejects.toThrow("Unsupported");
    await expect(
      backend.invoke("harness_spawn", { ...spawn, networkAllowlist: [] }),
    ).rejects.toThrow("network allowlist");
    await expect(
      backend.invoke("harness_spawn", { ...spawn, command: process.execPath }),
    ).rejects.toThrow("Unsupported provider");
    const cancelled = expect(
      backend.invoke("harness_spawn", spawn),
    ).rejects.toThrow("cancelled");
    await backend.kill("guarded");
    await cancelled;
    if (process.platform !== "win32") {
      symlinkSync(outside, join(root, "escape"));
      await expect(
        backend.invoke("harness_exec", {
          ...service,
          cwd: join(root, "escape"),
        }),
      ).rejects.toThrow("not authorized");
    }
    await backend.close();
    await expect(
      backend.invoke("harness_exec", { ...service, cwd: root }),
    ).rejects.toThrow("Host is stopping");
  } finally {
    await backend.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("does not end a replacement stream when its old request is aborted", async () => {
  const responses: import("node:http").ServerResponse[] = [];
  const server = createServer((_request, response) => {
    responses.push(response);
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`data: ${responses.length}\n\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  const backend = new HostChildBackend();
  const data: string[] = [];
  const ended = vi.fn();
  await backend.listen<{ data: string }>("harness-sse", ({ payload }) =>
    data.push(payload.data),
  );
  await backend.listen("harness-sse-end", ended);
  try {
    const input = {
      sessionId: "replace",
      url: `http://127.0.0.1:${address.port}/event`,
    };
    await backend.invoke("harness_sse_open", input);
    await vi.waitFor(() => expect(data).toEqual(["1"]));
    await backend.invoke("harness_sse_open", input);
    await vi.waitFor(() => expect(data).toEqual(["1", "2"]));
    expect(ended).not.toHaveBeenCalled();
    responses[1]?.end();
    await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
  } finally {
    await backend.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("rejects authenticated redirects and URL credentials", async () => {
  let redirected = false;
  const server = createServer((request, response) => {
    if (request.url === "/target") redirected = true;
    response.writeHead(302, { Location: "/target" });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  const backend = new HostChildBackend();
  try {
    const url = `http://127.0.0.1:${address.port}`;
    await expect(
      backend.invoke("harness_http", {
        url,
        method: "GET",
        headers: { Authorization: "Basic fixture" },
      }),
    ).rejects.toThrow();
    expect(redirected).toBe(false);
    await expect(
      backend.invoke("harness_http", {
        url: url.replace("http://", "http://user:secret@"),
        method: "GET",
      }),
    ).rejects.toThrow("localhost");
    await expect(
      backend.invoke("harness_http", {
        url: "http://127.0.0.1.remote.example/",
        method: "GET",
      }),
    ).rejects.toThrow("localhost");
  } finally {
    await backend.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("runs the resolved Claude version fallback in headless mode", async () => {
  const backend = new HostChildBackend({ claude: process.execPath });
  await backend.authorizeWorkspace(process.cwd());
  try {
    const version = await backend.invoke<string>("harness_exec", {
      command: process.execPath,
      args: ["--version"],
      binaryProvider: "claude",
      cwd: process.cwd(),
    });
    expect(version.trim()).toBe(process.version);
    await expect(
      backend.invoke("harness_exec", {
        command: process.execPath,
        args: ["-e", "console.log('unsafe')"],
        binaryProvider: "claude",
      }),
    ).rejects.toThrow("Unsupported headless catalog command");
  } finally {
    await backend.close();
  }
});

it.each([false, true])(
  "stops a provider tree (ignores SIGTERM: %s)",
  async (stubborn) => {
    const directory = mkdtempSync(join(tmpdir(), "voktty-provider-tree-"));
    const file = join(directory, "provider.cjs");
    writeFileSync(
      file,
      `const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', ${JSON.stringify(`${stubborn ? "process.on('SIGTERM', () => {});" : ""} console.log('ready'); setInterval(() => {}, 1000)`)}], { stdio: ['ignore', 'pipe', 'ignore'] });
child.stdout.once('data', () => console.log(JSON.stringify({ child: child.pid })));
setInterval(() => {}, 1000);
`,
    );
    const backend = new HostChildBackend({ codex: file });
    await backend.authorizeWorkspace(directory);
    let descendant: number | undefined;
    const stopListening = await backend.listen<{ line: string }>(
      "harness-stdout",
      ({ payload }) => {
        descendant = JSON.parse(payload.line).child;
      },
    );
    try {
      await backend.invoke("harness_spawn", {
        sessionId: "tree",
        command: file,
        args: [],
        cwd: directory,
      });
      await vi.waitFor(() => expect(descendant).toBeTruthy());
      await backend.kill("tree");
      await vi.waitFor(
        () => expect(() => process.kill(descendant!, 0)).toThrow(),
        { timeout: 5000 },
      );
    } finally {
      stopListening();
      await backend.close();
      if (descendant) {
        try {
          process.kill(descendant, "SIGKILL");
        } catch {
          /* gone */
        }
      }
      rmSync(directory, { recursive: true, force: true });
    }
  },
  15_000,
);

it("stops a provider tree when its host pipe closes unexpectedly", async () => {
  const directory = mkdtempSync(join(tmpdir(), "voktty-provider-crash-"));
  const treeFile = join(directory, "tree.json");
  const providerFile = join(directory, "provider.cjs");
  writeFileSync(
    providerFile,
    `const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync(${JSON.stringify(treeFile)}, JSON.stringify({ provider: process.pid, descendant: descendant.pid }));
setInterval(() => {}, 1000);
`,
  );
  const guard = spawn(
    process.execPath,
    [resolve("host/provider-guard.mjs"), process.execPath, providerFile],
    {
      cwd: directory,
      stdio: ["pipe", "ignore", "ignore", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    },
  );
  let guardClosed = false;
  guard.once("close", () => {
    guardClosed = true;
  });
  let tree: { provider: number; descendant: number } | undefined;
  try {
    await vi.waitFor(() => expect(existsSync(treeFile)).toBe(true));
    tree = JSON.parse(readFileSync(treeFile, "utf8"));
    guard.stdio[3]?.destroy();
    await vi.waitFor(
      () => {
        expect(() => process.kill(tree!.provider, 0)).toThrow();
        expect(() => process.kill(tree!.descendant, 0)).toThrow();
      },
      { timeout: 5_000 },
    );
    // The guard's cwd keeps this directory locked on Windows until it exits.
    await vi.waitFor(() => expect(guardClosed).toBe(true), { timeout: 5_000 });
  } finally {
    guard.stdio[3]?.destroy();
    guard.kill("SIGKILL");
    for (const pid of [tree?.provider, tree?.descendant]) {
      if (pid)
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* gone */
        }
    }
    await vi.waitFor(() => expect(guardClosed).toBe(true), { timeout: 5_000 });
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}, 10_000);

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const helperPath = fileURLToPath(new URL("../../src-tauri/resources/remote/linux-x86_64/voktty-remote", import.meta.url));

test("the shipped SSH helper creates project files and supplies project-only context", {
  skip: process.platform !== "linux" || process.arch !== "x64",
  timeout: 30_000,
}, async () => {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "voktty-helper-contract-"));
  const project = fs.mkdtempSync("/dev/shm/voktty-helper-project-");
  const helper = path.join(owned, "helper");
  const privateData = path.join(owned, "private");
  fs.copyFileSync(helperPath, helper);
  fs.chmodSync(helper, 0o700);
  const child = spawn(helper, ["--stdio"], {
    env: { ...process.env, XDG_DATA_HOME: privateData },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const exit = once(child, "exit");
  let buffered = Buffer.alloc(0);
  let sequence = 0;
  const pending = new Map();
  function fail(error) {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.on("exit", () => fail(new Error("Remote helper exited before replying")));
  child.stdout.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    try {
      while (buffered.length >= 4) {
        const size = buffered.readUInt32BE(0);
        assert.ok(size > 0 && size <= 8 * 1024 * 1024);
        if (buffered.length < size + 4) return;
        const kind = buffered[4];
        const payload = buffered.subarray(5, size + 4);
        buffered = buffered.subarray(size + 4);
        if (kind !== 2) continue;
        const response = JSON.parse(payload.toString("utf8"));
        const request = pending.get(response.id);
        assert.ok(request, "Unexpected response correlation");
        pending.delete(response.id);
        request.resolve(response);
      }
    } catch (error) {
      fail(error);
    }
  });
  async function request(method, params) {
    const id = String(++sequence);
    const body = Buffer.from(JSON.stringify({ protocol: 2, id, method, params }));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length + 1);
    let timer;
    const response = await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Remote helper timed out during ${params.operation ?? method}`));
      }, 5000);
      pending.set(id, { resolve, reject });
      child.stdin.write(Buffer.concat([length, Buffer.from([1]), body]));
    }).finally(() => clearTimeout(timer));
    assert.equal(response.protocol, 2);
    assert.equal(response.ok, true, `Remote request ${method} failed`);
    return response.result;
  }
  async function memory(params) {
    const reply = await request("memory.manage", params);
    assert.equal(reply.schema, 1);
    assert.equal(reply.ok, true, `Memory ${params.operation} failed: ${reply.error?.code}`);
    return reply.result;
  }
  try {
    const handshake = await request("handshake", { workspaceRoot: project });
    assert.ok(handshake.capabilities.includes("memory.manage"));
    const handle = await memory({ operation: "open" });
    const selection = await memory({ operation: "select", handle, path: project, revision: 1, inspectAncestors: true });
    const selected = { handle, selection };
    assert.equal((await memory({ operation: "inspect", ...selected })).scope.state, "absent");
    const preview = await memory({
      operation: "preview", ...selected, revision: 1,
      inputs: { project_name: "SSH fixture", created_at: "2026-11-06", language: "English" },
      links: { agents: true, claude: true },
    });
    assert.equal(preview.deployment.canPublish, true);
    await memory({ operation: "confirm", ...selected, review: preview.review });
    assert.match(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8"), /\.voktty\/INIT\.md/);
    assert.match(fs.readFileSync(path.join(project, "CLAUDE.md"), "utf8"), /@AGENTS\.md/);
    assert.equal((await memory({ operation: "inspect", ...selected })).scope.state, "ready");
    const context = await memory({ operation: "contextOpen" });
    const bound = await memory({ operation: "contextBindProject", schema: 2, context, ...selected });
    assert.equal(bound.schema, 2);
    await memory({ operation: "close", handle });
    const read = await memory({ operation: "contextRead", context });
    assert.equal(read.decision.contextAllowed, true);
    assert.match(read.packet.text, /SSH fixture/);
    assert.ok(read.packet.bytes > 0 && read.packet.bytes <= 24 * 1024);
    await memory({ operation: "contextClose", context });
    assert.equal(fs.existsSync(privateData), false, "Project memory must not open global storage");
  } finally {
    child.kill();
    await exit.catch(() => undefined);
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(owned, { recursive: true, force: true });
  }
});

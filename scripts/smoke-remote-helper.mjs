import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PROTOCOL = 2;
const REQUEST = 1;
const RESPONSE = 2;
const PTY_INPUT = 3;
const PTY_OUTPUT = 4;
const PTY_EXIT = 5;
const FS_CHANGED = 6;

function frame(kind, payload) {
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(payload.length + 1);
  return Buffer.concat([length, Buffer.from([kind]), payload]);
}

function request(id, method, params) {
  return frame(
    REQUEST,
    Buffer.from(JSON.stringify({ protocol: PROTOCOL, id, method, params })),
  );
}

function ptyData(kind, ptyId, data) {
  const id = Buffer.allocUnsafe(8);
  id.writeBigUInt64BE(BigInt(ptyId));
  return frame(kind, Buffer.concat([id, Buffer.from(data)]));
}

const repo = process.cwd();
const translated = spawnSync("wsl.exe", [
  "-d",
  "Ubuntu",
  "--",
  "wslpath",
  "-a",
  repo.replaceAll("\\", "/"),
], { encoding: "utf8" });
if (translated.status !== 0) {
  throw new Error(translated.stderr || "Could not translate repository path");
}
const wslRoot = translated.stdout.trim();
const helper = path.posix.join(
  wslRoot,
  "src-tauri/resources/remote/linux-x86_64/voktty-remote",
);
const child = spawn("wsl.exe", ["-d", "Ubuntu", "--", helper, "--stdio"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let buffered = Buffer.alloc(0);
let terminalOutput = "";
let handshakeReady = false;
let grepReady = false;
let ptyReady = false;
let ptyExited = false;
let fileChanged = false;
let watchRemoveSent = false;
const smokeFile = `.voktty-remote-watch-smoke-${process.pid}`;
const replaceSmokeFile = `.voktty-remote-replace-smoke-${process.pid}`;
const replaceSmokePath = path.join(repo, replaceSmokeFile);
const binarySmokeFile = `.voktty-remote-binary-smoke-${process.pid}`;
const binarySmokePath = path.join(repo, binarySmokeFile);
fs.writeFileSync(replaceSmokePath, "foo foo", "utf8");
fs.writeFileSync(binarySmokePath, Buffer.from([0, 255, 128]));

const timeout = setTimeout(() => {
  child.kill();
  fs.rmSync(replaceSmokePath, { force: true });
  fs.rmSync(binarySmokePath, { force: true });
  throw new Error("Remote helper smoke test timed out");
}, 10_000);

function finish(code = 0) {
  clearTimeout(timeout);
  fs.rmSync(replaceSmokePath, { force: true });
  fs.rmSync(binarySmokePath, { force: true });
  child.stdin.end();
  process.exitCode = code;
}

function finishWhenReady() {
  if (!ptyExited || !fileChanged || watchRemoveSent) return;
  watchRemoveSent = true;
  child.stdin.write(
    request("watch-remove", "fs.watchRemove", { paths: [wslRoot] }),
  );
}

function handleFrame(kind, payload) {
  if (kind === RESPONSE) {
    const response = JSON.parse(payload.toString("utf8"));
    if (!response.ok) throw new Error(JSON.stringify(response.error));
    if (response.id === "handshake") {
      const expected = [
        "fs.grep",
        "fs.readBinaryFile",
        "fs.replacePreview",
        "fs.replaceApply",
      ];
      if (!expected.every((method) => response.result.capabilities.includes(method))) {
        throw new Error("Remote helper did not advertise required filesystem capabilities");
      }
      handshakeReady = true;
      child.stdin.write(
        request("binary-read", "fs.readBinaryFile", {
          path: binarySmokeFile,
        }),
      );
    } else if (response.id === "binary-read") {
      if (
        response.result.contentBase64 !== "AP+A" ||
        response.result.size !== 3
      ) {
        throw new Error(`Unexpected binary read: ${JSON.stringify(response.result)}`);
      }
      fs.rmSync(binarySmokePath, { force: true });
      child.stdin.write(
        request("replace-preview", "fs.replacePreview", {
          spec: {
            pattern: "foo",
            replacement: "bar",
            regex: false,
            caseSensitive: true,
            wholeWord: false,
          },
          paths: [replaceSmokeFile],
        }),
      );
    } else if (response.id === "replace-preview") {
      const file = response.result.files?.[0];
      if (!file || file.replacements !== 2) {
        throw new Error(`Unexpected replace preview: ${JSON.stringify(response.result)}`);
      }
      child.stdin.write(
        request("replace-apply", "fs.replaceApply", {
          spec: {
            pattern: "foo",
            replacement: "bar",
            regex: false,
            caseSensitive: true,
            wholeWord: false,
          },
          targets: [{
            path: file.path,
            expectedMtime: file.mtime,
            expectedHash: file.hash,
            expectedReplacements: file.replacements,
          }],
        }),
      );
    } else if (response.id === "replace-apply") {
      if (
        response.result.status !== "applied" ||
        fs.readFileSync(replaceSmokePath, "utf8") !== "bar bar"
      ) {
        throw new Error(`Unexpected replace result: ${JSON.stringify(response.result)}`);
      }
      fs.rmSync(replaceSmokePath, { force: true });
      child.stdin.write(
        request("grep", "fs.grep", {
          pattern: '"name": "voktty"',
          include: ["package.json"],
          maxResults: 10,
        }),
      );
    } else if (response.id === "grep") {
      const hits = response.result.hits;
      if (
        !Array.isArray(hits) ||
        !hits.some(
          (hit) =>
            hit.rel === "package.json" &&
            hit.line === 2 &&
            hit.column > 0 &&
            hit.match_length > 0,
        )
      ) {
        throw new Error(`Unexpected workspace search result: ${JSON.stringify(response.result)}`);
      }
      grepReady = true;
      child.stdin.write(
        request("watch-add", "fs.watchAdd", { paths: [wslRoot] }),
      );
    } else if (response.id === "watch-add") {
      child.stdin.write(
        request("pty-open", "pty.open", {
          ptyId: 11,
          cols: 80,
          rows: 24,
          cwd: wslRoot,
          blocks: false,
        }),
      );
    } else if (response.id === "pty-open") {
      ptyReady = true;
      child.stdin.write(
        ptyData(
          PTY_INPUT,
          11,
          `touch '${smokeFile}'; sleep 0.3; rm '${smokeFile}'; printf 'VOKTTY_REMOTE_PTY_OK\\n'; exit\n`,
        ),
      );
    } else if (response.id === "watch-remove") {
      console.log(
        "Remote helper binary read, workspace search, PTY and file watcher smoke test passed",
      );
      finish();
    }
    return;
  }
  if (kind === PTY_OUTPUT) {
    const ptyId = Number(payload.readBigUInt64BE(0));
    if (ptyId === 11) terminalOutput += payload.subarray(8).toString("utf8");
    return;
  }
  if (kind === PTY_EXIT) {
    const ptyId = Number(payload.readBigUInt64BE(0));
    if (
      ptyId !== 11 ||
      !handshakeReady ||
      !grepReady ||
      !ptyReady ||
      !terminalOutput.includes("VOKTTY_REMOTE_PTY_OK")
    ) {
      throw new Error(`Unexpected PTY result: ${JSON.stringify(terminalOutput)}`);
    }
    ptyExited = true;
    finishWhenReady();
    return;
  }
  if (kind === FS_CHANGED) {
    const event = JSON.parse(payload.toString("utf8"));
    if (event.paths.some((changedPath) => changedPath.endsWith(smokeFile))) {
      fileChanged = true;
      finishWhenReady();
    }
  }
}

child.stdout.on("data", (chunk) => {
  buffered = Buffer.concat([buffered, chunk]);
  while (buffered.length >= 4) {
    const length = buffered.readUInt32BE(0);
    if (buffered.length < length + 4) return;
    const kind = buffered[4];
    const payload = buffered.subarray(5, length + 4);
    buffered = buffered.subarray(length + 4);
    handleFrame(kind, payload);
  }
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString("utf8");
});
child.on("error", (error) => {
  clearTimeout(timeout);
  throw error;
});
child.on("exit", (code) => {
  clearTimeout(timeout);
  if (process.exitCode === undefined && code !== 0) {
    throw new Error(stderr || `Remote helper exited with code ${code}`);
  }
});

child.stdin.write(
  request("handshake", "handshake", { workspaceRoot: wslRoot }),
);

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const mode = process.argv[2] ?? "modern";
const delayed = [];
const hanging = new Set();

function send(message) {
  const encoded = `${JSON.stringify(message)}\n`;
  if (mode !== "fragmented") {
    process.stdout.write(encoded);
    return;
  }
  const first = Math.max(1, Math.floor(encoded.length / 3));
  const second = Math.max(first + 1, Math.floor((encoded.length * 2) / 3));
  process.stdout.write(encoded.slice(0, first));
  setTimeout(() => process.stdout.write(encoded.slice(first, second)), 2);
  setTimeout(() => process.stdout.write(encoded.slice(second)), 4);
}

function result(id, value, includeResultType = true) {
  send({
    jsonrpc: "2.0",
    id,
    result: includeResultType ? { resultType: "complete", ...value } : value,
  });
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function tool(name) {
  return {
    name,
    description: `${name} fixture tool`,
    inputSchema: { type: "object", additionalProperties: true },
  };
}

if (mode === "garbage") {
  process.stdout.write("fixture started\n");
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.exitCode = 2;
    return;
  }

  if (message.method === "server/discover") {
    if (mode === "legacy") {
      error(message.id, -32601, "Method not found");
      return;
    }
    result(message.id, {
      supportedVersions: ["2026-07-28"],
      capabilities: { tools: { listChanged: true } },
      _meta: {
        "io.modelcontextprotocol/serverInfo": { name: "fixture", version: "1" },
      },
    });
    return;
  }

  if (message.method === "initialize") {
    result(
      message.id,
      {
        protocolVersion: "2025-11-25",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "legacy-fixture", version: "1" },
      },
      false,
    );
    return;
  }

  if (message.method === "notifications/initialized") return;

  if (message.method === "notifications/cancelled") {
    hanging.delete(message.params?.requestId);
    send({
      jsonrpc: "2.0",
      method: "fixture/cancelled",
      params: { requestId: message.params?.requestId },
    });
    return;
  }

  if (message.method === "tools/list") {
    if (mode === "hostile-schema") {
      result(message.id, {
        tools: [
          {
            ...tool("hostile"),
            inputSchema: { $ref: "https://attacker.invalid/schema.json" },
          },
        ],
      });
      return;
    }
    const legacy = mode === "legacy";
    const cursor = message.params?.cursor;
    const page = cursor === "" ? [tool("delay")] : [tool("echo")];
    const value = cursor === "" ? { tools: page } : { tools: page, nextCursor: "" };
    const response = {
      jsonrpc: "2.0",
      id: message.id,
      result: legacy ? value : { resultType: "complete", ...value },
    };
    send(response);
    if (mode === "duplicate" && cursor === "") {
      setTimeout(() => send(response), 5);
    }
    return;
  }

  if (message.method === "tools/call") {
    const name = message.params?.name;
    if (name === "hang") {
      hanging.add(message.id);
      return;
    }
    if (name === "spawn_child") {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      result(message.id, {
        content: [{ type: "text", text: String(child.pid) }],
        structuredContent: { pid: child.pid },
        isError: false,
      });
      return;
    }
    if (mode === "out-of-order" && name === "delay") {
      delayed.push(message);
      if (delayed.length === 2) {
        for (const item of delayed.reverse()) {
          result(item.id, {
            content: [{ type: "text", text: item.params.arguments.label }],
            structuredContent: { label: item.params.arguments.label },
            isError: false,
          });
        }
      }
      return;
    }
    const value = {
      content: [{ type: "text", text: message.params?.arguments?.text ?? "ok" }],
      structuredContent: message.params?.arguments ?? {},
      isError: false,
    };
    result(message.id, value, mode !== "legacy");
    return;
  }

  error(message.id, -32601, "Method not found");
});

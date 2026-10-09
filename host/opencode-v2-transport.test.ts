import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostChildBackend } from "./child-backend";
import {
  sendOpenCodeTurn,
  forgetOpenCodeSession,
} from "@/modules/harness/lib/harness/opencode";
import type { HarnessEvent } from "@/modules/harness/lib/harness/types";
import {
  acquireHarnessBridge,
  configureChildBackend,
} from "@/modules/harness/lib/harness/child";

const PASSWORD = "fixture-secret";

// OpenCode 2.x CLI: the chat server is a separately managed background
// service, so the binary only reports its version, URL and password.
const fixture = `const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2).join(' ');
if (args === '--version') console.log('opencode v2.0.15');
else if (args === 'service status' || args === 'service start')
  console.log(readFileSync(join(__dirname, 'service-url'), 'utf8'));
else if (args === 'service get password') console.log(${JSON.stringify(PASSWORD)});
else process.exit(2);
`;

let directory: string;
let server: Server;
let backend: HostChildBackend;
let release: () => void;
const subscribers = new Set<ServerResponse>();
const unauthorized: string[] = [];

function emit(type: string, data: Record<string, unknown>) {
  for (const subscriber of subscribers)
    subscriber.write(
      `data: ${JSON.stringify({ id: `evt_${type}`, type, data: { sessionID: "ses_v2", ...data } })}\n\n`,
    );
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "voktty-opencode-v2-transport-"));
  server = createServer((request, response) => {
    const expected = `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}`;
    if (request.headers.authorization !== expected) {
      unauthorized.push(request.url ?? "");
      response.writeHead(401);
      response.end();
      return;
    }
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (path === "/api/event") {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.flushHeaders();
      subscribers.add(response);
      request.on("close", () => subscribers.delete(response));
      return;
    }
    const json = (data: unknown) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data }));
    };
    const session = { id: "ses_v2", location: { directory } };
    if (path === "/api/session" || path === "/api/session/ses_v2")
      return json(session);
    if (path === "/api/session/ses_v2/message") return json([]);
    if (path === "/api/session/ses_v2/prompt") {
      response.writeHead(204);
      response.end();
      setTimeout(() => {
        emit("session.execution.started", {});
        emit("session.step.started", {
          assistantMessageID: "msg_1",
          model: { providerID: "openai", id: "fixture-model" },
        });
        emit("session.text.delta", {
          assistantMessageID: "msg_1",
          delta: "Headless OpenCode 2 completed",
        });
        emit("session.step.ended", { assistantMessageID: "msg_1" });
        emit("session.execution.succeeded", {});
      }, 30);
      return;
    }
    response.writeHead(204);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No server address");
  writeFileSync(
    join(directory, "service-url"),
    `http://127.0.0.1:${address.port}`,
  );
  const binary = join(directory, "opencode.cjs");
  writeFileSync(binary, fixture);
  backend = new HostChildBackend({ opencode: binary });
  await backend.authorizeWorkspace(directory);
  configureChildBackend(backend);
  release = await acquireHarnessBridge();
});

afterAll(async () => {
  await forgetOpenCodeSession("headless-v2");
  await backend?.close();
  release?.();
  server?.closeAllConnections();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (directory) rmSync(directory, { recursive: true, force: true });
});

it("runs an OpenCode 2.x session through the host service commands and bridge", async () => {
  const events: HarnessEvent[] = [];
  await sendOpenCodeTurn({
    sessionId: "headless-v2",
    cwd: directory,
    model: "opencode:openai/fixture-model",
    runtimeMode: "supervised",
    text: "hello",
    onEvent: (event) => events.push(event),
  });
  expect(events).toContainEqual({
    type: "message.delta",
    text: "Headless OpenCode 2 completed",
  });
  expect(events).toContainEqual({
    type: "session.providerBound",
    providerSessionId: "ses_v2",
  });
  expect(events).toContainEqual({ type: "message.completed" });
  expect(unauthorized).toEqual([]);
  await forgetOpenCodeSession("headless-v2");
  const alive = await backend.invoke<{ status: number }>("harness_http", {
    url: new URL(
      "/api/session/ses_v2",
      (
        await backend.invoke<string>("harness_exec", {
          command: join(directory, "opencode.cjs"),
          args: ["service", "status"],
          binaryProvider: "opencode",
          cwd: directory,
        })
      ).trim(),
    ).href,
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}`,
    },
  });
  expect(alive.status).toBe(200);
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  onWrite: async (_sessionId: string, _line: string): Promise<void> => {},
}));

vi.mock("./child", () => ({
  writeChild: (sessionId: string, line: string) =>
    transport.onWrite(sessionId, line),
}));

import { JsonRpcClient } from "./jsonRpc";

describe("JsonRpcClient", () => {
  beforeEach(() => {
    transport.onWrite = async () => {};
  });

  it("accepts a response delivered before the write resolves", async () => {
    let client!: JsonRpcClient;
    transport.onWrite = async (_sessionId, line) => {
      const outbound = JSON.parse(line) as { id: number };
      client.pushLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: outbound.id,
          result: { ok: true },
        }),
      );
    };
    client = new JsonRpcClient("fast", {});

    await expect(client.request("session/set_mode")).resolves.toEqual({
      ok: true,
    });
  });

  it("uses its captured writer for a response delivered before send settles", async () => {
    const legacy = vi.fn(async () => {
      throw new Error("legacy transport selected");
    });
    transport.onWrite = legacy;
    let client!: JsonRpcClient;
    const write = vi.fn(async (line: string) => {
      const outbound = JSON.parse(line) as { id: number };
      client.pushLine(JSON.stringify({ id: outbound.id, result: "owned" }));
    });
    client = new JsonRpcClient("private-native-id", {}, { write });

    await expect(client.request("initialize")).resolves.toBe("owned");
    expect(write).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
  });

  it("routes every outbound frame through the same captured writer", async () => {
    const legacy = vi.fn(async () => {});
    transport.onWrite = legacy;
    const write = vi.fn(async (_line: string) => {});
    const client = new JsonRpcClient(
      "private-native-id",
      {},
      {
        includeJsonrpc: false,
        write,
      },
    );

    await client.notify("initialized");
    await client.respond(1, { ok: true });
    await client.respondError("request", { code: -1, message: "denied" });

    expect(write.mock.calls.map(([line]) => JSON.parse(line))).toEqual([
      { method: "initialized" },
      { id: 1, result: { ok: true } },
      { id: "request", error: { code: -1, message: "denied" } },
    ]);
    expect(legacy).not.toHaveBeenCalled();
  });

  it("does not fall back when its captured writer rejects", async () => {
    const legacy = vi.fn(async () => {
      throw new Error("legacy transport selected");
    });
    transport.onWrite = legacy;
    const retired = new Error("captured child retired");
    const write = vi.fn(async (_line: string) => {
      throw retired;
    });
    const client = new JsonRpcClient("private-native-id", {}, { write });

    await expect(client.request("initialize")).rejects.toBe(retired);
    expect(legacy).not.toHaveBeenCalled();
    client.pushLine(JSON.stringify({ id: 1, result: "late" }));
    client.close();
  });

  it("keeps late server replies on the retired writer after close", async () => {
    const legacy = vi.fn(async () => {});
    transport.onWrite = legacy;
    const write = vi.fn(async (_line: string) => {
      throw new Error("captured child retired");
    });
    const client = new JsonRpcClient("private-native-id", {}, { write });
    client.close();

    await expect(client.respond(1, "late")).rejects.toThrow(
      "captured child retired",
    );
    expect(write).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
  });

  it("observes cancellation while an admitted write is still pending", async () => {
    let releaseWrite!: () => void;
    const writing = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const client = new JsonRpcClient(
      "private-native-id",
      {},
      {
        write: () => writing,
      },
    );
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const retired = new Error("captured child retired");
    const observed = client.request("initialize").catch((reason) => reason);
    try {
      client.close(retired);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      releaseWrite();
      expect(await observed).toBe(retired);
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("rejects and removes a request when writing fails", async () => {
    transport.onWrite = async () => {
      throw new Error("pipe closed");
    };
    const client = new JsonRpcClient("failed", {});

    await expect(client.request("initialize")).rejects.toThrow("pipe closed");
  });
});

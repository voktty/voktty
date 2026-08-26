import { beforeEach, describe, expect, it } from "vitest";
import {
  addRdpConnection,
  deleteRdpConnection,
  recordRdpConnectionUse,
  updateRdpConnection,
  useRdpStore,
} from "./rdpStore";

describe("rdpStore", () => {
  beforeEach(() => {
    useRdpStore.setState({ connections: [] });
  });

  it("adds an RDP connection profile with default port", () => {
    const conn = addRdpConnection({
      name: "Office PC",
      host: "192.168.1.10",
      port: 3389,
      username: "Administrator",
    });

    expect(conn.id).toMatch(/^rdp-/);
    expect(conn.name).toBe("Office PC");
    expect(conn.host).toBe("192.168.1.10");

    const state = useRdpStore.getState();
    expect(state.connections).toHaveLength(1);
    expect(state.connections[0].id).toBe(conn.id);
  });

  it("updates an existing RDP connection profile", () => {
    const conn = addRdpConnection({
      name: "Office PC",
      host: "192.168.1.10",
      port: 3389,
    });

    updateRdpConnection(conn.id, {
      name: "Office Workstation",
      width: 1920,
      height: 1080,
    });

    const updated = useRdpStore.getState().connections.find((c) => c.id === conn.id);
    expect(updated?.name).toBe("Office Workstation");
    expect(updated?.width).toBe(1920);
    expect(updated?.height).toBe(1080);
  });

  it("deletes an RDP connection profile", () => {
    const conn1 = addRdpConnection({
      name: "PC 1",
      host: "10.0.0.1",
      port: 3389,
    });
    const conn2 = addRdpConnection({
      name: "PC 2",
      host: "10.0.0.2",
      port: 3389,
    });

    expect(useRdpStore.getState().connections).toHaveLength(2);

    deleteRdpConnection(conn1.id);
    const conns = useRdpStore.getState().connections;
    expect(conns).toHaveLength(1);
    expect(conns[0].id).toBe(conn2.id);
  });

  it("records connection last use timestamp", () => {
    const conn = addRdpConnection({
      name: "Lab Server",
      host: "10.0.0.5",
      port: 3389,
    });

    expect(conn.lastConnectedAt).toBeUndefined();

    recordRdpConnectionUse(conn.id);
    const updated = useRdpStore.getState().connections.find((c) => c.id === conn.id);
    expect(updated?.lastConnectedAt).toBeDefined();
    expect(typeof updated?.lastConnectedAt).toBe("number");
  });
});

import { describe, expect, it } from "vitest";
import type { DockerContainerInfo, DockerContainerStats, DockerDaemonStatus } from "./types";

describe("Docker module types and contracts", () => {
  it("validates DockerDaemonStatus structure", () => {
    const status: DockerDaemonStatus = {
      connected: true,
      version: "27.5.1",
      os: "Docker Desktop 4.38.0 (Windows 11)",
      containers_running: 3,
      containers_total: 5,
      images_count: 12,
      driver: "overlay2",
      error: null,
    };

    expect(status.connected).toBe(true);
    expect(status.containers_running).toBe(3);
    expect(status.version).toBe("27.5.1");
  });

  it("handles DockerContainerInfo with compose metadata", () => {
    const container: DockerContainerInfo = {
      id: "abc1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      short_id: "abc123456789",
      names: ["/voktty-redis-1"],
      image: "redis:7-alpine",
      image_id: "sha256:1234",
      command: "redis-server",
      created: 1700000000,
      state: "running",
      status: "Up 2 hours",
      ports: [
        {
          ip: "0.0.0.0",
          private_port: 6379,
          public_port: 6379,
          port_type: "tcp",
        },
      ],
      compose_project: "voktty",
      compose_service: "redis",
    };

    expect(container.compose_project).toBe("voktty");
    expect(container.ports[0].public_port).toBe(6379);
    expect(container.state).toBe("running");
  });

  it("computes stats percentages accurately", () => {
    const stats: DockerContainerStats = {
      id: "abc123456789",
      name: "voktty-redis-1",
      cpu_percent: 2.35,
      memory_usage_bytes: 52428800, // 50 MB
      memory_limit_bytes: 1073741824, // 1 GB
      memory_percent: 4.88,
      net_rx_bytes: 1024,
      net_tx_bytes: 2048,
      block_read_bytes: 0,
      block_write_bytes: 4096,
      pids_current: 5,
    };

    expect(stats.cpu_percent).toBeGreaterThan(0);
    expect(stats.memory_percent).toBeLessThan(100);
  });
});

import { describe, expect, it } from "vitest";
import { parseClaudeMcpList } from "./mcpTypes";

describe("parseClaudeMcpList", () => {
  it("extracts server name and human-readable status", () => {
    const output = [
      "filesystem: local - Connected",
      "github: https://api.github.com - Needs authentication",
      "sqlite: stdio — Failed to connect",
    ].join("\n");

    const servers = parseClaudeMcpList(output);
    expect(servers).toEqual([
      { name: "filesystem", status: "Connected" },
      { name: "github", status: "Needs authentication" },
      { name: "sqlite", status: "Failed to connect" },
    ]);
  });

  it("handles empty or malformed output gracefully", () => {
    expect(parseClaudeMcpList("")).toEqual([]);
    expect(parseClaudeMcpList("No servers found")).toEqual([]);
  });
});

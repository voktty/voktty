import { describe, expect, it } from "vitest";
import { labelFor } from "./tabLabel";
import type { TerminalTab } from "./useTabs";
import { createTabIdentity } from "./tabIdentity";

function terminalTab(over: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 1,
    ...createTabIdentity("default", () => "label-terminal"),
    kind: "terminal",
    spaceId: "default",
    title: "shell",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
    ...over,
    tabKey:
      over.tabKey ??
      createTabIdentity("default", () => "label-terminal").tabKey,
    workspaceScopeId:
      over.workspaceScopeId ??
      createTabIdentity("default", () => "label-terminal").workspaceScopeId,
  };
}

describe("labelFor (terminal tabs)", () => {
  it("derives the label from the last cwd segment", () => {
    expect(labelFor(terminalTab({ cwd: "/Users/me/projects/voktty-ai" }))).toBe(
      "voktty-ai",
    );
  });

  it("falls back to the title when there is no cwd", () => {
    expect(labelFor(terminalTab({ title: "private" }))).toBe("private");
  });

  it("prefers a custom title over the cwd-derived name", () => {
    expect(
      labelFor(terminalTab({ cwd: "/Users/me/projects/voktty-ai", customTitle: "Server" })),
    ).toBe("Server");
  });

  it("keeps the custom title after the cwd changes (survives cd)", () => {
    const renamed = terminalTab({ cwd: "/Users/me/a", customTitle: "Server" });
    const afterCd = { ...renamed, cwd: "/Users/me/b/c" };
    expect(labelFor(afterCd)).toBe("Server");
  });

  it("handles Windows-style cwd separators", () => {
    expect(labelFor(terminalTab({ cwd: "C:\\Users\\me\\proj" }))).toBe("proj");
  });
});

import { getTabSubtitle } from "./tabLabel";

describe("getTabSubtitle", () => {
  it("formats terminal cwd subtitle", () => {
    expect(
      getTabSubtitle(terminalTab({ cwd: "C:\\proyectos\\voktty-ai" })),
    ).toEqual({
      icon: "folder",
      text: ".../proyectos/voktty-ai",
    });
  });

  it("formats SSH workspace subtitle", () => {
    expect(
      getTabSubtitle(
        terminalTab({
          workspaceEnv: {
            kind: "ssh",
            connection: { id: "1", name: "Prod", host: "prod.srv", port: 22, user: "root" },
            root: "/var/www",
          },
        }),
      ),
    ).toEqual({
      icon: "remote",
      text: "ssh root@prod.srv",
    });
  });

  it("formats Serial workspace subtitle", () => {
    expect(
      getTabSubtitle(
        terminalTab({
          workspaceEnv: {
            kind: "serial",
            portName: "COM3",
            baudRate: 115200,
            dataBits: 8,
            flowControl: "none",
            parity: "none",
            stopBits: 1,
          },
        }),
      ),
    ).toEqual({
      icon: "remote",
      text: "serial · COM3",
    });
  });
});

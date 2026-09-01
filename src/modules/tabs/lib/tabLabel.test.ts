import { describe, expect, it } from "vitest";
import {
  extractRemoteHostLabel,
  getTabSubtitle,
  isSshOrRemoteSession,
  isSshTab,
  labelFor,
} from "./tabLabel";
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

  it("extracts remote host from SSH workspace environment", () => {
    const sshTab = terminalTab({
      cwd: "C:\\Users\\SergioRVargasHerranz",
      workspaceEnv: {
        kind: "ssh",
        connection: { id: "1", name: "hermes-server", host: "docker", port: 22, user: "root" },
        root: "/opt/docker/hermes-server",
      },
    });
    expect(labelFor(sshTab)).toBe("hermes-server");
  });

  it("extracts user@host from CLI SSH title or remote prompt", () => {
    const cliSshTab = terminalTab({
      cwd: "C:\\Users\\SergioRVargasHerranz",
      title: "root@docker: /opt/docker/hermes-server",
    });
    expect(labelFor(cliSshTab)).toBe("root@docker");
  });

  it("extracts host from ssh command title", () => {
    const sshCmdTab = terminalTab({
      cwd: "C:\\Users\\SergioRVargasHerranz",
      title: "ssh root@prod.srv",
    });
    expect(labelFor(sshCmdTab)).toBe("root@prod.srv");
  });
});

describe("isSshOrRemoteSession and extractRemoteHostLabel", () => {
  it("detects remote SSH workspace", () => {
    const tab = terminalTab({
      workspaceEnv: {
        kind: "ssh",
        connection: { id: "1", name: "docker", host: "127.0.0.1", port: 22, user: "root" },
        root: "/root",
      },
    });
    expect(isSshOrRemoteSession(tab)).toBe(true);
    expect(extractRemoteHostLabel(tab)).toBe("docker");
  });

  it("detects remote user@host prompt pattern", () => {
    const tab = terminalTab({ title: "root@docker:~" });
    expect(isSshOrRemoteSession(tab)).toBe(true);
    expect(extractRemoteHostLabel(tab)).toBe("root@docker");
  });

  it("does not detect regular local shell", () => {
    const tab = terminalTab({ title: "powershell.exe" });
    expect(isSshOrRemoteSession(tab)).toBe(false);
    expect(extractRemoteHostLabel(tab)).toBeNull();
  });
});

describe("getTabSubtitle", () => {
  it("formats terminal cwd subtitle", () => {
    expect(
      getTabSubtitle(terminalTab({ cwd: "C:\\proyectos\\voktty-ai" })),
    ).toEqual({
      icon: "folder",
      text: ".../proyectos/voktty-ai",
    });
  });

  it("formats SSH workspace subtitle with connection name and user@host", () => {
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
      text: "Prod (root@prod.srv)",
    });
  });

  it("formats unnamed SSH workspace subtitle", () => {
    expect(
      getTabSubtitle(
        terminalTab({
          workspaceEnv: {
            kind: "ssh",
            connection: { id: "1", name: "", host: "prod.srv", port: 22, user: "root" },
            root: "/var/www",
          },
        }),
      ),
    ).toEqual({
      icon: "remote",
      text: "ssh root@prod.srv",
    });
  });

  it("formats remote SSH subtitle from terminal title", () => {
    expect(
      getTabSubtitle(
        terminalTab({
          cwd: "C:\\Users\\SergioRVargasHerranz",
          title: "root@docker: /opt/docker",
        }),
      ),
    ).toEqual({
      icon: "remote",
      text: "ssh root@docker",
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

describe("isSshTab", () => {
  it("identifies terminal tabs with SSH workspaceEnv", () => {
    const tab = terminalTab({
      workspaceEnv: {
        kind: "ssh",
        connection: { id: "c1", name: "test", host: "192.168.1.4", user: "abc" },
        root: "/home/abc",
      },
    });
    expect(isSshTab(tab)).toBe(true);
  });

  it("identifies terminal tabs inside an active SSH workspace", () => {
    const tab = terminalTab();
    expect(
      isSshTab(tab, {
        kind: "ssh",
        connection: { id: "c1", name: "test", host: "192.168.1.4", user: "abc" },
        root: "/home/abc",
      }),
    ).toBe(true);
  });

  it("identifies terminal tabs running ssh command from title", () => {
    const tab = terminalTab({ title: "ssh root@server" });
    expect(isSshTab(tab)).toBe(true);
  });

  it("returns false for local non-ssh terminal tabs", () => {
    const tab = terminalTab({ title: "powershell" });
    expect(isSshTab(tab)).toBe(false);
  });
});

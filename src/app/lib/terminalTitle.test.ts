import { describe, expect, it } from "vitest";
import { planTerminalTitle } from "./terminalTitle";

const base = {
  currentTitle: "proyectos",
  incomingTitle: "proyectos",
  agentActive: false,
  agentLabel: null,
};

describe("planTerminalTitle", () => {
  it("adopts a new shell title", () => {
    expect(planTerminalTitle({ ...base, incomingTitle: "src" })).toEqual({
      kind: "rename",
      title: "src",
    });
  });

  it("does nothing when the title is unchanged", () => {
    expect(planTerminalTitle(base)).toEqual({ kind: "keep" });
  });

  it("lets a user rename win over everything", () => {
    expect(
      planTerminalTitle({
        ...base,
        customTitle: "build box",
        incomingTitle: "src",
        agentLabel: "Claude",
      }),
    ).toEqual({ kind: "keep" });
  });

  it("labels the tab when the shell reports an agent as the foreground process", () => {
    expect(
      planTerminalTitle({
        ...base,
        incomingTitle: "claude",
        agentLabel: "Claude",
      }),
    ).toEqual({ kind: "rename", title: "Claude" });
  });

  it("holds the label while the agent owns the terminal", () => {
    // A cd or a prompt repaint arriving mid-session must not rename the tab.
    expect(
      planTerminalTitle({
        ...base,
        currentTitle: "Claude",
        incomingTitle: "another-folder",
        agentActive: true,
      }),
    ).toEqual({ kind: "keep" });
  });

  it("follows the shell again once the agent has exited", () => {
    // The regression: the label used to be permanent, so the tab kept the
    // agent name and its icon on a directory where it was never run.
    expect(
      planTerminalTitle({
        ...base,
        currentTitle: "Claude",
        incomingTitle: "another-folder",
        agentActive: false,
      }),
    ).toEqual({ kind: "rename", title: "another-folder" });
  });

  it("does not resurrect the label from the previous title alone", () => {
    expect(
      planTerminalTitle({
        ...base,
        currentTitle: "Claude",
        incomingTitle: "powershell",
      }),
    ).toEqual({ kind: "rename", title: "powershell" });
  });

  it("treats an empty custom title as absent", () => {
    expect(
      planTerminalTitle({ ...base, customTitle: "", incomingTitle: "src" }),
    ).toEqual({ kind: "rename", title: "src" });
  });
});

// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamBoard } from "./TeamBoard";
import * as teamFs from "../lib/teamFs";
import * as teamHosts from "../lib/teamHosts";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { AgentRoster } from "@/modules/workspace-kit/lib/configTypes";

vi.mock("@/modules/i18n", () => {
  const t = (key: string, params?: Record<string, unknown>) => {
    if (params?.model) return `${key}: ${params.model}`;
    if (params?.name) return `${key}: ${params.name}`;
    return key;
  };
  return {
    t,
    useTranslation: () => ({ t }),
  };
});

vi.mock("../lib/rosterEditor", () => ({
  deleteAgent: vi.fn().mockResolvedValue({ ok: true }),
}));

describe("TeamBoard", () => {
  let root: ReturnType<typeof createRoot>;
  let node: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    node = document.createElement("div");
    root = createRoot(node);
    usePreferencesStore.setState({ sshConnections: [] });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it("displays hostUnconfigured badge and link host button for unconfigured SSH host", async () => {
    const roster: AgentRoster = {
      version: 1,
      agents: [
        {
          name: "remote-worker",
          role: "roles/worker.md",
          start: "on-demand",
          host: "ssh:gpu-cluster",
          runtime: { adapter: "claude-code", model: "claude-3-7-sonnet" },
        },
      ],
    };

    vi.spyOn(teamFs, "readRoster").mockResolvedValue({ roster });
    vi.spyOn(teamFs, "readTeamState").mockResolvedValue({
      $schema: "urn:voktty:team-state:1",
      version: 1,
      updatedAt: new Date().toISOString(),
      agents: {},
    });
    vi.spyOn(teamFs, "readGenericApprovals").mockResolvedValue({});
    vi.spyOn(teamHosts, "readTeamHosts").mockResolvedValue({
      $schema: "urn:voktty:team-hosts:1",
      version: 1,
      updatedAt: new Date().toISOString(),
      hosts: {},
    });

    await act(async () => {
      root.render(<TeamBoard projectPath="/repo" />);
    });

    // Verify card rendered
    expect(node.textContent).toContain("remote-worker");
    // Verify hostUnconfigured badge
    expect(node.textContent).toContain("teams.hostUnconfigured");
    // Verify link button
    expect(node.textContent).toContain("teams.linkHost");
  });

  it("links host to an available SSH connection", async () => {
    const roster: AgentRoster = {
      version: 1,
      agents: [
        {
          name: "remote-worker",
          role: "roles/worker.md",
          start: "on-demand",
          host: "ssh:prod",
          runtime: { adapter: "claude-code", model: "claude-3-7-sonnet" },
        },
      ],
    };

    usePreferencesStore.setState({
      sshConnections: [
        {
          id: "conn-prod-1",
          name: "Production Server",
          host: "prod.example.com",
          port: 22,
          user: "admin",
        },
      ],
    });

    vi.spyOn(teamFs, "readRoster").mockResolvedValue({ roster });
    vi.spyOn(teamFs, "readTeamState").mockResolvedValue({
      $schema: "urn:voktty:team-state:1",
      version: 1,
      updatedAt: new Date().toISOString(),
      agents: {},
    });
    vi.spyOn(teamFs, "readGenericApprovals").mockResolvedValue({});
    vi.spyOn(teamHosts, "readTeamHosts").mockResolvedValue({
      $schema: "urn:voktty:team-hosts:1",
      version: 1,
      updatedAt: new Date().toISOString(),
      hosts: {},
    });
    const saveSpy = vi.spyOn(teamHosts, "saveTeamHostMapping").mockResolvedValue(undefined);

    await act(async () => {
      root.render(<TeamBoard projectPath="/repo" />);
    });

    expect(node.textContent).toContain("remote-worker");

    // Click link host button
    const buttons = Array.from(node.querySelectorAll("button"));
    const linkBtn = buttons.find((b) => b.textContent?.includes("teams.linkHost"));
    expect(linkBtn).toBeDefined();

    await act(async () => {
      linkBtn?.click();
    });

    // Find the select dropdown
    const select = document.querySelector("select");
    expect(select).toBeDefined();

    await act(async () => {
      if (select) {
        select.value = "conn-prod-1";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    // Click save mapping button
    const dialogButtons = Array.from(document.querySelectorAll("button"));
    const saveBtn = dialogButtons.find((b) => b.textContent?.includes("teams.saveMapping"));
    expect(saveBtn).toBeDefined();

    await act(async () => {
      saveBtn?.click();
    });

    expect(saveSpy).toHaveBeenCalledWith("/repo", "prod", "conn-prod-1", undefined);
  });
});

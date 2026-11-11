// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { registerLiveAgent, removeLiveAgent, useTeamSession } from "./agentRegistry";

afterEach(() => {
  removeLiveAgent("s_orch");
  vi.unstubAllGlobals();
});

function Probe({ sessionId }: { sessionId: string }) {
  const badge = useTeamSession(sessionId);
  return <span>{badge ? JSON.stringify(badge) : "none"}</span>;
}

it("follows a team session registering and leaving, without its token", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  const root = createRoot(node);
  await act(async () => root.render(<Probe sessionId="s_orch" />));
  expect(node.textContent).toBe("none");

  await act(async () =>
    registerLiveAgent({
      sessionId: "s_orch",
      agentName: "orchestrator",
      projectPath: "C:/proyectos/facturas",
      role: "roles/orchestrator.md",
      isOrchestrator: true,
      permissions: { canManageAgents: true },
      launchedAt: "2026-11-11T20:00:00.000Z",
      agentToken: "secret-token",
    }),
  );
  expect(JSON.parse(node.textContent ?? "")).toEqual({
    agentName: "orchestrator",
    isOrchestrator: true,
    projectPath: "C:/proyectos/facturas",
  });
  expect(node.textContent).not.toContain("secret-token");

  await act(async () => removeLiveAgent("s_orch"));
  expect(node.textContent).toBe("none");
  await act(async () => root.unmount());
});

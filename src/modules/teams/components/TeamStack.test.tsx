// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgentAttention } from "@/modules/agent-feed/lib/attentionStore";
import { TeamStack } from "./TeamStack";

vi.mock("./TeamBoard", () => ({
  TeamBoard: ({ projectPath }: { projectPath: string }) => (
    <div data-testid="board">{`board ${projectPath}`}</div>
  ),
}));
vi.mock("@/modules/agent-feed/components/AgentFeedPanel", () => ({
  default: ({ projectPath, active }: { projectPath: string; active: boolean }) => (
    <div data-testid="log">{`log ${projectPath} ${active ? "active" : "idle"}`}</div>
  ),
}));

const PROJECT = "remote://voktty-ssh-mini/srv/webserver";
const tab = {
  id: 7,
  kind: "team",
  title: "Team",
  projectPath: PROJECT,
  spaceId: "main",
} as never;

let node: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAgentAttention.setState({
    bySource: {},
    agents: {
      "ssh:mini": [
        { sessionId: "o", name: "orquestador", status: "busy", cwd: "/srv/webserver", tmux: "forgenex:@1.%1" },
        { sessionId: "n", name: "nodo", status: "idle", cwd: "/srv/webserver-nodo-273", tmux: null },
        { sessionId: "x", name: "otro", status: "busy", cwd: "/srv/otro", tmux: null },
      ],
    },
    origins: {},
    seen: {},
    viewing: null,
    requestedView: null,
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

async function render(activeId = 7) {
  await act(async () => {
    root.render(<TeamStack tabs={[tab]} activeId={activeId} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function tabButton(name: string) {
  return [...node.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (button) => button.textContent === name,
  );
}

it("shows the board with the project's external agents and switches to the log", async () => {
  await render();
  expect(node.textContent).toContain(`board ${PROJECT}`);
  // Agents in the project and its sibling worktrees; not other projects.
  expect(node.textContent).toContain("orquestador");
  expect(node.textContent).toContain("nodo");
  expect(node.textContent).not.toContain("otro");
  expect(node.querySelector('[data-testid="log"]')).toBeNull();

  await act(async () => tabButton("Communications")?.click());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(node.textContent).toContain(`log ${PROJECT} active`);
});

it("opens on the view the status bar asked for, once", async () => {
  useAgentAttention.getState().requestView("communications");
  await render();
  expect(tabButton("Communications")?.getAttribute("aria-selected")).toBe("true");
  expect(useAgentAttention.getState().requestedView).toBeNull();
});

it("keeps a hidden team tab from taking the request", async () => {
  useAgentAttention.getState().requestView("communications");
  await render(99);
  expect(tabButton("Board")?.getAttribute("aria-selected")).toBe("true");
  expect(useAgentAttention.getState().requestedView).toBe("communications");
});

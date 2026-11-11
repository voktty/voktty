// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useAgentAttention } from "../lib/attentionStore";
import AgentFeedButton from "./AgentFeedButton";

it("counts unseen waiting agents and opens the log on their host", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const origin = { key: "ssh:mini", env: { kind: "local" as const }, tabId: 3, leafId: 30 };
  useAgentAttention.setState({
    bySource: {
      "ssh:mini": [
        { key: "ssh:mini:o", sourceKey: "ssh:mini", recordId: "r1", agent: "orquestador", host: "miniserver", text: "?", ts: "", cwd: null },
      ],
    },
    agents: {},
    origins: { "ssh:mini": origin },
    seen: {},
    viewing: null,
    requestedView: null,
  });
  const onOpen = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(AgentFeedButton, { onOpen })));
  const button = host.querySelector("button");
  expect(button?.getAttribute("aria-label")).toBe("Team: 1 waiting for you");
  expect(button?.textContent).toBe("1");
  await act(async () => button?.click());
  expect(onOpen).toHaveBeenCalledWith(origin, expect.objectContaining({ recordId: "r1" }));

  await act(async () => useAgentAttention.getState().markSeen("ssh:mini"));
  expect(button?.getAttribute("aria-label")).toBe("Team");
  await act(async () => button?.click());
  expect(onOpen).toHaveBeenLastCalledWith(null, null);
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

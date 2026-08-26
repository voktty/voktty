import { usePreferencesStore } from "@/modules/settings/preferences";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { AnimatedAgentIcon } from "./AnimatedAgentIcon";

describe("AnimatedAgentIcon", () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      agentAvatarEnabled: true,
      agentAvatarAnimationIntensity: "standard",
      agentAvatarReducedMotion: false,
    });
  });

  it("keeps the external brand icon and adds a local animated face", () => {
    const claude = renderToStaticMarkup(
      <AnimatedAgentIcon agent="claude" presence="tool-running" />,
    );
    const codex = renderToStaticMarkup(
      <AnimatedAgentIcon agent="codex" presence="tool-running" />,
    );

    expect(claude).toContain('data-agent="claude"');
    expect(claude).toContain('data-state="tool-running"');
    expect(claude).toContain("voktty-agent-tab-icon");
    expect(claude).toContain("voktty-agent-tab-face");
    expect(claude).not.toContain("voktty-avatar-body");
    expect(claude).not.toEqual(codex);
  });

  it.each([
    ["idle", "M5 8c2 1 4 1 6 0"],
    ["thinking", "M5 8h6"],
    ["awaiting-approval", "M5 9h6"],
    ["success", "M4 7c2 3 6 3 8 0"],
    ["error", "M4 9c2-2 6-2 8 0"],
  ] as const)("renders a distinct face for %s", (state, mouth) => {
    const markup = renderToStaticMarkup(
      <AnimatedAgentIcon agent="kimi" presence={state} />,
    );

    expect(markup).toContain(`data-state="${state}"`);
    expect(markup).toContain(mouth);
  });

  it("keeps the original icon when avatar animation is disabled", () => {
    const markup = renderToStaticMarkup(
      <AnimatedAgentIcon
        agent="codex"
        presence="tool-running"
        enabled={false}
      />,
    );

    expect(markup).toContain('data-agent="codex"');
    expect(markup).toContain('class="shrink-0"');
    expect(markup).not.toContain("voktty-agent-tab-icon");
    expect(markup).not.toContain("voktty-agent-tab-face");
  });

  it("keeps the brand identity while exposing reduced motion", () => {
    const markup = renderToStaticMarkup(
      <AnimatedAgentIcon
        agent="claude"
        presence="tool-running"
        decorative={false}
        label="Claude Code"
        reducedMotion
      />,
    );

    expect(markup).toContain('data-motion="reduced"');
    expect(markup).toContain('aria-label="Claude Code"');
    expect(markup).toContain("voktty-agent-tab-face");
  });

  it("exposes active and idle states for activity-scoped animation", () => {
    const working = renderToStaticMarkup(
      <AnimatedAgentIcon agent="codex" presence="tool-running" />,
    );
    const idle = renderToStaticMarkup(
      <AnimatedAgentIcon agent="codex" presence="idle" />,
    );

    expect(working).toContain('data-state="tool-running"');
    expect(idle).toContain('data-state="idle"');
  });
});

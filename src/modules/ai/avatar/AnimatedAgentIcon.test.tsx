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
    ["idle", "M8 14c1.5 2 6.5 2 8 0"],
    ["thinking", "M9 14.5h6"],
    ["awaiting-approval", "M9 15h6"],
    ["success", "M7.5 13.5c1.5 3 7.5 3 9 0"],
    ["error", "M7.5 16c1.5-2.5 7.5-2.5 9 0"],
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

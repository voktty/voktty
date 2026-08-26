import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { AgentAvatar } from "./AgentAvatar";

const PROFILE_IDS = [
  "coder",
  "architect",
  "reviewer",
  "security",
  "designer",
] as const;

describe("AgentAvatar", () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      agentAvatarEnabled: true,
      agentAvatarSize: "standard",
      agentAvatarAnimationIntensity: "standard",
      agentAvatarReducedMotion: false,
    });
  });

  it("renders a distinct local SVG for every built-in profile", () => {
    const markups = PROFILE_IDS.map((profile) =>
      renderToStaticMarkup(
        <AgentAvatar profile={profile} presence="thinking" decorative />,
      ),
    );

    expect(new Set(markups).size).toBe(PROFILE_IDS.length);
    for (const markup of markups) {
      expect(markup).toContain("<svg");
      expect(markup).toContain('data-state="thinking"');
      expect(markup).not.toContain("http://");
      expect(markup).not.toContain("https://");
    }
  });

  it("projects operational state into the rendered surface", () => {
    const markup = renderToStaticMarkup(
      <AgentAvatar profile="coder" presence="awaiting-approval" decorative />,
    );

    expect(markup).toContain('data-state="awaiting-approval"');
    expect(markup).toContain("M24 11v7M24 31v1");
  });

  it("returns the existing surface fallback when disabled", () => {
    const markup = renderToStaticMarkup(
      <AgentAvatar
        profile="coder"
        fallback={<span data-avatar-fallback="true" />}
        decorative
        enabled={false}
      />,
    );

    expect(markup).toContain('data-avatar-fallback="true"');
    expect(markup).not.toContain("<svg");
  });

  it("exposes an accessible label for non-decorative avatars", () => {
    const markup = renderToStaticMarkup(
      <AgentAvatar profile="coder" presence="thinking" label="Coder agent" />,
    );

    expect(markup).toContain('data-intensity="0.65"');
    expect(markup).toContain('data-motion="full"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Coder agent"');
    expect(markup).toContain('width="18"');
  });
});

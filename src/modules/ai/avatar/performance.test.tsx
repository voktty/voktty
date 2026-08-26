import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { AgentAvatar } from "./AgentAvatar";

const ITERATIONS = 120;

type SurfaceSample = {
  surface: "chat-sidebar" | "chat-mini" | "status-closed";
  averageRenderMs: number;
  heapDeltaBytes: number;
  markupBytes: number;
};

function measureSurface(
  surface: SurfaceSample["surface"],
  size: "xs" | "sm" | "md",
): SurfaceSample {
  const beforeHeap = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  let markup = "";

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    markup = renderToStaticMarkup(
      <AgentAvatar
        profile="coder"
        presence="thinking"
        size={size}
        decorative
      />,
    );
  }

  const elapsedMs = performance.now() - startedAt;
  const afterHeap = process.memoryUsage().heapUsed;

  return {
    surface,
    averageRenderMs: elapsedMs / ITERATIONS,
    heapDeltaBytes: Math.max(0, afterHeap - beforeHeap),
    markupBytes: Buffer.byteLength(markup, "utf8"),
  };
}

describe("AgentAvatar performance envelope", () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      agentAvatarEnabled: true,
      agentAvatarSize: "standard",
      agentAvatarAnimationIntensity: "standard",
      agentAvatarReducedMotion: false,
    });
  });

  it("keeps the local SVG bounded across chat and closed-state surfaces", () => {
    const samples = [
      measureSurface("chat-sidebar", "md"),
      measureSurface("chat-mini", "sm"),
      measureSurface("status-closed", "xs"),
    ];

    expect(samples.every((sample) => sample.markupBytes < 9000)).toBe(true);
    expect(samples.every((sample) => sample.averageRenderMs < 5)).toBe(true);
    expect(
      samples.every((sample) => sample.heapDeltaBytes < 96 * 1024 * 1024),
    ).toBe(true);
    expect(
      samples.every((sample) => !sample.markupBytes || sample.markupBytes > 0),
    ).toBe(true);

    console.info("[avatar-performance]", JSON.stringify(samples));
  });
});

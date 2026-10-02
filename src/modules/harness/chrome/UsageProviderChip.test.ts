// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderRateLimits } from "../lib/rateLimits";
import { saveShowRemainingUsage } from "../lib/displayPrefs";
import { needsProviderLogin, UsageProviderChip } from "./UsageProviderChip";

describe("UsageProviderChip", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    saveShowRemainingUsage(false);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    vi.unstubAllGlobals();
    saveShowRemainingUsage(false);
  });

  it("identifies login failure when status is error and error mentions sign-in or login", () => {
    const limits: ProviderRateLimits = {
      provider: "claude",
      session: null,
      weekly: null,
      monthly: null,
      resetCredits: null,
      updatedAt: Date.now(),
      error: "Claude sign-in expired",
      status: "error",
    };
    expect(needsProviderLogin(limits)).toBe(true);
  });

  it("does not describe account-specific usage restrictions as login failures", () => {
    const limits: ProviderRateLimits = {
      provider: "claude",
      session: null,
      weekly: null,
      monthly: null,
      resetCredits: null,
      updatedAt: Date.now(),
      error: "Claude usage is unavailable for this account",
      status: "error",
    };
    expect(needsProviderLogin(limits)).toBe(false);
  });

  it("returns false when rate limits are ok", () => {
    const limits: ProviderRateLimits = {
      provider: "codex",
      session: {
        usedPercent: 42,
        windowMinutes: 300,
        resetsAt: Date.now() + 45 * 60_000,
      },
      weekly: null,
      monthly: null,
      resetCredits: null,
      updatedAt: Date.now(),
      error: null,
      status: "ok",
    };
    expect(needsProviderLogin(limits)).toBe(false);
  });

  it("renders used capacity in mini bar by default", async () => {
    const limits: ProviderRateLimits = {
      provider: "codex",
      session: {
        usedPercent: 42,
        windowMinutes: 300,
        resetsAt: Date.now() + 45 * 60_000,
      },
      weekly: null,
      monthly: null,
      resetCredits: null,
      updatedAt: Date.now(),
      error: null,
      status: "ok",
    };
    await act(async () => {
      root.render(
        React.createElement(UsageProviderChip, {
          limits,
          now: Date.now(),
        }),
      );
    });
    const bar = container.querySelector(".w-8 > span");
    expect(bar?.getAttribute("style")).toBe("width: 42%;");
  });

  it("renders remaining usage in mini bar when option is enabled", async () => {
    saveShowRemainingUsage(true);
    const limits: ProviderRateLimits = {
      provider: "codex",
      session: {
        usedPercent: 42,
        windowMinutes: 300,
        resetsAt: Date.now() + 45 * 60_000,
      },
      weekly: null,
      monthly: null,
      resetCredits: null,
      updatedAt: Date.now(),
      error: null,
      status: "ok",
    };
    await act(async () => {
      root.render(
        React.createElement(UsageProviderChip, {
          limits,
          now: Date.now(),
        }),
      );
    });
    const bar = container.querySelector(".w-8 > span");
    expect(bar?.getAttribute("style")).toBe("width: 58%;");
  });
});

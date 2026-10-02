import { describe, expect, it } from "vitest";
import {
  SETTINGS_INDEX,
  SETTINGS_SECTIONS,
  searchSettings,
  settingDomId,
} from "../lib/settings";
import { PROVIDER_ACCOUNT_PROVIDERS } from "../lib/providerAccounts";

describe("settings structure", () => {
  it("gives every section a rail group", () => {
    const groups = new Set(SETTINGS_SECTIONS.map((section) => section.group));
    expect([...groups]).toEqual(["app", "agents", "workspace"]);
  });

  it("indexes each setting once", () => {
    const ids = SETTINGS_INDEX.map((entry) => entry.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it("indexes provider-accounts setting under providers section", () => {
    const entry = SETTINGS_INDEX.find((item) => item.id === "provider-accounts");
    expect(entry).toBeDefined();
    expect(entry?.section).toBe("providers");
    expect(settingDomId("provider-accounts")).toBe("setting-provider-accounts");
  });

  it("indexes show-remaining-usage and mask-emails under providers section", () => {
    const remaining = SETTINGS_INDEX.find((item) => item.id === "show-remaining-usage");
    expect(remaining).toBeDefined();
    expect(remaining?.section).toBe("providers");
    expect(settingDomId("show-remaining-usage")).toBe("setting-show-remaining-usage");

    const mask = SETTINGS_INDEX.find((item) => item.id === "mask-emails");
    expect(mask).toBeDefined();
    expect(mask?.section).toBe("providers");
    expect(settingDomId("mask-emails")).toBe("setting-mask-emails");
  });

  it("finds provider accounts via settings search", () => {
    const results = searchSettings("account");
    expect(results.some((r) => r.id === "provider-accounts")).toBe(true);
  });

  it("finds display preferences via settings search", () => {
    const remaining = searchSettings("remaining");
    expect(remaining.some((r) => r.id === "show-remaining-usage")).toBe(true);

    const mask = searchSettings("mask");
    expect(mask.some((r) => r.id === "mask-emails")).toBe(true);
  });

  it("supports provider account providers", () => {
    expect(PROVIDER_ACCOUNT_PROVIDERS).toEqual(["claude", "codex"]);
  });
});

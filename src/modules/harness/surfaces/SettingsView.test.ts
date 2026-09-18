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

  it("finds provider accounts via settings search", () => {
    const results = searchSettings("account");
    expect(results.some((r) => r.id === "provider-accounts")).toBe(true);
  });

  it("supports provider account providers", () => {
    expect(PROVIDER_ACCOUNT_PROVIDERS).toEqual(["claude", "codex"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  SETTINGS_INDEX,
  SETTINGS_SECTIONS,
  searchSettings,
} from "../lib/settings";
import { PROVIDER_ACCOUNT_PROVIDERS } from "../lib/providerAccounts";

describe("settings structure", () => {
  it("gives every section a rail group", () => {
    const groups = new Set(SETTINGS_SECTIONS.map((section) => section.group));
    expect([...groups]).toEqual(["app", "agents", "workspace"]);
  });

  it("exposes native SSH connections in Harness workspace settings", () => {
    const section = SETTINGS_SECTIONS.find((item) => item.id === "connections");
    expect(section?.group).toBe("workspace");
    expect(searchSettings("ssh").some((result) => result.section === "connections")).toBe(true);
  });

  it("indexes each setting once", () => {
    const ids = SETTINGS_INDEX.map((entry) => entry.id);
    expect(ids).toEqual([...new Set(ids)]);
  });

  it("keeps moved provider controls searchable through the providers section", () => {
    const results = searchSettings("account");
    expect(results.some((r) => r.id === "providers")).toBe(true);
    expect(results.some((r) => r.id === "provider-accounts")).toBe(false);
    expect(results.some((r) => r.id === "show-remaining-usage")).toBe(false);
    expect(results.some((r) => r.id === "mask-emails")).toBe(false);
  });

  it("supports provider account providers", () => {
    expect(PROVIDER_ACCOUNT_PROVIDERS).toEqual(["claude", "codex"]);
  });
});

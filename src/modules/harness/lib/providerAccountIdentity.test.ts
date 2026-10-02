import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  identityKey,
  identityOrganizationTag,
  identitySubtitle,
} from "./providerAccountIdentity";
import { PrivateEmail } from "../chrome/PrivateEmail";
import { ProviderAccountSubtitle } from "../chrome/ProviderAccountSubtitle";

describe("providerAccountIdentity", () => {
  it("computes identitySubtitle correctly", () => {
    expect(
      identitySubtitle({
        plan: "Max",
        email: "user@example.com",
      }),
    ).toBe("Max · user@example.com");

    expect(identitySubtitle({ plan: "Pro" })).toBe("Pro");
    expect(identitySubtitle({ email: "user@example.com" })).toBe(
      "user@example.com",
    );
    expect(identitySubtitle(null)).toBeNull();
  });

  it("extracts identityOrganizationTag correctly", () => {
    expect(
      identityOrganizationTag({
        organization: "Acme Corp",
      }),
    ).toBe("Acme Corp");

    expect(
      identityOrganizationTag({
        organization: "Ada's Organization",
      }),
    ).toBe("Personal");

    expect(
      identityOrganizationTag({
        organization: "Bob’s Organization",
      }),
    ).toBe("Personal");

    expect(identityOrganizationTag(null)).toBeNull();
  });

  it("builds identityKey", () => {
    expect(
      identityKey({
        id: "work-1",
        provider: "claude",
        label: "Work",
      }),
    ).toBe("claude:work-1");
  });

  it("renders PrivateEmail with plain text by default", () => {
    const html = renderToStaticMarkup(
      React.createElement(PrivateEmail, { email: "secret@company.com" }),
    );
    expect(html).toContain("secret@company.com");
    expect(html).not.toContain("blur-[5px]");
  });

  it("renders ProviderAccountSubtitle with plan and private email", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProviderAccountSubtitle, {
        identity: { plan: "Team", email: "team@company.com" },
      }),
    );
    expect(html).toContain("Team");
    expect(html).toContain("·");
    expect(html).toContain("team@company.com");
  });

  it("renders ProviderAccountSubtitle fallback when identity is empty", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProviderAccountSubtitle, {
        identity: null,
        fallback: "Provider CLI profile",
      }),
    );
    expect(html).toContain("Provider CLI profile");
  });
});

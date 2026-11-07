import { describe, expect, it } from "vitest";
import type { SshConnection } from "@/modules/ssh/types";
import {
  localDirectoryExists,
  remoteAvailabilityPlan,
} from "./projectAvailability";

function profile(extra: Partial<SshConnection> = {}): SshConnection {
  return { id: "prod", name: "Prod", host: "Example.Test", port: 2200, ...extra };
}

const path = "remote://voktty-ssh-prod/home/app";

describe("remoteAvailabilityPlan", () => {
  it("probes the saved profile host and port", () => {
    expect(remoteAvailabilityPlan(path, [profile()])).toEqual({
      kind: "host",
      key: "example.test:2200",
      host: "Example.Test",
      port: 2200,
    });
  });

  it("defaults to port 22", () => {
    expect(
      remoteAvailabilityPlan(path, [profile({ port: undefined })]),
    ).toMatchObject({ kind: "host", key: "example.test:22" });
  });

  it("reports a deleted profile", () => {
    expect(remoteAvailabilityPlan(path, [])).toEqual({ kind: "profile-missing" });
  });

  it("does not judge a route behind a proxy or jump host", () => {
    expect(
      remoteAvailabilityPlan(path, [
        profile({ proxy: { enabled: true, proxyType: "socks5", host: "p", port: 1 } }),
      ]),
    ).toEqual({ kind: "skip" });
    expect(
      remoteAvailabilityPlan(path, [profile({ extraArgs: "-J bastion" })]),
    ).toEqual({ kind: "skip" });
  });

  it("does not judge other remote machines or local paths", () => {
    expect(remoteAvailabilityPlan("remote://machine-1/srv", [])).toEqual({
      kind: "skip",
    });
    expect(remoteAvailabilityPlan("/home/me/app", [profile()])).toEqual({
      kind: "skip",
    });
  });
});

describe("localDirectoryExists", () => {
  it("accepts only directories", () => {
    expect(localDirectoryExists([{ isDir: true }])).toBe(true);
    expect(localDirectoryExists([{ isDir: false }])).toBe(false);
    expect(localDirectoryExists([])).toBe(false);
    expect(localDirectoryExists(undefined)).toBe(false);
  });
});

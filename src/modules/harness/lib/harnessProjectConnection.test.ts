import { describe, expect, it } from "vitest";
import type { HarnessRemoteEnv } from "@/modules/harness/lib/harnessEnvStore";
import {
  harnessProjectConnectionMatches,
  harnessSshConnectionsMatch,
} from "@/modules/harness/lib/harnessProjectConnection";
import type { SshConnection } from "@/modules/ssh/types";

const profile: SshConnection = {
  id: "profile-1",
  name: "Build host",
  host: "build.example",
  user: "dev",
  port: 2222,
  identityFile: "/keys/build",
  extraArgs: "-o ProxyJump=bastion",
  initialDirectory: "/srv/app",
};

function environment(
  connection: SshConnection = profile,
  root = "/srv/app",
): HarnessRemoteEnv {
  return { kind: "ssh", connection, root, sessionId: 71 };
}

describe("Harness project connection guard", () => {
  it("accepts only the exact saved profile, validated configuration and root", () => {
    expect(
      harnessProjectConnectionMatches(environment(), profile, "/srv/app"),
    ).toBe(true);
  });

  it("does not adopt another profile with the same host and name", () => {
    expect(
      harnessProjectConnectionMatches(
        environment({ ...profile, id: "profile-2" }),
        profile,
        "/srv/app",
      ),
    ).toBe(false);
  });

  it.each(["/srv/other", "/srv", "/srv/app/child", "/SRV/app"])(
    "does not adopt a different root %s of the same profile",
    (root) => {
      expect(
        harnessProjectConnectionMatches(environment(), profile, root),
      ).toBe(false);
    },
  );

  it.each([
    ["/srv/app/", "/srv/app"],
    ["C:\\work\\app", "C:/work/app/"],
    ["\\\\server\\share\\app", "//server/share/app/"],
  ])(
    "compares canonical separators and trailing slashes for %s",
    (actual, root) => {
      expect(
        harnessProjectConnectionMatches(
          environment(profile, actual),
          profile,
          root,
        ),
      ).toBe(true);
    },
  );

  it.each([
    { host: "other.example" },
    { user: "other-user" },
    { port: 22 },
    { identityFile: "/keys/other" },
    { extraArgs: "-o ProxyJump=other" },
    { initialDirectory: "/srv/other" },
  ])(
    "rejects changed saved configuration %j under the same profile id",
    (change) => {
      expect(
        harnessProjectConnectionMatches(
          environment(),
          { ...profile, ...change },
          "/srv/app",
        ),
      ).toBe(false);
      expect(
        harnessSshConnectionsMatch(profile, { ...profile, ...change }),
      ).toBe(false);
    },
  );

  it("ignores display names and normalizes optional SSH configuration", () => {
    const original = { ...profile, port: undefined, extraArgs: undefined };
    const equivalent = {
      ...original,
      name: "Renamed host",
      host: " build.example ",
      user: " dev ",
      port: 22,
      identityFile: " /keys/build ",
      extraArgs: " ",
      initialDirectory: " /srv/app ",
    };
    expect(harnessSshConnectionsMatch(original, equivalent)).toBe(true);
    expect(
      harnessProjectConnectionMatches(
        environment(original),
        equivalent,
        "/srv/app",
      ),
    ).toBe(true);
  });

  it("rejects local and sessionless environments", () => {
    expect(
      harnessProjectConnectionMatches({ kind: "local" }, profile, "/srv/app"),
    ).toBe(false);
    expect(
      harnessProjectConnectionMatches(
        {
          kind: "ssh",
          connection: profile,
          root: "/srv/app",
        },
        profile,
        "/srv/app",
      ),
    ).toBe(false);
  });

  it.each([
    { ...profile, host: " " },
    { ...profile, host: null } as unknown as SshConnection,
    { ...profile, user: 42 } as unknown as SshConnection,
    { ...profile, id: " " },
  ])("does not throw for invalid saved configuration", (invalid) => {
    expect(() =>
      harnessProjectConnectionMatches(environment(), invalid, "/srv/app"),
    ).not.toThrow();
    expect(
      harnessProjectConnectionMatches(environment(), invalid, "/srv/app"),
    ).toBe(false);
  });
});

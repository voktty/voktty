import { describe, expect, it } from "vitest";
import type { RemoteMachine } from "./protocol";
import {
  findSshProfile,
  remoteSshConnectionFor,
  remoteSshConnectionForProfile,
  remoteSshConnectionIdForEnvironment,
  remoteSshEnvironmentId,
} from "./remoteSshProfiles";
import type { SshConnection } from "@/modules/ssh/types";

const profile: SshConnection = {
  id: "profile-1",
  name: "Build host",
  host: "build-host",
  user: "dev",
  port: 2222,
  identityFile: "/keys/build",
  extraArgs: "-o ProxyJump=bastion",
  initialDirectory: "/srv/projects",
};

const machine: RemoteMachine = {
  id: "machine-1",
  name: "Build host",
  endpoint: "ssh://dev@build-host",
  environmentId: "env-1",
  ssh: { target: "dev@build-host", port: 2222, remotePort: 3774 },
};

describe("native SSH profile projects", () => {
  it("round trips a saved connection id through the remote environment id", () => {
    const environmentId = remoteSshEnvironmentId("profile/with#reserved chars");
    expect(remoteSshConnectionIdForEnvironment(environmentId)).toBe(
      "profile/with#reserved chars",
    );
    expect(remoteSshConnectionIdForEnvironment("legacy-machine-id")).toBe(
      undefined,
    );
    expect(
      remoteSshConnectionIdForEnvironment("voktty-ssh-%E0%A4%A"),
    ).toBeUndefined();
    expect(() => remoteSshEnvironmentId(" profile-1")).toThrow("invalid id");
  });

  it("passes only the SSH fields accepted by the native helper", () => {
    expect(remoteSshConnectionForProfile(profile)).toEqual({
      host: "build-host",
      user: "dev",
      port: 2222,
      identityFile: "/keys/build",
      extraArgs: "-o ProxyJump=bastion",
      initialDirectory: "/srv/projects",
    });
  });

  it("converts legacy Host machine SSH details into a native connection", () => {
    expect(remoteSshConnectionFor(machine, [profile])).toEqual(
      remoteSshConnectionForProfile(profile),
    );
  });
});

describe("findSshProfile", () => {
  const other: SshConnection = { id: "profile-2", name: "Other", host: "other-host" };
  const local = { kind: "local" } as const;

  it("matches a voktty-ssh identity only by exact saved id", () => {
    const saved = [profile, other];
    expect(
      findSshProfile(remoteSshEnvironmentId("profile-2"), saved, local),
    ).toBe(other);
    expect(
      findSshProfile(remoteSshEnvironmentId("build-host"), saved, local),
    ).toBeUndefined();
    expect(
      findSshProfile(remoteSshEnvironmentId("Build host"), saved, local),
    ).toBeUndefined();
  });

  it("never falls back to the active SSH connection for an unknown environment", () => {
    const active = {
      kind: "ssh",
      connection: other,
      root: "/",
    } as const;
    expect(findSshProfile("unknown-env", [profile], active)).toBeUndefined();
    expect(
      findSshProfile(remoteSshEnvironmentId("missing"), [profile], active),
    ).toBeUndefined();
    expect(
      findSshProfile(remoteSshEnvironmentId("profile-2"), [profile], active),
    ).toBe(other);
  });

  it("accepts legacy name or host identities only when they are unambiguous", () => {
    const twin: SshConnection = { ...other, id: "profile-3", host: "build-host" };
    expect(findSshProfile("other-host", [profile, other], local)).toBe(other);
    expect(findSshProfile("build-host", [profile, twin], local)).toBeUndefined();
  });
});
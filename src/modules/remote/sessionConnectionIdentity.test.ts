import { describe, expect, it } from "vitest";
import type { RemoteSshConnection } from "./client";
import {
  normalizedRemoteSessionConnection,
  sameRemoteSessionConnection,
} from "./sessionConnectionIdentity";

const connection: RemoteSshConnection = {
  host: "example.test",
  user: "dev",
  port: 22,
  identityFile: "/keys/build",
  extraArgs: "-o ProxyJump=bastion",
  initialDirectory: "/srv/app",
};

describe("remote session connection identity", () => {
  it("normalizes defaults and whitespace without including PTY metadata", () => {
    expect(
      sameRemoteSessionConnection(
        {
          host: " example.test ",
          user: " ",
          identityFile: "",
          extraArgs: " ",
          initialDirectory: " ",
          multiplexerMode: "auto",
        },
        { host: "example.test", port: 22, multiplexerMode: "none" },
      ),
    ).toBe(true);
    expect(
      sameRemoteSessionConnection(connection, {
        host: " example.test ",
        user: " dev ",
        identityFile: " /keys/build ",
        extraArgs: " -o ProxyJump=bastion ",
        initialDirectory: " /srv/app ",
      }),
    ).toBe(true);
  });

  it.each([
    { host: "other.test" },
    { user: "other-user" },
    { port: 2222 },
    { identityFile: "/keys/other" },
    { extraArgs: "-o ProxyJump=other" },
    { initialDirectory: "/srv/other" },
  ])("distinguishes each native binding field: %o", (changed) => {
    expect(
      sameRemoteSessionConnection(connection, { ...connection, ...changed }),
    ).toBe(false);
  });

  it("returns an immutable identity independent of the caller object", () => {
    const mutable = { ...connection };
    const identity = normalizedRemoteSessionConnection(mutable);
    mutable.host = "other.test";
    expect(identity.host).toBe("example.test");
    expect(Object.isFrozen(identity)).toBe(true);
    expect(identity).not.toBe(mutable);
  });
});

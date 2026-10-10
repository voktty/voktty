import { describe, expect, it } from "vitest";
import { githubOwnerRepoFromRemote } from "./githubRemote";

describe("githubOwnerRepoFromRemote", () => {
  it.each([
    "https://github.com/acme/widgets.git",
    "https://github.com/acme/widgets",
    "ssh://git@github.com/acme/widgets.git",
    "git@github.com:acme/widgets.git",
  ])("extracts the repository from %s", (remote) => {
    expect(githubOwnerRepoFromRemote(remote)).toBe("acme/widgets");
  });

  it.each([
    null,
    "https://gitlab.com/acme/widgets.git",
    "https://github.com/acme/widgets/issues?state=open",
    "https://github.com/acme/widgets/extra.git",
    "git@github.com:acme/widgets?state=open",
    "https://github.com/acme/widgets%2Fother.git",
  ])("rejects unsupported or malformed remote %s", (remote) => {
    expect(githubOwnerRepoFromRemote(remote)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  projectEnvironmentId,
  type ProjectEnvironmentIdentity,
  projectEnvironmentOwnerId,
  projectEnvironmentOwnerIds,
} from "./projectEnvironmentIdentity";

type TestProjectEntry = {
  identity: ProjectEnvironmentIdentity;
  connecting?: boolean;
  error?: string | null;
};

function entry(
  profileId: string,
  requestedRoot: string,
  overrides: Partial<ProjectEnvironmentIdentity> = {},
): TestProjectEntry {
  return {
    identity: {
      projectId: projectEnvironmentId(profileId, requestedRoot),
      profileId,
      requestedRoot,
      automatic: true,
      ...overrides,
    },
  };
}

function projects(...values: [string, TestProjectEntry][]) {
  return Object.fromEntries(values);
}

describe("projectEnvironmentId", () => {
  it("uses the exact saved SSH profile namespace without connection credentials", () => {
    expect(projectEnvironmentId("build/host #west", "/srv/app/")).toBe(
      "remote://voktty-ssh-build%2Fhost%20%23west/srv/app",
    );
    expect(projectEnvironmentId("p1", "/srv/app")).not.toBe(
      projectEnvironmentId("p2", "/srv/app"),
    );
  });

  it.each([
    ["/srv/app", "/srv/app/"],
    ["C:\\Work\\App", "C:/Work/App/"],
    ["\\\\server\\share\\App", "//server/share/App/"],
  ])("normalizes slash spelling and trailing separators: %s", (left, right) => {
    expect(projectEnvironmentId("p1", left)).toBe(
      projectEnvironmentId("p1", right),
    );
  });

  it("preserves the drive and UNC namespace rather than assuming POSIX paths", () => {
    expect(projectEnvironmentId("p1", "C:\\Work\\App")).toBe(
      "remote://voktty-ssh-p1/C:/Work/App",
    );
    expect(projectEnvironmentId("p1", "\\\\server\\share\\App")).toBe(
      "remote://voktty-ssh-p1//server/share/App",
    );
  });

  it.each(["", " p1", "p1 ", "p".repeat(257)])(
    "rejects an invalid saved profile id before producing an identity",
    (profileId) => {
      expect(() => projectEnvironmentId(profileId, "/srv/app")).toThrow(
        "invalid id",
      );
    },
  );
});

describe("projectEnvironmentOwnerIds", () => {
  it("finds confirmed default-root and fallback aliases through the canonical project", () => {
    const canonical = projectEnvironmentId("p1", "/home/work");
    const defaultOwner = projectEnvironmentId("p1", ".");
    const fallbackOwner = projectEnvironmentId("p1", "/missing");
    const values = projects(
      [
        defaultOwner,
        entry("p1", ".", { projectId: canonical, resolvedRoot: "/home/work" }),
      ],
      [
        fallbackOwner,
        entry("p1", "/missing", {
          projectId: canonical,
          resolvedRoot: "/home/work",
        }),
      ],
      ["other-root", entry("p1", "/other")],
      ["other-profile", entry("p2", "/home/work")],
    );
    expect(projectEnvironmentOwnerIds(canonical, values)).toEqual([
      defaultOwner,
      fallbackOwner,
    ]);
    expect(projectEnvironmentOwnerId(canonical, values)).toBe(defaultOwner);
    expect(projectEnvironmentOwnerIds(fallbackOwner, values)).toEqual([
      fallbackOwner,
      defaultOwner,
    ]);
  });

  it("prefers an exact owner while returning every automatic alias for group closing", () => {
    const canonical = projectEnvironmentId("p1", "/srv/app");
    const values = projects(
      [
        "aaa-default",
        entry("p1", ".", { projectId: canonical, resolvedRoot: "/srv/app" }),
      ],
      [canonical, entry("p1", "/srv/app")],
      [
        "zzz-fallback",
        entry("p1", "/missing", {
          projectId: canonical,
          resolvedRoot: "/srv/app",
        }),
      ],
    );
    expect(projectEnvironmentOwnerIds(canonical, values)).toEqual([
      canonical,
      "aaa-default",
      "zzz-fallback",
    ]);
    expect(projectEnvironmentOwnerId(canonical, values)).toBe(canonical);
    expect(projectEnvironmentOwnerIds("zzz-fallback", values)).toEqual([
      "zzz-fallback",
      "aaa-default",
      canonical,
    ]);
  });

  it("keeps an exact legacy slash spelling first instead of replacing its owner key", () => {
    const canonical = projectEnvironmentId("p1", "/srv/app");
    const exact = `${canonical}/`;
    const values = projects(
      [canonical, entry("p1", "/srv/app")],
      [exact, entry("p1", "/srv/app/", { projectId: canonical })],
    );
    expect(projectEnvironmentOwnerIds(exact, values)).toEqual([
      exact,
      canonical,
    ]);
  });

  it.each(["pending", "failed"])(
    "keeps a %s requested identity reachable without a resolved root",
    (phase) => {
      const root = phase === "pending" ? "." : "/missing";
      const owner = projectEnvironmentId("p1", root);
      const value = {
        ...entry("p1", root),
        connecting: phase === "pending",
        error: phase === "failed" ? "auth failed" : null,
      };
      const values = projects([owner, value]);
      expect(value.identity.resolvedRoot).toBeUndefined();
      expect(projectEnvironmentOwnerIds(owner, values)).toEqual([owner]);
      expect(
        projectEnvironmentOwnerIds(
          projectEnvironmentId("p1", "/home/work"),
          values,
        ),
      ).toEqual([]);
    },
  );

  it("retains a stable confirmed identity during a later pending reconnect", () => {
    const canonical = projectEnvironmentId("p1", "/home/work");
    const owner = projectEnvironmentId("p1", ".");
    const value = {
      ...entry("p1", ".", { projectId: canonical }),
      connecting: true,
      error: null,
    };
    expect(value.identity.resolvedRoot).toBeUndefined();
    expect(
      projectEnvironmentOwnerIds(canonical, projects([owner, value])),
    ).toEqual([owner]);
  });

  it("does not infer grouping from equal physical roots for explicit owners", () => {
    const canonical = projectEnvironmentId("p1", "/srv/app");
    const values = projects(
      [
        "alpha",
        entry("p1", "/srv/app", {
          automatic: false,
          projectId: canonical,
          resolvedRoot: "/srv/app",
        }),
      ],
      [
        "beta",
        entry("p1", "/srv/app", {
          automatic: false,
          projectId: canonical,
          resolvedRoot: "/srv/app",
        }),
      ],
      [canonical, entry("p1", "/srv/app")],
    );
    expect(projectEnvironmentOwnerIds("alpha", values)).toEqual(["alpha"]);
    expect(projectEnvironmentOwnerIds("beta", values)).toEqual(["beta"]);
    expect(projectEnvironmentOwnerIds(canonical, values)).toEqual([canonical]);
  });

  it.each([
    "",
    "p1",
    "local",
    "/srv/app",
    "missing-owner",
    "remote://unknown/srv/app",
    "remote://voktty-ssh-p2/srv/app",
    "remote://voktty-ssh-p1/other",
  ])(
    "never adopts an unrelated owner for an unknown identity: %s",
    (unknown) => {
      const owner = projectEnvironmentId("p1", "/srv/app");
      const values = projects([owner, entry("p1", "/srv/app")]);
      expect(projectEnvironmentOwnerIds(unknown, values)).toEqual([]);
      expect(projectEnvironmentOwnerId(unknown, values)).toBeUndefined();
    },
  );

  it.each(["__proto__", "constructor", "toString"])(
    "treats an explicit special key as opaque owner data: %s",
    (owner) => {
      const values = projects([
        owner,
        entry("p1", "/srv/app", { automatic: false }),
      ]);
      expect(projectEnvironmentOwnerIds(owner, values)).toEqual([owner]);
      expect(projectEnvironmentOwnerIds(owner, {})).toEqual([]);
    },
  );

  it("ignores inherited owner properties", () => {
    const values = Object.create({
      alpha: entry("p1", "/srv/app", { automatic: false }),
    });
    expect(projectEnvironmentOwnerIds("alpha", values)).toEqual([]);
  });

  it.each([
    ["C:\\Work\\App", "remote://voktty-ssh-p1/C:\\Work\\App/"],
    ["\\\\server\\share\\App", "remote://voktty-ssh-p1//server/share/App/"],
  ])(
    "finds canonical Windows and UNC owners from UI slash variants: %s",
    (root, query) => {
      const owner = projectEnvironmentId("p1", root);
      const values = projects([owner, entry("p1", root)]);
      expect(projectEnvironmentOwnerIds(query, values)).toEqual([owner]);
    },
  );

  it("does not mutate credential-free identity metadata during lookup", () => {
    const owner = projectEnvironmentId("p1", "/srv/app");
    const values = projects([owner, entry("p1", "/srv/app")]);
    const original = JSON.stringify(values);
    projectEnvironmentOwnerIds(`${owner}/`, values);
    expect(JSON.stringify(values)).toBe(original);
    expect(Object.keys(values[owner].identity)).toEqual([
      "projectId",
      "profileId",
      "requestedRoot",
      "automatic",
    ]);
  });
});

import { expect, it } from "vitest";
import { harnessProjectTargetMatches, parseHarnessProjectRequest } from "@/modules/surfaces/lib/harnessProjectRequest";
import type { Tab } from "@/modules/tabs";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";

it.each([null, [], {}, { path: 1 }, { path: " " }, { path: "x".repeat(32769) },
  { path: "/project", target: null }, { path: "/project", target: undefined },
  { path: "/project", target: { ownerId: 1 } },
  { path: "/project", target: { ownerId: "1", tabKey: "tab-one" } },
  { path: "/project", target: { ownerId: -1, tabKey: "tab-one" } },
  { path: "/project", target: { ownerId: 1.1, tabKey: "tab-one" } },
  { path: "/project", target: { ownerId: Number.MAX_SAFE_INTEGER + 1, tabKey: "tab-one" } },
  { path: "/project", target: { ownerId: 1, tabKey: "one" } },
  { path: "/project", target: { ownerId: 1, tabKey: `tab-${"x".repeat(4096)}` } },
])("rejects malformed project requests without treating a directed request as legacy (%j)", (input) => {
  expect(parseHarnessProjectRequest(input)).toBeNull();
});

it("copies directed ownership and matches only its Harness stable identity", () => {
  const target = { ownerId: 1, tabKey: asTabKey("tab-one") };
  const request = parseHarnessProjectRequest({ path: "remote://machine/project", target });
  target.ownerId = 2;
  expect(request).toEqual({ path: "remote://machine/project", target: { ownerId: 1, tabKey: "tab-one" } });
  if (!request?.target) throw new Error("Missing target");
  expect(harnessProjectTargetMatches(request.target, { kind: "harness", id: 1, tabKey: "tab-one" } as Tab)).toBe(true);
  expect(harnessProjectTargetMatches(request.target, { kind: "terminal", id: 1, tabKey: "tab-one" } as Tab)).toBe(false);
  expect(harnessProjectTargetMatches(request.target, { kind: "harness", id: 1, tabKey: "tab-replaced" } as Tab)).toBe(false);
  expect(parseHarnessProjectRequest({ path: "//server/share/project" })).toEqual({ path: "//server/share/project" });
});

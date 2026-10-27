import { expect, it, vi } from "vitest";
import { captureHarnessProjectOpening, harnessProjectTargetMatches, parseHarnessProjectRequest, subscribeHarnessProjectOpenings } from "@/modules/surfaces/lib/harnessProjectRequest";
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

it("captures only existing opening subscribers and consumes a request once", () => {
  const receive = vi.fn();
  const later = vi.fn();
  const release = subscribeHarnessProjectOpenings(receive);
  const open = captureHarnessProjectOpening();
  const releaseLater = subscribeHarnessProjectOpenings(later);
  try {
    open("remote://machine/root");
    open("/replayed");
    expect(receive).toHaveBeenCalledExactlyOnceWith("remote://machine/root");
    expect(later).not.toHaveBeenCalled();
  } finally { release(); releaseLater(); }
});

it("never replays an opening captured before registration", () => {
  const open = captureHarnessProjectOpening();
  const receive = vi.fn();
  const release = subscribeHarnessProjectOpenings(receive);
  try {
    open("/late");
    expect(receive).not.toHaveBeenCalled();
  } finally { release(); }
});

it.each(["", " ", "x".repeat(32769)])("consumes malformed opening paths without delivery (%s)", (path) => {
  const receive = vi.fn();
  const release = subscribeHarnessProjectOpenings(receive);
  try {
    const open = captureHarnessProjectOpening();
    open(path);
    open("/second-attempt");
    expect(receive).not.toHaveBeenCalled();
  } finally { release(); }
});

it("suppresses reentrant delivery to retired subscribers without adopting replacements", () => {
  const second = vi.fn();
  const replacement = vi.fn();
  let releaseReplacement = () => {};
  const first = vi.fn(() => {
    releaseSecond();
    releaseReplacement = subscribeHarnessProjectOpenings(replacement);
  });
  const releaseFirst = subscribeHarnessProjectOpenings(first);
  const releaseSecond = subscribeHarnessProjectOpenings(second);
  try {
    captureHarnessProjectOpening()("/project");
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
  } finally { releaseFirst(); releaseSecond(); releaseReplacement(); }
});

it("bounds opening subscriptions and releases only the exact registration", () => {
  const receive = vi.fn();
  const releases = Array.from({ length: 256 }, () => subscribeHarnessProjectOpenings(receive));
  let replacement = () => {};
  try {
    expect(() => subscribeHarnessProjectOpenings(receive)).toThrow("Too many Harness project opening subscribers.");
    const open = captureHarnessProjectOpening();
    releases[0]();
    replacement = subscribeHarnessProjectOpenings(receive);
    releases[0]();
    expect(() => subscribeHarnessProjectOpenings(receive)).toThrow();
    open("/project");
    expect(receive).toHaveBeenCalledTimes(255);
  } finally { releases.forEach((release) => { release(); }); replacement(); }
});

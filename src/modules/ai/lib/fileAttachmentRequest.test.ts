// @vitest-environment happy-dom
import { expect, it } from "vitest";
import {
  FILE_ATTACHMENT_EVENT,
  canRequestFileAttachment,
  requestFileAttachment,
  takeFileAttachmentRequest,
} from "@/modules/ai/lib/fileAttachmentRequest";

it("rejects fabricated and replayed event payloads", () => {
  expect(takeFileAttachmentRequest("/repo/file.ts")).toBeUndefined();
  expect(
    takeFileAttachmentRequest({
      path: "/repo/file.ts",
      workspace: { kind: "local" },
    }),
  ).toBeUndefined();
  let key: unknown;
  const receive = (event: Event) => {
    key = (event as CustomEvent).detail;
    expect(takeFileAttachmentRequest(key)).toMatchObject({
      path: "/repo/file.ts",
      workspace: { kind: "local" },
    });
    expect(takeFileAttachmentRequest(key)).toBeUndefined();
  };
  window.addEventListener(FILE_ATTACHMENT_EVENT, receive);
  try {
    expect(requestFileAttachment("/repo/file.ts", { kind: "local" })).toBe(
      true,
    );
  } finally {
    window.removeEventListener(FILE_ATTACHMENT_EVENT, receive);
  }
  expect(takeFileAttachmentRequest(key)).toBeUndefined();
});

it("copies the original filesystem and retains its source guard after dispatch", () => {
  const workspace = {
    kind: "ssh" as const,
    root: "/repo",
    sessionId: 7,
    connection: { id: "fixture", name: "Fixture", host: "a.test" },
  };
  let current = true;
  let captured: ReturnType<typeof takeFileAttachmentRequest>;
  const receive = (event: Event) => {
    captured = takeFileAttachmentRequest((event as CustomEvent).detail);
  };
  window.addEventListener(FILE_ATTACHMENT_EVENT, receive);
  try {
    requestFileAttachment("/repo/file.ts", workspace, () => current);
  } finally {
    window.removeEventListener(FILE_ATTACHMENT_EVENT, receive);
  }
  workspace.connection.host = "b.test";
  current = false;
  expect(captured?.workspace).toMatchObject({
    sessionId: 7,
    connection: { host: "a.test" },
  });
  expect(captured?.isCurrent()).toBe(false);
});

it("does not claim delivery without a receiver or after source retirement", () => {
  expect(requestFileAttachment("/repo/file.ts", { kind: "local" })).toBe(false);
  expect(
    requestFileAttachment("/repo/file.ts", { kind: "local" }, () => false),
  ).toBe(false);
});

it("refuses unsupported sources while keeping native Windows paths local", () => {
  const docker = {
    kind: "docker" as const,
    connection: { containerId: "box", containerName: "Box", image: "image" },
  };
  expect(canRequestFileAttachment("/repo/file.ts", docker)).toBe(false);
  expect(
    canRequestFileAttachment("remote://profile/repo/file.ts", {
      kind: "local",
    }),
  ).toBe(false);
  expect(canRequestFileAttachment("C:/repo/file.ts", docker)).toBe(true);
});

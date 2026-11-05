import { expect, it } from "vitest";
import { remoteMemoryError } from "@/modules/workspace-kit/lib/remoteMemoryWire";
import { parseMemoryStorageDiagnostic } from "@/modules/workspace-kit/lib/memoryStorageDiagnostic";

it("preserves only bounded storage metadata across the SSH error adapter", () => {
  const failure = remoteMemoryError({
    code: "denied",
    storage: {
      stage: "application-parent",
      windowsError: null,
      privatePath: "private data",
    },
  });
  expect(parseMemoryStorageDiagnostic(failure)).toEqual({
    stage: "application-parent",
    windowsError: null,
  });
  expect((failure as Error & { storage: unknown }).storage).toEqual({
    stage: "application-parent",
    windowsError: null,
  });
  expect(failure.message).not.toContain("private data");
  expect(
    parseMemoryStorageDiagnostic(remoteMemoryError({ code: "denied" })),
  ).toBeUndefined();
  expect(
    parseMemoryStorageDiagnostic(
      remoteMemoryError({
        code: "denied",
        storage: { stage: "arbitrary private data" },
      }),
    ),
  ).toBeUndefined();
});

it("rejects arbitrary diagnostic text and invalid operating-system status values", () => {
  for (const storage of [
    null,
    "private content",
    {},
    { stage: "private path" },
    ...[-1, 1.5, Infinity, 0x100000000, "5"].map((windowsError) => ({
      stage: "windows-directory-open",
      windowsError,
    })),
  ])
    expect(parseMemoryStorageDiagnostic({ storage })).toBeUndefined();
  expect(
    parseMemoryStorageDiagnostic({
      storage: { stage: "preferences", windowsError: 0xffffffff },
    }),
  ).toEqual({ stage: "preferences", windowsError: 4294967295 });
});
